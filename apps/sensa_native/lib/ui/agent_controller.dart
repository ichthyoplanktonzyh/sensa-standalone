import '../l10n/interface_locale.dart';
import '../data/semantic_service.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/library_repository.dart';
import '../data/world_repository.dart';
import '../data/agent_provider.dart';
import '../src/rust/api/library.dart' as native;

class AgentController extends ChangeNotifier {
  AgentController(this.library)
    : providers = AgentProviders(File('${library.path}.agent-providers.json'));
  final LibraryRepository library;
  final AgentProviders providers;
  final transport = AgentTransport();
  List<Map<String, dynamic>> sessions = [];
  String Function()? _error;
  String? get error => _error?.call();
  void setError(String Function()? value) => _error = value;
  String preview = '';
  String? previewSession;
  bool busy = false, closed = false;
  int epoch = 0;
  Future<void> pending = Future.value();
  bool loaded = false;
  Map<String, dynamic> session(String id) =>
      sessions.firstWhere((s) => s['id'] == id);
  void changed() {
    if (!closed) notifyListeners();
  }

  Future<void> load() async {
    if (!loaded) {
      loaded = true;
      try {
        await providers.load();
      } catch (_) {
        setError(() => l10n.uiCouldNotReadModelSettingsConfigure);
      }
    }
    try {
      sessions =
          (jsonDecode(
                    await native.libraryAgents(path: library.path),
                  )['sessions']
                  as List)
              .cast<Map<String, dynamic>>();
    } catch (_) {
      setError(() => l10n.uiCouldNotReadConversationsRetry);
    }
    changed();
  }

  Future<void> act(Map<String, dynamic> Function() action) {
    final next = pending.then((_) async {
      await load();
      final s = await library.load();
      final c = {
        'operationId': const Uuid().v4(),
        'libraryId': s.id,
        'expectedRevision': s.revision,
        'action': {'kind': 'agent', 'action': action()},
      };
      try {
        await library.execute(c);
      } catch (_) {
        await library.execute(c);
      }
      await load();
    });
    pending = next.catchError((_) {});
    return next;
  }

  Future<String?> create(Map<String, dynamic> source) async {
    setError(null);
    try {
      final id = const Uuid().v4();
      Map<String, dynamic>? pronunciation;
      if (source['kind'] == 'content') {
        final snapshot = await library.load();
        final tasks = snapshot.personal['preparations'] as List;
        final task = tasks
            .where((t) => t['id'] == source['task_id'])
            .firstOrNull;
        if (task != null) {
          pronunciation = await SemanticService(providers: () => providers)
              .lookupPronunciation(
                task['target']['proposal']['expression']['surface'],
              );
        }
      }
      await act(
        () => {
          'kind': 'create',
          'id': id,
          'source': {
            ...source,
            'pronunciation': ?pronunciation,
            if (source['kind'] == 'content' &&
                providers.forPurpose('content') != null)
              'service_origin': Uri.parse(
                providers.forPurpose('content')!['endpoint'],
              ).origin,
          },
        },
      );
      return id;
    } catch (e) {
      setError(() => describe(e));
      changed();
      return null;
    }
  }

  Future<void> say(String id, String text) async {
    try {
      await act(
        () => {
          'kind': 'say',
          'id': id,
          'revision': session(id)['revision'],
          'message': text,
        },
      );
      await run(id);
    } catch (e) {
      setError(() => describe(e));
      changed();
    }
  }

  String purpose(String id) => session(id)['kind'] == 'teacher'
      ? 'teacher'
      : session(id)['candidate'] != null
      ? 'review'
      : 'content';

