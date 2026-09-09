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
        notice = '本机已停止接纳旧结果；尚未通知原在线服务，已发送的请求无法收回。';
        _notify();
        continue;
      }
      try {
        await semanticService.cancelPreparation(request);
      } catch (_) {
        notice = '本机已停止接纳旧结果；在线取消通知未成功，服务可能继续处理已收到的内容。';
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
      notice = enabled
          ? '原文授权已保存在本机；请明确准备新的学习材料。'
          : '该原文授权已在本机撤销；使用它的后续材料需重新准备，已开始的学习与历史保留。';
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
              notice = '文字材料已准备好；发音尚未下载，联网后可在揭示表达时重试。';
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

  String? notice;
  final LibraryRepository repository;
  LibrarySnapshot? snapshot;
  bool busy = false;
  bool home = false;
  String? error;
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
    error = null;
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
      error = message(e);
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
    error = null;
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
        notice = '目前没有可开始的到期复习，可以继续新学或稍后再来。';
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
        error = message(e);
      }
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> importPack() async {
    if (busy || _pending != null) return;
    busy = true;
    error = null;
    notice = null;
    _notify();
    String? encoded;
    try {
      encoded = await packReader.pick();
    } catch (e) {
      error = message(e);
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
      error = message(e);
      _notify();
    }
    if (error == null) {
      home = true;
      notice = '材料已导入本机。选择内容后，可单独加入学习。';
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
      notice = '学习方式已保存。已经开始的学习仍使用原来的方式。';
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
      notice = '今天的签到已保存在本机。';
    } catch (e) {
      if (e.toString().contains('revision_conflict')) {
        try {
          snapshot = await repository.load();
          _pendingCheckin!['expectedRevision'] = snapshot!.revision;
        } catch (_) {
          // Keep the separate check-in retry; the learning queue remains usable.
        }
      }
      notice = '签到尚未保存，可以稍后重试；学习可以继续。';
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
      return '请配置已授权的在线服务；更换服务需先撤销并重新授权原文。';
    }
    if (text.contains('learning_material_preparing')) {
      return '后续学习需要新的材料，请先完成准备；已开始的学习可继续。';
    }
    if (text.contains('learning_target_policy_exists')) {
      return '这个语义目标已采用其他学习方式，请关联现有目标后在学习设置中明确修改。';
    }
    if (text.contains('preparation_budget_exhausted')) {
      return '这个目标的三次准备机会已用完，任务与已有资料已保留。';
    }
    if (text.contains('unsupported_content_policy')) {
      return '在线服务暂不能提供此学习方式所需的材料，请明确选择其他方式或等待匹配资源。';
    }
    if (text.contains('preparation_running')) return '上次准备尚在有效期内，请等待或先取消后重试。';
    if (text.contains('invalid_prepared_material')) {
      return '返回材料没有通过本地校验，未进入学习。请重新读取后重试。';
    }
    if (text.contains('preparation_superseded')) {
      return '这个准备请求已经取消或被替代，请查看当前任务。';
    }
    if (text.contains('reference_version_conflict')) {
      return '同一来源版本的内容不能改写，请使用新的资料版本。';
    }
    if (text.contains('reference_digest_mismatch') ||
        text.contains('invalid_reference_source')) {
      return '参考资料的来源、摘要或目标不匹配，未附加资料。';
    }
    if (text.contains('daily_preparation_limit')) return '今天的准备预算已用完，请稍后再试。';
    if (text.contains('attempt_timed_out')) return '准备已超时，资料已保留，请重新读取任务后重试。';
    if (text.contains('quantity_required')) {
      return '加入学习前，请先回首页确认每日新学数量。保存的材料不会丢失。';
    }
    if (text.contains('lookup_expired')) return '候选已过期，请重新读取后再请求解释。';
    if (text.contains('lookup_superseded')) return '这次解释已被替代，请查看最新候选。';
    if (text.contains('lookup_already_exists')) return '已有待处理解释，请从收件箱继续。';
    if (text.contains('invalid_proposal') ||
        text.contains('invalid_provenance') ||
        text.contains('lookup_input_mismatch')) {
      return '解释结果未通过本地校验，没有建立词义。请重新读取后再请求。';
    }
    if (text.contains('lookup_not_ready')) return '解释尚未完成，不能确认词义。';
    if (text.contains('meaning_already_confirmed')) {
      return '这个上下文与表达已经确认，请查看已保存内容。';
    }
    if (text.contains('invalid_occurrence')) return '所选表达需要准确位于原文中，请重新选择。';
    if (text.contains('invalid_capture')) return '请输入有效的英文上下文，并检查材料长度。';
    if (text.contains('invalid_source') ||
        text.contains('invalid_video_source')) {
      return '来源链接或视频定位无效，请检查后再保存。';
    }
    if (text.contains('expression_binding_mismatch')) {
      return '这项词义绑定与所选表达不匹配，请重新选择。';
    }
    if (text.contains('intake_removed') || text.contains('meaning_removed')) {
      return '这份内容已移除，请先从已移除列表恢复。';
    }
    if (text.contains('intake_mismatch') ||
        text.contains('intake_already_confirmed')) {
      return '这份材料的状态已更新，请重新读取后继续。';
    }
    if (text.contains('personal_snapshot_limit')) {
      return '本机当前支持最多 500 份收件材料、500 条词义和 500 次解析记录。';
    }
    if (text.contains('pending_result')) return '请先完成或暂停当前步骤，再继续安排。';
    if (text.contains('activity_not_active')) return '这次学习已暂停或结束，请从首页继续。';
    if (text.contains('undo_across_settlement')) {
      return '这一步已经结算，不能撤销。已保存的复习安排会继续保留。';
    }
    if (text.contains('assurance_journal_mismatch')) {
      return '学习记录校验未通过，请保留本机资料并恢复有效备份。';
    }
    if (text.contains('invalid_runtime_release')) {
      return '学习包的任务或资源校验未通过，原有内容已保留。';
    }
    if (text.contains('pause_activity_before_curriculum_change')) {
      return '请先暂停当前活动，再调整学习来源。';
    }
    if (text.contains('target_outside_study_scope')) {
      return '此项已暂停或不在当前学习来源中，请到学习来源调整。';
    }
    if (text.contains('book_material_not_downloaded')) {
      return '请先下载或导入词书引用的学习材料。';
    }
    if (text.contains('book_version_conflict')) return '同一词书版本内容不一致，原词书已保留。';
    if (text.contains('invalid_curriculum')) return '词书或学习范围无效，请检查文件、序号或所选内容。';
    if (text.contains('invalid_runtime_media')) return '学习包的媒体校验未通过，未导入任何内容。';
    if (text.contains('assurance_session_active')) {
      return '还有一组高保证学习正在进行，请先返回继续或结束。';
    }
    if (text.contains('policy_committed')) return '这项学习已固定方式。修改默认方式不会改写已有学习。';
    if (text.contains('learning_plan_blocked')) {
      return '当前学习方式尚未就绪，请查看原因或在首次学习前更换方式。';
    }
    if (text.contains('unsupported_learning_policy')) return '此学习方式或版本暂不支持。';
    if (text.contains('policy_pin_mismatch')) return '运行的学习方式校验未通过，原有进度已保留。';
    if (text.contains('relearning_waiting')) {
      return '还未到再学习时间，可以稍后继续，或明确选择提前回想。';
    }
    if (text.contains('no_due_review')) return '这项内容还未到复习时间。';
    if (text.contains('stale_due')) return '复习状态已更新，请重新读取后继续。';
    if (text.contains('daily_limit')) {
      return '今天的新学数量已达到设置，可继续已有学习。';
    }
    if (text.contains('pack_too_large')) {
      return '文件或学习包过大。文本包上限 2 MB，含媒体学习包上限 20 MB，请拆分后再导入。';
    }
    if (text.contains('unsupported_pack')) return '此包的版本、协议或语言暂不支持，原有资料不受影响。';
    if (text.contains('pack_version_conflict') ||
        text.contains('material_version_conflict') ||
        text.contains('target_material_conflict')) {
      return '包内版本与已保存材料冲突，未覆盖原有内容。';
    }
    if (text.contains('invalid_optional_resource') ||
        text.contains('invalid_pack') ||
        text.contains('pack_reveals_expression')) {
      return '学习包校验未通过，未导入任何内容。';
    }
    if (text.contains('clock_moved_backwards')) return '设备时间早于上次保存，请校准时间后重试。';
    if (text.contains('revision_conflict') || text.contains('stale_step')) {
      return '学习状态已更新，请重新读取后继续。';
    }
    if (text.contains('material_mismatch')) return '材料校验未通过，当前学习已保留。';
    if (text.contains('unsupported_library_version')) {
      return '此学习库需要更新版本的 Sensa。';
    }
    return '本机操作未完成，当前内容已保留。请重试或重新读取。';
  }
}
