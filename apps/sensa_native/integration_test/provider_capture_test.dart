import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/ui/agent_screen.dart';
import 'package:sensa_native/ui/semantic_resolution_screen.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'captured occurrence uses teacher, rejects invalid access and explicitly accepts locally',
    (tester) async {
      final library = await createLibrary(name: 'provider-capture-$run.sqlite');
      addTearDown(library.dispose);
      final c = library.agents;
      final capture = <String, dynamic>{
        'sentence': 'Please lend me your umbrella.',
        'language': 'en',
        'expression': {'text': 'lend', 'start': 7, 'end': 11},
        'source': {
          'url': 'https://example.com/reading',
          'title': 'original source',
          'capturedAt': '2026-09-09T00:00:00Z',
        },
      };
      await library.act({
        'kind': 'personal',
        'action': {'kind': 'save_intake', 'snapshot': capture},
      });
      final intake = library.snapshot!.personal['intakes'].single['id'];
      final provider = <String, dynamic>{
        'id': 'teacher-$run',
        'name': '测试老师',
        'endpoint': 'http://127.0.0.1:4331',
        'model': 'fixture',
        'kind': 'sensa',
        'vision': false,
      };
      await c.providers.save(provider, 'invalid-synthetic-key');
      Future<void> settle() async {
        for (var i = 0; i < 20; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        for (var i = 0; i < 300 && c.busy; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(c.busy, false);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      Future<void> tap(String label) async {
        final f = find.text(label);
        if (f.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            f,
            150,
            scrollable: find.byType(Scrollable).last,
            maxScrolls: 30,
          );
        }
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await settle();
      }

      await tester.pumpWidget(
        MaterialApp(
          home: SemanticResolutionScreen(
            model: library,
            capture: capture,
            intakeId: intake,
          ),
        ),
      );
      await settle();
      await tap('请求解释');
      expect(find.byType(AgentScreen), findsOneWidget);
      await tap('发送材料，开始交流');
      expect(c.providers.configured, false);
      expect(c.providers.status(provider['id']), contains('失效'));
      expect(c.error, isNotNull);
      expect((await library.repository.load()).personal['meanings'], isEmpty);
      await c.providers.save(provider, 'fixture-access');
      final id = c.sessions.single['id'] as String;
      await c.run(id);
      await settle();
      expect(c.error, isNull);
      expect(c.session(id)['status'], 'waiting');
      await tester.enterText(
        find.byKey(const ValueKey('agent-reply')),
        '把自己的东西给别人用。',
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await settle();
      await tap('发送补充');
      expect(c.session(id)['status'], 'proposal', reason: c.error);
      expect((await library.repository.load()).personal['meanings'], isEmpty);
      await tap('就是这个意思，保存');
      expect(c.error, isNull);
      final snapshot = await library.repository.load();
      final meaning = snapshot.personal['meanings'].single;
      expect(meaning['snapshot'], capture);
      expect(
        meaning['resolutionProvenance']['generator']['policyVersion'],
        'language-teacher-v1',
      );
      expect(meaning['focus'], isNull);
      expect(meaning['addedToLearning'], false);
      expect(snapshot.personal['intakes'].single['meaningId'], meaning['id']);
      expect(snapshot.catalog, isEmpty);
      expect(snapshot.run, isNull);
      await c.providers.remove(provider['id']);
    },
  );
}
