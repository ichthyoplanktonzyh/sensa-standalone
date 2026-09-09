import '../data/semantic_service.dart';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/library_repository.dart';
import '../data/pack_file_reader.dart';

class LibraryViewModel extends ChangeNotifier {
  LibraryViewModel(this.repository, {PackFileReader? packReader})
    : packReader = packReader ?? const PackFileReader();
  final PackFileReader packReader;
  final semanticService = SemanticService();
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
        structured
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
    final wasHome = home;
    await act({'kind': 'personal', 'action': action});
    home = wasHome;
    _notify();
  }

  String message(Object error) {
    final text = error.toString();
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
    if (text.contains('invalid_pack') ||
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
