import '../l10n/interface_locale.dart';
import 'agent_controller.dart';
import '../data/semantic_service.dart';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/library_repository.dart';
import '../data/pack_file_reader.dart';

class LibraryViewModel extends ChangeNotifier {
  LibraryViewModel(this.repository, {PackFileReader? packReader})
    : packReader = packReader ?? const PackFileReader();
  late final agents = AgentController(repository)..addListener(_notify);
  final PackFileReader packReader;
  late final semanticService = SemanticService(
    providers: () => agents.providers,
  );
  bool semanticBusy = false;
  List<Map<String, dynamic>> get lookups =>
      (snapshot?.personal['lookups'] as List? ?? [])
          .cast<Map<String, dynamic>>();

  Future<void> semanticAction(Map<String, dynamic> action) async {
    final wasHome = home;
    await act({'kind': 'semantic', 'action': action});
    home = wasHome;
    _notify();
  }

  Future<String?> resolveSemantic(
    Map<String, dynamic> capture, {
    String? intakeId,
    String? previousId,
    String? clarification,
  }) async {
    if (semanticBusy ||
        busy ||
        _pending != null ||
        !semanticService.configured) {
      return null;
    }
    semanticBusy = true;
    _notify();
    final id = const Uuid().v4();
    try {
      await semanticAction({
        'kind': 'begin',
        'id': id,
        'snapshot': capture,
        'intake_id': intakeId,
        'previous_id': previousId,
        'clarification': clarification,
      });
      if (error != null) return null;
      final job = lookups.firstWhere((v) => v['id'] == id);
      Map<String, dynamic> result;
      busy = true;
      _notify();
      try {
        result = await semanticService.resolve(
          job['request'] as Map<String, dynamic>,
        );
      } on SemanticServiceException catch (e) {
        busy = false;
        await semanticAction({'kind': 'fail', 'id': id, 'reason': e.code});
        return id;
      }
      busy = false;
      await semanticAction({'kind': 'finish', 'result': result});
      return id;
    } finally {
      semanticBusy = false;
      _notify();
    }
  }

  List<Map<String, dynamic>> _activePreparationRequests() => preparations
      .where((t) => t['status'] == 'generating' && t['request'] != null)
      .map((t) => Map<String, dynamic>.from(t['request'] as Map))
      .toList();
  Future<void> _cancelInvalidated(List<Map<String, dynamic>> requests) async {
    for (final request in requests) {
      if (preparations.any((t) => t['activeAttemptId'] == request['id'])) {
        continue;
      }
      if (!semanticService.configured ||
          request['anchor'] != null &&
              request['anchor']['recipient'] != semanticService.origin) {
        setNotice(() => l10n.uiOldResultsAreBlockedLocallyThe);
        _notify();
        continue;
      }
      try {
        await semanticService.cancelPreparation(request);
      } catch (_) {
        setNotice(() => l10n.uiOldResultsAreBlockedLocallyCancellation);
      }
      _notify();
    }
  }

  bool get contentServiceConfigured => agents.providers.profiles.isEmpty
      ? semanticService.configured
      : agents.providers.ready('content');
  String get contentServiceOrigin => agents.providers.profiles.isEmpty
      ? semanticService.origin
      : agents.providers.forPurpose('content') == null
      ? ''
      : Uri.parse(agents.providers.forPurpose('content')!['endpoint']).origin;
  Future<void> setAnchorUse(Map<String, dynamic> meaning, bool enabled) async {
    final requests = _activePreparationRequests();
    final wasHome = home;
    await act({
      'kind': 'anchor',
      'action': {
        'kind': 'set',
        'meaning_id': meaning['id'],
        'expected_revision': meaning['revision'],
        'enabled': enabled,
        'recipient': enabled ? contentServiceOrigin : null,
      },
    });
    home = wasHome;
    if (error == null) {
      setNotice(
        () => enabled
            ? l10n.uiPermissionSavedPrepareNewLearningMaterial
            : l10n.uiPermissionRevokedFutureMaterialNeedsTo,
      );
      await _cancelInvalidated(requests);
    }
    _notify();
  }

  bool provisioningBusy = false;
  List<Map<String, dynamic>> get preparations =>
      (snapshot?.personal['preparations'] as List? ?? [])
          .cast<Map<String, dynamic>>();
  Future<void> provisioningAction(Map<String, dynamic> action) async {
    final requests = _activePreparationRequests();
    final wasHome = home;
    await act({'kind': 'provisioning', 'action': action});
    home = wasHome;
    _notify();
    if (error == null && ['cancel', 'set_policy'].contains(action['kind'])) {
      await _cancelInvalidated(requests);
    }
  }

