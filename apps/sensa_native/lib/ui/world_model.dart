import '../l10n/interface_locale.dart';
import 'agent_controller.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/world_repository.dart';

class WorldModel extends ChangeNotifier {
  WorldModel(this.repository, {required this.agents});
  final AgentController agents;
  final WorldRepository repository;
  Map<String, dynamic>? data;
  String Function()? _error;
  String? get error => _error?.call();
  void setError(String Function()? value) => _error = value;
  bool busy = false, closed = false;
  Future<void> pending = Future.value();
  void changed() {
    if (!closed) notifyListeners();
  }

  Future<void> load() async {
    try {
      data = await repository.load();
      setError(null);
    } catch (_) {
      setError(() => l10n.uiCouldNotReadYourLibraryRetry);
    }
    changed();
  }

  Future<void> act(Map<String, dynamic> Function() action) {
    final next = pending.then((_) async {
      busy = true;
      setError(null);
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
        setError(
          () =>
              e.toString().contains('draft_conflict') ||
                  e.toString().contains('revision_conflict')
              ? l10n.uiThisContentChangedElsewhereYourInput
              : e.toString().contains('frozen')
              ? l10n.uiConfirmedContentCannotBeOverwrittenMake
              : e.toString().contains('empty_world')
              ? l10n.uiAddTextAnImageOrA
              : l10n.uiCouldNotCompleteTheActionYour,
        );
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
