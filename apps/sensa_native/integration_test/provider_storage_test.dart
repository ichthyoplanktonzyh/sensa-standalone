import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:sensa_native/data/agent_provider.dart';
import 'package:sensa_native/data/provider_credentials.dart';

class UnavailableCredentials extends ProviderCredentials {
  @override
  Future<String?> read(String id) async => throw StateError('locked');
  @override
  Future<void> write(String id, String value) async =>
      throw StateError('locked');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  testWidgets(
    'OS credential persistence, scoped routing, replacement and deletion',
    (tester) async {
      final root = await getApplicationSupportDirectory();
      final file = File('${root.path}/provider-test-$run.json');
      final p = AgentProviders(file);
      await p.load();
      if (!recovery) {
        await p.save({
          'id': 'teacher-$run',
          'name': '老师',
          'endpoint': 'http://127.0.0.1:4331',
          'model': 'teacher',
          'kind': 'compatible',
          'vision': true,
        }, 'synthetic-secret-$run');
        expect(p.configured, true);
        await p.assign('teacher', 'teacher-$run');
        await p.save({
          'id': 'review-$run',
          'name': '审核',
          'endpoint': 'http://127.0.0.1:4331',
          'model': 'review',
          'kind': 'compatible',
          'vision': false,
        }, 'synthetic-review-$run');
        await p.assign('review', 'review-$run');
        final restored = AgentProviders(file);
        await restored.load();
        expect(restored.credential('teacher-$run'), 'synthetic-secret-$run');
        expect(restored.forPurpose('review')!['id'], 'review-$run');
        expect(await file.readAsString(), isNot(contains('synthetic-secret')));
        expect(await file.readAsString(), isNot(contains('synthetic-review')));
      } else {
        expect(p.credential('teacher-$run'), 'synthetic-secret-$run');
        expect(p.credential('review-$run'), 'synthetic-review-$run');
        final isolated = AgentProviders(
          File('${root.path}/provider-isolated-$run.json'),
        );
        await isolated.load();
        expect(isolated.configured, false);
        final copied = File('${root.path}/provider-copied-$run.json');
        await copied.writeAsString(await file.readAsString());
        final moved = AgentProviders(copied);
        await moved.load();
        expect(
          moved.configured,
          false,
          reason: 'Copied config cannot unlock another library credential',
        );
        final locked = AgentProviders(file, vault: UnavailableCredentials());
        await locked.load();
        expect(locked.configured, false);
        expect(locked.status('teacher-$run'), contains('不可用'));
        final unchanged = await file.readAsString();
        await expectLater(
          locked.save(p.connection(p.current!), 'do-not-persist-$run'),
          throwsA(isA<AgentFailure>()),
        );
        expect(await file.readAsString(), unchanged);
        final old = Map<String, dynamic>.from(p.current!);
        await p.save({...old, 'endpoint': 'http://127.0.0.1:4332'}, '');
        expect(p.configured, false);
        await p.save(old, '');
        expect(
          p.configured,
          false,
          reason: 'Changing back must not recover a deleted credential',
        );
        await p.save(old, 'replacement-$run');
        await p.invalidate(p.connection(p.current!), 'synthetic-secret-$run');
        expect(
          p.configured,
          true,
          reason: 'A stale rejection must not erase a replacement',
        );
        await p.invalidate(p.connection(p.current!), 'replacement-$run');
        expect(p.configured, false);
        await p.save(p.connection(p.current!), '');
        final restored = AgentProviders(file);
        await restored.load();
        expect(restored.configured, false);
        expect(restored.status(old['id']), contains('失效'));
        await restored.remove('review-$run');
        expect(restored.forPurpose('review'), isNull);
        await restored.remove('teacher-$run');
        final empty = AgentProviders(file);
        await empty.load();
        expect(empty.profiles, isEmpty);
        expect(jsonDecode(await file.readAsString())['profiles'], isEmpty);
      }
    },
  );
}