  Future<void> prepareContent(String taskId) async {
    if (busy ||
        provisioningBusy ||
        _pending != null ||
        !semanticService.configured) {
      return;
    }
    final task = preparations.firstWhere((v) => v['id'] == taskId);
    provisioningBusy = true;
    _notify();
    try {
      await provisioningAction({
        'kind': 'begin',
        'task_id': taskId,
        'expected_revision': task['revision'],
        'service_origin': semanticService.origin,
      });
      if (error != null) return;
      final request =
          preparations.firstWhere((v) => v['id'] == taskId)['request']
              as Map<String, dynamic>;
      Map<String, dynamic> completion;
      try {
        completion = {
          'kind': 'finish',
          'task_id': taskId,
          'result': await semanticService.prepare(request),
        };
      } on SemanticServiceException catch (e) {
        completion = {
          'kind': 'fail',
          'task_id': taskId,
          'attempt_id': request['id'],
          'reason': e.code,
        };
      }
      // A response waits for another local transaction/recovery; it never repeats the provider call.
      while (busy || _pending != null) {
        if (_disposed) return;
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      if (_disposed) return;
      final latest = preparations.firstWhere((v) => v['id'] == taskId);
      if (latest['activeAttemptId'] == request['id'] &&
          latest['status'] == 'generating') {
        await provisioningAction(completion);
        if (error == null &&
            completion['kind'] == 'finish' &&
            completion['result']['status'] == 'ready') {
          final materialId = preparations.firstWhere(
            (v) => v['id'] == taskId,
          )['materialId'];
          final material = snapshot!.catalog
              .map((v) => v['material'] as Map<String, dynamic>)
              .where((m) => m['id'] == materialId)
              .firstOrNull;
          if (material?['pronunciation'] != null) {
            try {
              await obtainPronunciation(material!);
            } catch (_) {
              setNotice(() => l10n.uiTextIsReadyDownloadAudioLater);
            }
          }
        }
      }
    } finally {
      provisioningBusy = false;
      _notify();
    }
  }

  Future<Uint8List> obtainPronunciation(Map<String, dynamic> material) async {
    final id = material['id'] as String;
    try {
      return await repository.pronunciation(id);
    } catch (_) {
      /* Cache missing or damaged. */
    }
    final reference = material['pronunciation'] as Map<String, dynamic>;
    final bytes = await semanticService.pronunciation(reference);
    await repository.cachePronunciation(
      id,
      bytes,
    ); // Rust verifies exact fixed digest before persistence.
    return repository.pronunciation(id);
  }

  String Function()? _notice;
  String? get notice => _notice?.call();
  void setNotice(String Function()? value) => _notice = value;
  final LibraryRepository repository;
  LibrarySnapshot? snapshot;
  bool busy = false;
  bool home = false;
  String Function()? _error;
  String? get error => _error?.call();
  void setError(String Function()? value) => _error = value;
  Map<String, dynamic>? _pending;
  bool _disposed = false;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    agents.dispose();
    semanticService.clear();
    _disposed = true;
    super.dispose();
  }

