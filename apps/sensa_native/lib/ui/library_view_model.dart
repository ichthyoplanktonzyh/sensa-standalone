import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/library_repository.dart';

class LibraryViewModel extends ChangeNotifier {
  LibraryViewModel(this.repository);
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
      error = message(e);
    } finally {
      busy = false;
      _notify();
    }
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

  void showHome() {
    home = true;
    _notify();
  }

  String message(Object error) {
    final text = error.toString();
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
