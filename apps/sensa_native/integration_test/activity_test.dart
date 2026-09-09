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
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets('mixed activity, independent check-in, review-only and restart', (
    tester,
  ) async {
    final model = await createLibrary(name: 'activity-$run.sqlite');
    addTearDown(model.dispose);
    final receipt = File('${model.repository.path}.receipt');
    await tester.pumpWidget(MigrationApp(model: model));
    Future<void> wait() async {
      for (var i = 0; i < 600; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        if (!model.busy) {
          await tester.pump(const Duration(milliseconds: 100));
          if (!model.busy) {
            expect(model.error, isNull);
            expect(tester.takeException(), isNull);
            return;
          }
        }
      }
      fail('command timeout');
    }

    Future<void> tap(String label) async {
      final f = find.text(label).last;
      await tester.ensureVisible(f);
      await tester.pumpAndSettle();
      await tester.tap(f);
      await wait();
    }

    if (recovery) {
      expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
      expect(find.text('本次学习已结束'), findsOneWidget);
    } else {
      expect(model.snapshot!.quantity, isNull);
      await tap('确认每日数量');
      await tap('载入验收材料');
      await tap('加入学习');
      model.showHome();
      await wait();
      await tap('开始今天的学习');
      expect(model.snapshot!.learning['checkins'].length, 1);
      expect(
        model.snapshot!.learning['checkins'][0]['source'],
        'formal_learning',
      );
      final firstRun = model.snapshot!.run!['id'];
      await tap('揭示表达');
      await tap('暂停本次学习并返回');
      await tap('只复习');
      expect(model.snapshot!.activity!['executionId'], isNull);
      expect(model.snapshot!.run!['id'], firstRun);
      await tap('回到首页');
      await tap('开始今天的学习');
      expect(model.snapshot!.run!['id'], firstRun);
      await tap('可以继续');
      expect(model.snapshot!.activity!['summary']['distinctTargetCount'], 1);
      await tap('结束本次学习');
      await tap('回到首页');
      await tap('今天已签到');
      expect(model.snapshot!.learning['checkins'].length, 1);
      await tap('学习记录与签到日历');
      expect(find.text('学习记录'), findsOneWidget);
      final record = find.textContaining('混合学习 · 1 个目标');
      await tester.scrollUntilVisible(
        record,
        200,
        scrollable: find
            .descendant(
              of: find.byKey(const ValueKey('learning-records-scroll')),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(record, findsOneWidget);
      Navigator.of(tester.element(record)).pop();
      await tester.pumpAndSettle();
      // Restore the ended activity surface rather than leaving a local-only home flag.
      model.home = false;
      await model.load();
      await wait();
      await receipt.writeAsString(
        jsonEncode(model.snapshot!.value),
        flush: true,
      );
    }
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
