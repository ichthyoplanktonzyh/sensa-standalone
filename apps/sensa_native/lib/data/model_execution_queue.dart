import 'dart:async';

/// Device-local admission control; secrets and message payloads are never stored.
class ModelExecutionQueue {
  ModelExecutionQueue({this.maxConcurrent = 2, this.perProvider = 1});
  final int maxConcurrent;
  final int perProvider;
  int _active = 0;
  final _lanes = <String, int>{};
  final _pending = <_Job>[];

  Future<T> run<T>(
    String provider,
    Future<T> Function() work, {
    required bool Function() cancelled,
  }) {
    if (_pending.length >= 64) {
      return Future.error(StateError('model_queue_full'));
    }
    final result = Completer<T>();
    late _Job job;
    final timer = Timer(const Duration(seconds: 45), () {
      if (_pending.remove(job)) {
        result.completeError(TimeoutException('model_timeout'));
        _pump();
      }
    });
    job = _Job(provider, () async {
      timer.cancel();
      try {
        if (cancelled()) throw StateError('model_cancelled');
        result.complete(await work());
      } catch (e, stack) {
        result.completeError(e, stack);
      } finally {
        _active--;
        _lanes[provider] = (_lanes[provider] ?? 1) - 1;
        _pump();
      }
    });
    _pending.add(job);
    _pump();
    return result.future;
  }

  void _pump() {
    while (_active < maxConcurrent) {
      final eligible = _pending.where(
        (j) => (_lanes[j.provider] ?? 0) < perProvider,
      );
      if (eligible.isEmpty) return;
      final job = eligible.first;
      _pending.remove(job);
      _active++;
      _lanes[job.provider] = (_lanes[job.provider] ?? 0) + 1;
      unawaited(job.start());
    }
  }
}

class _Job {
  _Job(this.provider, this.start);
  final String provider;
  final Future<void> Function() start;
}

final nativeModelQueue = ModelExecutionQueue();
