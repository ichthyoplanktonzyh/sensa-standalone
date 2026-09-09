import 'support/migration_app.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'pack_import_test.dart' show TestPackReader, sample;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment(
    'SENSA_NATIVE_RUN',
    defaultValue: 'policy',
  );
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets('policy readiness and commitment survive process restart', (
    tester,
  ) async {
    final base = await createLibrary(name: 'integration-$run.sqlite');
    final model = LibraryViewModel(
      base.repository,
      packReader: TestPackReader()..encoded = sample(),
    );
    base.dispose();
    await model.load();
    addTearDown(model.dispose);
    final receipt = File('${model.repository.path}.receipt.json');
    await tester.pumpWidget(MigrationApp(model: model));
    Future<void> wait(String label) async {
      for (var i = 0; i < 400; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        if (!model.busy && find.text(label).evaluate().isNotEmpty) return;
      }
      fail('Missing $label: ${model.error}');
    }

    Future<void> tap(String label, String next) async {
      await tester.pumpAndSettle();
      final target = find.text(label).last;
      await tester.ensureVisible(target);
      await tester.pumpAndSettle();
      await tester.tap(target);
      await wait(next);
      expect(tester.takeException(), isNull);
    }

    Future<void> choose(String scope, String label) async {
      await tap(scope, scope == '更换此项方式' ? '选择此项学习方式' : '设置默认学习方式');
      await tap(label, '已下载的内容');
      expect(model.error, isNull);
    }

    if (recovery) {
      expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
      expect(model.snapshot!.policyCommitted, isTrue);
      final pin = model.snapshot!.policyPlan;
      await tap('继续学习', '可以继续');
      await tap('可以继续', '本次首学已完成');
      expect(model.snapshot!.policyPlan, pin);
      expect(model.snapshot!.value['completionCount'], 1);
    } else {
      await tap('确认每日数量', '导入学习包');
      await tap('导入学习包', '已下载的内容');
      await choose('默认学习方式', '高保证学习');
      await tap('加入学习', '刷新准备状态');
      expect(find.text('开始学习'), findsNothing);
      expect(model.snapshot!.initialReadiness!['status'], 'blocked');
      await choose('更换此项方式', '轻量学习');
      await tap('开始学习', '揭示表达');
      expect(model.snapshot!.policyCommitted, isTrue);
      final pin = model.snapshot!.policyPlan;
      final runId = model.snapshot!.run!['id'];
      await tap('揭示表达', '可以继续');
      await tap('暂停学习', '继续学习');
      expect(find.text('更换此项方式'), findsNothing);
      await choose('默认学习方式', '交错四阶段学习');
      expect(model.snapshot!.policyPlan, pin);
      expect(model.snapshot!.run!['id'], runId);
      await receipt.writeAsString(
        jsonEncode(model.snapshot!.value),
        flush: true,
      );
    }
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
