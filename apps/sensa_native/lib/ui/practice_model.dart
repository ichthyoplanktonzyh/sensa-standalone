import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/practice_repository.dart';

class PracticeModel extends ChangeNotifier {
  PracticeModel(this.repository);
  final PracticeRepository repository;
  Map<String, dynamic>? data;
  String? error;
  bool busy = false, disposed = false;
  Future<void> queue = Future.value();
  Map<String, dynamic>? get session =>
      data?['session'] as Map<String, dynamic>?;
  void emit() {
    if (!disposed) notifyListeners();
  }

  Future<void> load() async {
    try {
      data = await repository.load();
      error = null;
    } catch (_) {
      error = '练习记录无法读取，请重试。';
    }
    emit();
  }

  Future<void> act(Map<String, dynamic> Function() action) {
    final result = queue.then((_) async {
      if (disposed) return;
      busy = true;
      error = null;
      emit();
      try {
        final command = {
          'operationId': const Uuid().v4(),
          'libraryId': data!['libraryId'],
          'expectedRevision': data!['revision'],
          'action': action(),
        };
        // Retry uncertain bridge/I/O failures with exactly the same operation identity.
        try {
          data = await repository.execute(command);
        } catch (_) {
          data = await repository.execute(command);
        }
        data = await repository.load();
      } catch (e) {
        error = e.toString().contains('empty_scope')
            ? '当前范围没有可练习的表达。'
            : e.toString().contains('provider_unavailable')
            ? '播放器暂不可用，请重试。'
            : '练习操作未完成，请重新读取后重试。';
      } finally {
        busy = false;
        emit();
      }
    });
    queue = result.catchError((_) {});
    return result;
  }

  Future<void> turn(Map<String, dynamic> event) => act(
    () => {
      'kind': 'turn',
      'session_id': session!['id'],
      'ordinal': session!['state']['ordinal'],
      'event': event,
    },
  );
  @override
  void dispose() {
    disposed = true;
    super.dispose();
  }
}