  Future<void> load() async {
    if (busy) return;
    busy = true;
    setError(null);
    _notify();
    try {
      snapshot = await repository.load();
      await agents.load();
      _pending = null;
      final today = DateTime.now().toIso8601String().substring(0, 10);
      final date = snapshot!.learning['date'] as String? ?? '';
      if (date.compareTo(today) < 0) {
        snapshot = await repository.execute({
          'operationId': const Uuid().v4(),
          'libraryId': snapshot!.id,
          'expectedRevision': snapshot!.revision,
          'action': {'kind': 'refresh_activity'},
        });
      }
    } catch (e) {
      setError(() => message(e));
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> act(Map<String, dynamic> action) async {
    if (busy || snapshot == null || _pending != null) return;
    _pending = {
      'operationId': const Uuid().v4(),
      'libraryId': snapshot!.id,
      'expectedRevision': snapshot!.revision,
      'action': action,
    };
    await retry();
  }

  Future<void> retry() async {
    if (busy) return;
    if (_pending == null) {
      await load();
      return;
    }
    busy = true;
    setError(null);
    _notify();
    try {
      snapshot = await repository.execute(_pending!);
      _pending = null;
      // A replay is the original result. Query the latest committed projection.
      snapshot = await repository.load();
      home = false;
    } catch (e) {
      if (e.toString().contains('no_due_review')) {
        _pending = null;
        home = true;
        setNotice(() => l10n.uiNoReviewsAreDueStartNew);
      } else {
        // These Rust validation errors roll back the whole command. A corrected
        // source/range intent must receive a new operation id; uncertain I/O
        // failures retain the pending id for safe replay.
        if ([
          'pause_activity_before_curriculum_change',
          'invalid_curriculum',
          'book_unavailable',
          'book_material_not_downloaded',
          'book_version_conflict',
          'target_outside_study_scope',
        ].any(e.toString().contains)) {
          _pending = null;
        }
        setError(() => message(e));
      }
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> importPack() async {
    if (busy || _pending != null) return;
    busy = true;
    setError(null);
    setNotice(null);
    _notify();
    String? encoded;
    try {
      encoded = await packReader.pick();
    } catch (e) {
      setError(() => message(e));
    } finally {
      busy = false;
      _notify();
    }
    if (_disposed || encoded == null) return;
    try {
      final value = jsonDecode(encoded) as Map<String, dynamic>;
      final structured =
          value['format'] == 'sensa-runtime-artifact-v1' ||
          value['schemaVersion'] == 'sensa-runtime-learning-release-v1';
      await act(
        value['format'] == 'sensa-local-book-v1'
            ? {
                'kind': 'curriculum',
                'action': {'kind': 'import_book', 'book_json': encoded},
              }
            : structured
            ? {'kind': 'import_runtime_release', 'release_json': encoded}
            : {'kind': 'import_pack', 'pack_json': encoded},
      );
    } catch (e) {
      setError(() => message(e));
      _notify();
    }
    if (error == null) {
      home = true;
      setNotice(() => l10n.uiPackageImportedChooseContentToAdd);
      _notify();
    }
  }

  Future<void> selectMaterial(String id) async {
    await act({'kind': 'select_material', 'material_id': id});
    if (error == null) {
      home = true;
      _notify();
    }
  }

  Future<void> setPolicy(String scope, Map<String, dynamic>? policy) async {
    await act({'kind': 'set_policy', 'scope': scope, 'policy': policy});
    if (error == null) {
      home = true;
      setNotice(() => l10n.uiLearningModeSavedStartedLearningKeeps);
      _notify();
    }
  }

  String? _attemptedEntry;
  Map<String, dynamic>? _pendingCheckin;
  bool get checkInPending => _pendingCheckin != null;
  Future<void> startActivity(String mode) =>
      act({'kind': 'activity_start', 'mode': mode});
  Future<void> nextActivity({bool early = false}) => act({
    'kind': 'activity_next',
    'activity_id': snapshot!.activity!['id'],
    'early': early,
  });
  Future<void> stopActivity({bool end = false}) async {
    await act({
      'kind': end ? 'activity_end' : 'activity_pause',
      'activity_id': snapshot!.activity!['id'],
    });
    if (!end && error == null) showHome();
  }

  Future<void> enteredActivity() async {
    final a = snapshot?.activity;
    if (a == null ||
        a['status'] != 'active' ||
        a['canAnswer'] != true ||
        busy ||
        error != null ||
        home) {
      return;
    }
    final key = '${snapshot!.learning['date']}:${a['entryOperationId']}';
    if (_attemptedEntry == key) return;
    _attemptedEntry = key;
    await checkIn(formal: true);
  }

  /// Check-in failure is visible but never blocks the learning command queue.
  Future<void> checkIn({bool formal = false}) async {
    if (busy || snapshot == null || _pending != null) return;
    final a = snapshot!.activity;
    _pendingCheckin ??= {
      'operationId': const Uuid().v4(),
      'libraryId': snapshot!.id,
      'expectedRevision': snapshot!.revision,
      'action': {
        'kind': 'check_in',
        'activity_id': formal ? (a?['id']) : null,
        'execution_id': formal ? (a?['executionId']) : null,
        'entry_operation_id': formal ? (a?['entryOperationId']) : null,
      },
    };
    busy = true;
    _notify();
    try {
      await repository.execute(_pendingCheckin!);
      _pendingCheckin = null;
      snapshot = await repository.load();
      setNotice(() => l10n.uiCheckedInToday721);
    } catch (e) {
      if (e.toString().contains('revision_conflict')) {
        try {
          snapshot = await repository.load();
          _pendingCheckin!['expectedRevision'] = snapshot!.revision;
        } catch (_) {
          // Keep the separate check-in retry; the learning queue remains usable.
        }
      }
      setNotice(() => l10n.uiCheckInWasNotSavedRetry);
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> assuranceIntent(Map<String, dynamic> intent) async {
    final a = snapshot?.assurance;
    if (a == null) return;
    if (intent['kind'] == 'pause' &&
        snapshot?.activity?['status'] == 'active') {
      await stopActivity();
      return;
    }
    await act({
      'kind': 'assurance_event',
      'session_id': a['id'],
      'ordinal': a['ordinal'],
      'intent': intent,
    });
  }

  Future<void> answer(String action) async {
    final run = snapshot?.run;
    if (run == null) return;
    await act({
      'kind': 'record_action',
      'run_id': run['id'],
      'ordinal': run['ordinal'],
      'action': action,
    });
  }

  Future<void> showHome() async {
    home = true;
    _notify();
    if (!busy && _pending == null && snapshot != null) {
      await act({'kind': 'refresh_activity'});
      home = true;
      _notify();
    }
  }

  Future<void> personalAction(Map<String, dynamic> action) async {
    final requests = _activePreparationRequests();
    final wasHome = home;
    await act({'kind': 'personal', 'action': action});
    home = wasHome;
    _notify();
    if (error == null) await _cancelInvalidated(requests);
  }

  String message(Object error) {
    final text = error.toString();
    if (text.contains('anchor_recipient')) {
      return l10n.uiSelectTheAuthorizedServiceOrRevoke;
    }
    if (text.contains('learning_material_preparing')) {
      return l10n.uiPrepareNewMaterialForFutureLearning;
    }
    if (text.contains('learning_target_policy_exists')) {
      return l10n.uiThisTargetUsesAnotherLearningMode;
    }
    if (text.contains('preparation_budget_exhausted')) {
      return l10n.uiAllThreePreparationAttemptsAreUsed;
    }
    if (text.contains('unsupported_content_policy')) {
      return l10n.uiThisServiceCannotProvideMaterialFor;
    }
    if (text.contains('preparation_running')) {
      return l10n.uiThePreviousRequestIsStillActive;
    }
    if (text.contains('invalid_prepared_material')) {
      return l10n.uiMaterialFailedValidationReloadAndRetry;
    }
    if (text.contains('preparation_superseded')) {
      return l10n.uiThisRequestWasCanceledOrReplaced;
    }
    if (text.contains('reference_version_conflict')) {
      return l10n.uiUseANewReferenceVersionTo;
    }
    if (text.contains('reference_digest_mismatch') ||
        text.contains('invalid_reference_source')) {
      return l10n.uiReferenceSourceDigestOrTargetDoes;
    }
    if (text.contains('daily_preparation_limit')) {
      return l10n.uiDailyPreparationBudgetReachedTryAgain;
    }
    if (text.contains('attempt_timed_out')) {
      return l10n.uiPreparationTimedOutReloadTheTask;
    }
    if (text.contains('quantity_required')) {
      return l10n.uiSetYourDailyNewQuantityOn;
    }
    if (text.contains('lookup_expired')) {
      return l10n.uiSuggestionExpiredReloadAndRequestAn;
    }
    if (text.contains('lookup_superseded')) {
      return l10n.uiThisExplanationWasReplacedViewThe;
    }
    if (text.contains('lookup_already_exists')) {
      return l10n.uiAnExplanationIsAlreadyPendingContinue;
    }
    if (text.contains('invalid_proposal') ||
        text.contains('invalid_provenance') ||
        text.contains('lookup_input_mismatch')) {
      return l10n.uiExplanationFailedValidationReloadAndRequest;
    }
    if (text.contains('lookup_not_ready')) {
      return l10n.uiWaitForTheExplanationBeforeConfirming;
    }
    if (text.contains('meaning_already_confirmed')) {
      return l10n.uiThisContextAndExpressionAreAlready;
    }
    if (text.contains('invalid_occurrence')) {
      return l10n.uiChooseTheExactExpressionFromThe;
    }
    if (text.contains('invalid_capture')) {
      return l10n.uiEnterValidEnglishContextAndCheck;
    }
    if (text.contains('invalid_source') ||
        text.contains('invalid_video_source')) {
      return l10n.uiCheckTheSourceLinkOrVideo;
    }
    if (text.contains('expression_binding_mismatch')) {
      return l10n.uiTheMeaningBindingDoesNotMatch;
    }
    if (text.contains('intake_removed') || text.contains('meaning_removed')) {
      return l10n.uiRestoreThisContentFromRemovedFirst;
    }
    if (text.contains('intake_mismatch') ||
        text.contains('intake_already_confirmed')) {
      return l10n.uiThisContentChangedReloadToContinue;
    }
    if (text.contains('personal_snapshot_limit')) {
      return l10n.uiTheCurrentLimitIsInboxItems;
    }
    if (text.contains('pending_result')) {
      return l10n.uiFinishOrPauseTheCurrentStep;
    }
    if (text.contains('activity_not_active')) {
      return l10n.uiThisLearningIsPausedOrEnded;
    }
    if (text.contains('undo_across_settlement')) {
      return l10n.uiThisStepIsAlreadySettledAnd;
    }
    if (text.contains('assurance_journal_mismatch')) {
      return l10n.uiLearningHistoryFailedValidationPreserveYour;
    }
    if (text.contains('invalid_runtime_release')) {
      return l10n.uiPackageTasksOrResourcesFailedValidation;
    }
    if (text.contains('pause_activity_before_curriculum_change')) {
      return l10n.uiPauseTheCurrentSessionBeforeChanging;
    }
    if (text.contains('target_outside_study_scope')) {
      return l10n.uiThisItemIsPausedOrOutside;
    }
    if (text.contains('book_material_not_downloaded')) {
      return l10n.uiDownloadOrImportTheMaterialReferenced;
    }
    if (text.contains('book_version_conflict')) {
      return l10n.uiThisBookVersionConflictsWithThe;
    }
    if (text.contains('invalid_curriculum')) {
      return l10n.uiCheckTheBookFilePositionsOr;
    }
    if (text.contains('invalid_runtime_media')) {
      return l10n.uiPackageMediaFailedValidationNothingWas;
    }
    if (text.contains('assurance_session_active')) {
      return l10n.uiResumeOrEndTheCurrentHigh;
    }
    if (text.contains('policy_committed')) {
      return l10n.uiThisLearningModeIsFixedDefault;
    }
    if (text.contains('learning_plan_blocked')) {
      return l10n.uiThisModeIsNotReadyCheck;
    }
    if (text.contains('unsupported_learning_policy')) {
      return l10n.uiThisLearningModeOrVersionIs;
    }
    if (text.contains('policy_pin_mismatch')) {
      return l10n.uiLearningModeValidationFailedYourProgress;
    }
    if (text.contains('relearning_waiting')) {
      return l10n.uiRelearningIsNotDueYetReturn;
    }
    if (text.contains('no_due_review')) return l10n.uiThisItemIsNotDueFor;
    if (text.contains('stale_due')) {
      return l10n.uiReviewStateChangedReloadToContinue;
    }
    if (text.contains('daily_limit')) {
      return l10n.uiDailyNewLimitReachedYouCan;
    }
    if (text.contains('pack_too_large')) {
      return l10n.uiPackageTooLargeTextPackagesAllow;
    }
    if (text.contains('unsupported_pack')) {
      return l10n.uiThisPackageVersionProtocolOrLanguage;
    }
    if (text.contains('pack_version_conflict') ||
        text.contains('material_version_conflict') ||
        text.contains('target_material_conflict')) {
      return l10n.uiPackageContentConflictsWithSavedVersions;
    }
    if (text.contains('invalid_optional_resource') ||
        text.contains('invalid_pack') ||
        text.contains('pack_reveals_expression')) {
      return l10n.uiPackageValidationFailedNothingWasImported;
    }
    if (text.contains('clock_moved_backwards')) {
      return l10n.uiYourDeviceClockIsEarlierThan;
    }
    if (text.contains('revision_conflict') || text.contains('stale_step')) {
      return l10n.uiLearningStateChangedReloadToContinue;
    }
    if (text.contains('material_mismatch')) {
      return l10n.uiMaterialValidationFailedYourCurrentLearning;
    }
    if (text.contains('unsupported_library_version')) {
      return l10n.uiUpdateSensaToOpenThisLibrary;
    }
    return l10n.uiTheActionDidNotFinishRetry;
  }
}
