import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/pack_file_reader.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';

class TestPackReader extends PackFileReader {
  String? encoded;
  @override
  Future<String?> pick() async => encoded;
}

String sample() => jsonEncode({
  'format': 'sensa-local-text-pack-v1',
  'id': 'integration-pack',
  'version': '1',
  'title': '合成测试包',
  'protocolVersion': 'consumer-initial-v1',
  'targetLanguageTag': 'en',
  'familiarLanguageTag': 'zh-CN',
  'learnerLocale': 'zh-CN',
  'materials': [
    for (var i = 1; i <= 2; i++)
      {
        'id': '00000000-0000-4000-8000-00000000000$i',
        'senseVersionId': '10000000-0000-4000-8000-00000000000$i',
        'bindingVersionId': '20000000-0000-4000-8000-00000000000$i',
        'scene': i == 1 ? '你向同事解释方案的问题，也照顾他的感受。' : '你的笔没水了，借同桌的笔暂用，下课归还。',
        'sense': i == 1 ? '表达意见时照顾对方感受。' : '暂时取得他人的东西使用，并打算归还。',
        'expression': i == 1 ? 'tactful' : 'borrow',
        'source': '合成集成测试材料',
        if (i == 1)
          'resources': [
            {
              'materialRoleKey': 'recall_support',
              'contentPayload': {'text': '想想对方的感受'},
            },
            {
              'materialRoleKey': 'language_structure',
              'contentPayload': {
                'expressionKind': 'word',
                'expressionTypeLabel': '单词',
                'partOfSpeech': '形容词',
              },
            },
            {
              'materialRoleKey': 'usage_guidance',
              'contentPayload': {'example': 'She was tactful.'},
            },
            {
              'materialRoleKey': 'scene_bridge',
              'contentPayload': {'text': '联系刚才的场景。'},
            },
          ],
      },
  ],
});
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment(
    'SENSA_NATIVE_RUN',
    defaultValue: 'pack-local',
  );
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    recovery
        ? 'reopen imported targets'
        : 'import and resume independent targets',
    (tester) async {
      final base = await createLibrary(name: 'integration-$run.sqlite');
      final reader = TestPackReader();
      final model = LibraryViewModel(base.repository, packReader: reader);
      base.dispose();
      await model.load();
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.receipt.json');
      await tester.pumpWidget(NativeApp(model: model));
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

      Future<void> select(String expression) async {
        await tap('选择其他内容', '选择学习内容');
        final target = find.widgetWithText(ListTile, expression);
        await tester.ensureVisible(target);
        await tester.pumpAndSettle();
        await tester.tap(target);
        for (var i = 0; i < 100; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy &&
              model.snapshot!.material!['expression'] == expression) {
            break;
          }
        }
        expect(model.error, isNull);
        expect(model.snapshot!.material!['expression'], expression);
      }

      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        await wait('本次首学已完成');
        expect(model.snapshot!.catalog.length, 2);
        expect(
          model.snapshot!.catalog.firstWhere(
            (v) => v['material']['expression'] == 'tactful',
          )['material']['resources'],
          hasLength(4),
        );
        expect(model.snapshot!.value['completionCount'], 2);
      } else {
        expect(model.snapshot!.quantity, isNull);
        await tap('确认每日数量', '导入学习包');
        await tap('导入学习包', '导入学习包');
        expect(model.snapshot!.catalog, isEmpty);
        reader.encoded = '{}';
        await tap('导入学习包', '学习包校验未通过，未导入任何内容。');
        expect(model.snapshot!.catalog, isEmpty);
        await tap('重新读取', '导入学习包');
        reader.encoded = sample();
        await tap('导入学习包', '已下载的内容');
        expect(model.snapshot!.catalog.length, 2);
        expect(model.snapshot!.enrolled, isFalse);
        expect(model.snapshot!.value['completionCount'], 0);
        await tap('加入学习', '开始学习');
        await tap('开始学习', '揭示表达');
        expect(find.text('tactful'), findsNothing);
        expect(find.text('想想对方的感受'), findsOneWidget);
        expect(find.text('She was tactful.'), findsNothing);
        expect(find.text('语言结构'), findsNothing);
        expect(find.text('联系刚才的场景。'), findsNothing);
        await tap('揭示表达', '可以继续');
        expect(find.text('She was tactful.'), findsOneWidget);
        expect(find.text('语言结构'), findsOneWidget);
        expect(find.text('联系刚才的场景。'), findsOneWidget);
        expect(find.text('想想对方的感受'), findsNothing);
        await tap('暂停学习', '继续学习');
        final firstRun = model.snapshot!.run!['id'];
        await select('borrow');
        expect(model.snapshot!.enrolled, isFalse);
        await tap('加入学习', '开始学习');
        await tap('开始学习', '揭示表达');
        expect(find.text('borrow'), findsNothing);
        await tap('揭示表达', '可以继续');
        await tap('可以继续', '本次首学已完成');
        await tap('回到首页', '已下载的内容');
        await select('tactful');
        expect(model.snapshot!.run!['id'], firstRun);
        await tap('继续学习', '可以继续');
        await tap('可以继续', '本次首学已完成');
        expect(model.snapshot!.value['completionCount'], 2);
        expect(model.snapshot!.value['handoffCount'], 2);
        await tap('回到首页', '导入学习包');
        await tap('导入学习包', '已下载的内容');
        expect(model.snapshot!.catalog.length, 2);
        expect(model.snapshot!.value['completionCount'], 2);
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
