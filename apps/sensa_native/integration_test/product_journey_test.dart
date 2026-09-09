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
  WidgetController.hitTestWarningShouldBeFatal = true;
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'formal navigation → import/enrollment → local study → semantic intake and recovery',
    (tester) async {
      expect(run, isNotEmpty, reason: 'Use a unique isolated run ID');
      final base = await createLibrary(name: 'product-$run.sqlite');
      final reader = TestPackReader();
      final model = LibraryViewModel(base.repository, packReader: reader);
      base.dispose();
      await model.load();
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.product-receipt');
      await tester.pumpWidget(NativeApp(model: model));
      Future<void> wait() async {
        for (var i = 0; i < 300; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy) break;
        }
        expect(model.busy, false);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      Future<void> tap(Finder finder) async {
        if (finder.evaluate().isEmpty) {
          final scroll = find.byType(Scrollable).first;
          await tester.drag(scroll, const Offset(0, 1500));
          await tester.pumpAndSettle();
          if (finder.evaluate().isEmpty) {
            await tester.scrollUntilVisible(
              finder,
              200,
              scrollable: scroll,
              maxScrolls: 30,
            );
          }
        }
        await tester.ensureVisible(finder);
        await tester.pumpAndSettle();
        await tester.tap(finder);
        await wait();
      }

      Future<void> text(String key, String value) async {
        final f = find.byKey(ValueKey(key));
        await tester.ensureVisible(f);
        await tester.enterText(f, value);
        await wait();
      }

      await wait();
      expect(find.text('载入验收材料'), findsNothing);
      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        await tap(find.byKey(const ValueKey('nav-2')));
        expect(find.text('tactful'), findsOneWidget);
        expect(model.snapshot!.value['completionCount'], 1);
        await tap(find.byKey(const ValueKey('nav-1')));
        await tap(find.text('我的词义世界'));
        expect(find.text('已保存'), findsOneWidget);
        expect(model.snapshot!.personal['meanings'].length, 1);
      } else {
        expect(model.snapshot!.quantity, isNull);
        await tap(find.text('确认每日数量'));
        expect(find.text('今天，连接新的意义'), findsOneWidget);
        await tap(find.byKey(const ValueKey('nav-2')));
        final original = model.snapshot!.revision;
        await tap(find.text('导入学习包')); // OS picker cancellation substitute.
        expect(model.snapshot!.revision, original);
        reader.encoded = 'not json';
        await tap(find.text('导入学习包'));
        expect(model.error, isNotNull);
        expect(model.snapshot!.catalog, isEmpty);
        await tap(find.text('重新读取'));
        reader.encoded = sample();
        await tap(find.text('导入学习包'));
        expect(model.error, isNull);
        expect(
          model.snapshot!.catalog.every((e) => e['enrolled'] != true),
          true,
        );
        await text('library-search', 'tactful');
        await tap(
          find.byKey(
            const ValueKey('material-00000000-0000-4000-8000-000000000001'),
          ),
        );
        expect(find.text('载入验收材料'), findsNothing);
        await tap(find.text('加入学习'));
        await tap(find.text('更换此项方式'));
        await tap(find.text('轻量学习'));
        await tap(find.text('开始学习'));
        expect(find.text('tactful'), findsNothing);
        await tap(find.text('揭示表达'));
        await tap(find.text('再回想'));
        expect(model.snapshot!.value['completionCount'], 0);
        await tap(find.text('揭示表达'));
        await tap(find.text('可以继续'));
        expect(find.text('本次首学已完成'), findsOneWidget);
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.value['handoffCount'], 1);
        await tap(find.text('回到首页'));
        await tap(find.byKey(const ValueKey('nav-1')));
        await tap(find.text('我的词义世界'));
        await tap(find.text('保存材料'));
        await text('capture-context', 'May I borrow your umbrella?');
        await tap(find.text('先保存到收件箱'));
        await tap(find.text('收件箱'));
        await tap(find.text('选择表达与词义'));
        await text('capture-expression', 'borrow');
        await tap(
          find.byKey(
            const ValueKey('sense-00000000-0000-4000-8000-000000000002'),
          ),
        );
        await tap(find.text('确认词义并保存'));
        expect(model.snapshot!.personal['meanings'].length, 1);
        expect(model.snapshot!.personal['meanings'][0]['focus'], isNull);
        expect(
          model.snapshot!.catalog.where((e) => e['enrolled'] == true).length,
          1,
          reason: 'Semantic acceptance must not enroll borrow',
        );
        await tester.pageBack();
        await wait();
        await tap(find.text('图文与语义关系'));
        expect(find.text('图文与语义关系'), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.text('学习准备'));
        expect(find.text('学习准备'), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.text('采集接入'));
        expect(find.text('导入采集请求'), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.byKey(const ValueKey('nav-2')));
        await tap(find.text('全部学习记录'));
        expect(find.text('学习记录'), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.text('学习来源'));
        expect(find.text('学习来源'), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(
          find.byKey(const ValueKey('nav-4')).evaluate().isNotEmpty
              ? find.byKey(const ValueKey('nav-4'))
              : find.byTooltip('设置'),
        );
        await tap(find.text('每日新学数量'));
        await tap(find.text('10'));
        await tap(find.text('保存数量'));
        expect(model.snapshot!.quantity, 10);
        await tap(find.text('模型服务'));
        await tap(find.text('添加模型服务'));
        await tap(find.text('取消'));
        expect(model.agents.providers.profiles, isEmpty);
        await tester.pageBack();
        await wait();
        final beforePractice = model.snapshot!.value;
        await tap(find.byKey(const ValueKey('nav-3')));
        expect(find.text('自由练习'), findsOneWidget);
        await tap(find.text('选择练习范围'));
        await tap(find.text('取消'));
        // Formal tab's BackButton must return home, never pop the root route.
        await tap(find.byType(BackButton));
        expect(find.text('今天，连接新的意义'), findsOneWidget);
        await model.load();
        await wait();
        expect(
          model.snapshot!.value,
          beforePractice,
          reason: 'Browsing practice must not change formal learning facts',
        );
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
