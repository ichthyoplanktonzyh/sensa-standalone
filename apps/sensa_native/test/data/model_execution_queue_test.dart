import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/data/model_execution_queue.dart';

void main() {
  test(
    'bounds each provider and all providers; queued cancellation never calls work',
    () async {
      final queue = ModelExecutionQueue();
      final releases = <Completer<void>>[];
      final started = <String>[];
      Future<void> work(String id) async {
        started.add(id);
        final c = Completer<void>();
        releases.add(c);
        await c.future;
      }

      final a = queue.run('one', () => work('a'), cancelled: () => false);
      final b = queue.run('one', () => work('b'), cancelled: () => true);
      final c = queue.run('two', () => work('c'), cancelled: () => false);
      final rejected = expectLater(b, throwsStateError);
      expect(started, ['a', 'c']);
      releases.first.complete();
      await a;
      await rejected;
      expect(started, ['a', 'c']);
      releases.last.complete();
      await c;
    },
  );
}
