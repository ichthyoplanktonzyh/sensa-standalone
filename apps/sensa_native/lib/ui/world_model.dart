import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/world_repository.dart';

class WorldModel extends ChangeNotifier {
  WorldModel(this.repository);
  final WorldRepository repository;
  Map<String, dynamic>? data;
  String? error;
  bool busy = false, closed = false;
  Future<void> pending = Future.value();
  void changed() {
    if (!closed) notifyListeners();
  }

  Future<void> load() async {
    try {
      data = await repository.load();
      error = null;
    } catch (_) {
      error = '本机资料无法读取，请重试。';
    }
    changed();
  }

  Future<void> act(Map<String, dynamic> Function() action) {
    final next = pending.then((_) async {
      busy = true;
      error = null;
      changed();
      try {
        data = await repository.load();
        final command = {
          'operationId': const Uuid().v4(),
          'libraryId': data!['libraryId'],
          'expectedRevision': data!['revision'],
          'action': {'kind': 'world', 'action': action()},
        };
        try {
          await repository.library.execute(command);
        } catch (_) {
          await repository.library.execute(command);
        }
        data = await repository.load();
      } catch (e) {
        error =
            e.toString().contains('draft_conflict') ||
                e.toString().contains('revision_conflict')
            ? '资料已在别处修改。保留了当前输入，请复制为新草稿或重新打开。'
            : e.toString().contains('frozen')
            ? '已确认的材料不能覆盖，请复制后修改。'
            : e.toString().contains('empty_world')
            ? '请至少保存一段文字、图片或熟悉表达。'
            : '操作未完成，当前输入已保留，请重试。';
      } finally {
        busy = false;
        changed();
      }
    });
    pending = next.catchError((_) {});
    return next;
  }

  @override
  void dispose() {
    closed = true;
    super.dispose();
  }
}
