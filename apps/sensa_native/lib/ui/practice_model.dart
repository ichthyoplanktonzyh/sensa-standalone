import '../l10n/interface_locale.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/practice_repository.dart';

class PracticeModel extends ChangeNotifier {
  PracticeModel(this.repository);
  final PracticeRepository repository;
  Map<String, dynamic>? data;
  String Function()? _error;
  String? get error => _error?.call();
  void setError(String Function()? value) => _error = value;
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
      setError(null);
    } catch (_) {
      setError(() => l10n.uiCouldNotReadPracticeHistoryRetry);
    }
    emit();
  }

  Future<void> act(Map<String, dynamic> Function() action) {
    final result = queue.then((_) async {
      if (disposed) return;
      busy = true;
      setError(null);
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
        setError(
          () => e.toString().contains('empty_scope')
              ? l10n.uiNoExpressionsToPracticeInThis
              : e.toString().contains('provider_unavailable')
              ? l10n.uiPlayerUnavailableRetry
              : l10n.uiPracticeActionFailedReloadAndRetry,
        );
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
