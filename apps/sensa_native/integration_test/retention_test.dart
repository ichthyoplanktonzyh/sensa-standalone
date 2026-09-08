import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'retention_fixture.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment(
    'SENSA_NATIVE_RUN',
    defaultValue: 'retention',
  );
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    recovery
        ? 'restore waiting and finish relearning'
        : 'due review and durable waiting',
    (tester) async {
      final model = await createLibrary(name: 'integration-$run.sqlite');
      addTearDown(model.dispose);
      final file = File(model.repository.path);
      final receipt = File('${file.path}.receipt.json');
      if (!recovery) {
        expect(
          model.snapshot!.catalog,
          isEmpty,
          reason: 'Use a fresh acceptance name; never overwrite existing data.',
        );
        await file.writeAsBytes(
          gzip.decode(base64Decode(retentionFixture)),
          flush: true,
        );
      }
      await model.load();
      await tester.pumpWidget(NativeApp(model: model));
      Future<void> wait(String label) async {
        for (var i = 0; i < 400; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy && model.error == label) {
            await tester.scrollUntilVisible(find.text(label), 250);
            return;
          }
          if (!model.busy && find.text(label).evaluate().isNotEmpty) return;
        }
        fail('Missing $label: ${model.error}');
      }

      Future<void> tap(String label, String next) async {
        await tester.pumpAndSettle();
        final finder = find.text(label).last;
        if (finder.evaluate().isEmpty) {
          await tester.scrollUntilVisible(finder, 250);
        }
        await tester.ensureVisible(finder);
        await tester.pumpAndSettle();
        await tester.tap(finder);
        await wait(next);
        expect(tester.takeException(), isNull);
      }

      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        final before = model.snapshot!;
        final runId = before.run!['id'];
        await wait('稍后再回想');
        await tap('提前回想', '揭示表达');
        expect(model.snapshot!.run!['id'], runId);
        expect(find.text('tactful'), findsNothing);
        await tap('揭示表达', '可以继续');
        await tap('可以继续', '本次再学习已完成');
        expect(model.snapshot!.dueAtMs, before.dueAtMs);
        expect(model.snapshot!.retention['reviewCount'], 1);
        expect(model.snapshot!.retention['relearningCount'], 1);
        expect(model.snapshot!.retention['pendingCount'], 0);
        expect(model.snapshot!.value['progress']['state']['completed'], isTrue);
        expect(
          model.snapshot!.value['progress']['state']['protocolRunId'],
          runId,
        );
        expect(
          model.snapshot!.value['progress']['revision'],
          model.snapshot!.run!['attemptCount'],
        );
        expect(model.snapshot!.value['handoffCount'], 1);
      } else {
        await wait('本次首学已完成');
        await tap('回到首页', '只复习');
        await tap('只复习', '揭示表达');
        expect(find.text('到期复习'), findsOneWidget);
        expect(find.text('tactful'), findsNothing);
        await tap('暂停学习', '继续学习');
        final runId = model.snapshot!.run!['id'];
        await tap('只复习', '揭示表达');
        expect(model.snapshot!.run!['id'], runId);
        await tap('揭示表达', '再回想');
        await tap('再回想', '稍后再回想');
        expect(model.snapshot!.retention['reviewCount'], 1);
        final due = model.snapshot!.dueAtMs;
        final eligible = model.snapshot!.nextEligibleAtMs;
        await tap('结束本次', '只复习');
        await tap('只复习', '稍后再回想');
        expect(model.snapshot!.nextEligibleAtMs, eligible);
        await tap('到时继续', '还未到再学习时间，可以稍后继续，或明确选择提前回想。');
        await tap('重新读取', '提前回想');
        await tap('提前回想', '揭示表达');
        expect(find.text('再次学习'), findsOneWidget);
        await tap('揭示表达', '再回想');
        await tap('再回想', '稍后再回想');
        expect(model.snapshot!.phase, 'waiting');
        expect(
          model.snapshot!.nextEligibleAtMs!,
          greaterThanOrEqualTo(eligible!),
        );
        expect(model.snapshot!.dueAtMs, due);
        expect(model.snapshot!.retention['reviewCount'], 1);
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      expect(tester.takeException(), isNull);
    },
  );
}
