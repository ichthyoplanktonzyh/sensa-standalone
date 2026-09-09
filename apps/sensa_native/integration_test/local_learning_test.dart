import 'support/migration_app.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const runId = String.fromEnvironment(
    'SENSA_NATIVE_RUN',
    defaultValue: 'local',
  );
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    recovery
        ? 'cold process restores the committed local result'
        : 'Flutter commits initial learning through Rust and SQLite',
    (tester) async {
      final model = await createLibrary(name: 'integration-$runId.sqlite');
      final receipt = File('${model.repository.path}.receipt.json');
      addTearDown(model.dispose);
      await tester.pumpWidget(MigrationApp(model: model));
      Future<void> waitFor(String label) async {
        for (var i = 0; i < 400; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy && find.text(label).evaluate().isNotEmpty) return;
        }
        fail('Timed out waiting for $label; error=${model.error}');
      }

      Future<void> tap(String label, String next) async {
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text(label));
        await tester.pumpAndSettle();
        await tester.tap(find.text(label));
        await waitFor(next);
        expect(model.error, isNull);
        expect(tester.takeException(), isNull);
      }

      if (recovery) {
        final expected =
            jsonDecode(await receipt.readAsString()) as Map<String, dynamic>;
        expect(model.snapshot!.value, equals(expected));
        await waitFor('本次首学已完成');
        expect(find.text('tactful'), findsOneWidget);
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.value['handoffCount'], 1);
      } else {
        expect(
          model.snapshot!.quantity,
          isNull,
          reason: 'Use a fresh SENSA_NATIVE_RUN for each acceptance run',
        );
        await tap('确认每日数量', '载入验收材料');
        await tap('载入验收材料', '加入学习');
        expect(model.snapshot!.enrolled, isFalse);
        await tap('加入学习', '开始学习');
        await tap('开始学习', '揭示表达');
        expect(
          find.text('tactful'),
          findsNothing,
          reason: 'Recall must not reveal expression',
        );
        await tap('揭示表达', '再回想');
        expect(find.text('tactful'), findsOneWidget);
        await tap('再回想', '揭示表达');
        expect(model.snapshot!.value['completionCount'], 0);
        await tap('暂停学习', '继续学习');
        await tap('继续学习', '揭示表达');
        await tap('揭示表达', '可以继续');
        await tap('可以继续', '本次首学已完成');
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.value['handoffCount'], 1);
        expect(model.snapshot!.dueAtMs, isNotNull);
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