  Future<void> run(String id) async {
    if (busy) return;
    if (session(id)['status'] == 'ready') {
      try {
        await act(
          () => {
            'kind': 'commit',
            'id': id,
            'revision': session(id)['revision'],
          },
        );
        await cacheAudio(id);
        setError(null);
      } catch (e) {
        setError(() => describe(e));
      }
      changed();
      return;
    }
    try {
      await providers.ensureAccess(purpose(id));
    } catch (e) {
      setError(() => describe(e));
      changed();
      return;
    }
    if (!providers.ready(purpose(id))) {
      setError(() => l10n.uiChooseAModelServiceAndSave);
      changed();
      return;
    }
    busy = true;
    preview = '';
    previewSession = id;
    setError(null);
    final token = ++epoch;
    changed();
    String? lease;
    try {
      for (var step = 0; step < 8; step++) {
        if (epoch != token) return;
        await providers.ensureAccess(purpose(id));
        if (!providers.ready(purpose(id))) {
          throw const AgentFailure('credentials');
        }
        await act(
          () => {
            'kind': 'lease',
            'id': id,
            'revision': session(id)['revision'],
            'provider': providers.connection(
              providers.forPurpose(purpose(id))!,
            ),
          },
        );
        if (epoch != token) return;
        final req =
            jsonDecode(
                  await native.libraryAgentRequest(path: library.path, id: id),
                )
                as Map<String, dynamic>;
        lease = req['id'];
        final result = await transport.complete(
          req,
          providers,
          WorldRepository(library),
          onPreview: (text) {
            if (epoch == token) {
              preview = text;
              changed();
            }
          },
        );
        if (epoch != token) return;
        preview = '';
        await act(
          () => {
            'kind': req['purpose'] == 'review' ? 'review' : 'turn',
            'id': id,
            'lease_id': lease,
            ...result,
          },
        );
        lease = null;
        final status = session(id)['status'];
        if (status == 'ready') {
          await act(
            () => {
              'kind': 'commit',
              'id': id,
              'revision': session(id)['revision'],
            },
          );
          await cacheAudio(id);
          return;
        }
        if (status == 'waiting' ||
            status == 'proposal' ||
            status == 'committed') {
          return;
        }
      }
      await act(
        () => {'kind': 'stop', 'id': id, 'revision': session(id)['revision']},
      );
      setError(() => l10n.uiPausedHereReviewTheConversationBefore);
    } catch (e) {
      if (epoch == token) {
        setError(() => describe(e));
        if (lease != null) {
          try {
            await act(() => {'kind': 'fail', 'id': id, 'lease_id': lease});
          } catch (_) {}
        }
      }
    } finally {
      if (epoch == token) {
        busy = false;
        preview = '';
        previewSession = null;
        changed();
      }
    }
  }

  Future<void> cacheAudio(String id) async {
    try {
      final source = session(id)['input']['pronunciation'];
      if (source == null) return;
      final service = SemanticService(providers: () => providers);
      if (service.connection?['endpoint'] != source['recipient']) return;
      final snapshot = await library.load();
      final task = (snapshot.personal['preparations'] as List).firstWhere(
        (t) => t['id'] == session(id)['input']['taskId'],
      );
      final bytes = await service.pronunciation(
        Map<String, dynamic>.from(source['reference']),
      );
      await library.cachePronunciation(task['materialId'], bytes);
    } catch (_) {
      /* Optional audio never undoes an admitted text material. */
    }
  }

  Future<void> stop(String id) async {
    epoch++;
    transport.cancel();
    preview = '';
    previewSession = null;
    try {
      await act(
        () => {'kind': 'stop', 'id': id, 'revision': session(id)['revision']},
      );
    } catch (e) {
      setError(() => describe(e));
    }
    busy = false;
    changed();
  }

  Future<void> accept(String id) async {
    setError(null);
    try {
      await act(
        () => {
          'kind': 'accept',
          'id': id,
          'revision': session(id)['revision'],
          'consent': 'accept_context_expression_sense',
        },
      );
    } catch (e) {
      setError(() => describe(e));
    }
    changed();
  }

  String describe(Object e) {
    final code = e is AgentFailure ? e.code : e.toString();
    if (code.contains('secure_storage')) {
      return l10n.uiSecureStorageIsUnavailableUnlockYour;
    }
    if (code.contains('vision')) return l10n.uiChooseAnImageCapableServiceOr;
    if (code.contains('credentials')) {
      return l10n.uiCredentialsAreMissingOrExpiredEnter;
    }
    if (code.contains('budget') || code.contains('limit')) {
      return l10n.uiThisConversationReachedItsRequestLimit;
    }
    if (code.contains('conflict') ||
        code.contains('draft_') ||
        code.contains('superseded') ||
        code.contains('stale')) {
      return l10n.uiTheCaptureOrTaskChangedGo;
    }
    if (code.contains('anchor_recipient')) {
      return l10n.uiSelectTheServiceAuthorizedToReceive;
    }
    if (code.contains('unsupported_content_policy')) {
      return l10n.uiResourcePreparationDoesNotSupportThis;
    }
    if (code.contains('size')) {
      return l10n.uiImagesOrConversationExceedTheRequest;
    }
    if (code.contains('configuration')) {
      return l10n.uiEnterAValidServiceAddressName;
    }
    return l10n.uiThisAttemptDidNotFinishCheck;
  }

  @override
  void dispose() {
    epoch++;
    transport.cancel();
    preview = '';
    previewSession = null;
    providers.clear();
    closed = true;
    super.dispose();
  }
}
