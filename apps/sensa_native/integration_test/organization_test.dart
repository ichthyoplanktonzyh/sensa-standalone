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
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'local books, ranges, fixed activity, history and cold recovery',
    (tester) async {
      final base = await createLibrary(name: 'organization-$run.sqlite');
      final reader = TestPackReader()..encoded = sample();
      final model = LibraryViewModel(base.repository, packReader: reader);
      base.dispose();
      await model.load();
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.receipt');
      await tester.pumpWidget(NativeApp(model: model));
      Future<void> wait() async {
        for (var i = 0; i < 600; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy) {
            await tester.pumpAndSettle();
            expect(model.error, isNull);
            expect(tester.takeException(), isNull);
            return;
          }
        }
        fail('command timeout');
      }

      Future<void> visible(Finder f) async {
        if (f.evaluate().isEmpty) {
          final list =
              find.byKey(const ValueKey('history-scroll')).evaluate().isNotEmpty
              ? find.byKey(const ValueKey('history-scroll'))
              : find.byKey(const ValueKey('curriculum-scroll'));
          final scrollable = find
              .descendant(of: list, matching: find.byType(Scrollable))
              .first;
          tester.state<ScrollableState>(scrollable).position.jumpTo(0);
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(f, 250, scrollable: scrollable);
        }
        await tester.ensureVisible(f.last);
        await tester.pumpAndSettle();
      }

      Future<void> tap(String label) async {
        final f = find.text(label);
        await visible(f);
        await tester.tap(f.last);
        await wait();
      }

      Future<void> sources() async {
        await tester.tap(find.byTooltip('学习来源'));
        await wait();
      }

      Future<void> back() async {
        await tester.pageBack();
        await wait();
      }

      Map<String, dynamic> getCurriculum() =>
          model.snapshot!.value['curriculum'] as Map<String, dynamic>;
      Future<void> history() async {
        model.showHome();
        await wait();
        await tap('全部学习记录');
        expect(find.text('首次学习 1 · 保持复习 0 · 再学习 0'), findsOneWidget);
        await visible(find.text('tactful · 首次学习'));
        expect(find.text('tactful · 首次学习'), findsOneWidget);
        await tap('今天');
        await visible(find.byKey(const ValueKey('history-kind')));
        await tester.tap(find.byKey(const ValueKey('history-kind')));
        await tester.pumpAndSettle();
        await tap('保持复习');
        expect(find.text('此范围内没有学习记录。可以调整日期或类型。'), findsOneWidget);
        await visible(find.byKey(const ValueKey('history-kind')));
        await tester.tap(find.byKey(const ValueKey('history-kind')));
        await tester.pumpAndSettle();
        await tap('全部类型');
        await visible(find.byKey(const ValueKey('history-search')));
        await tester.tap(find.byKey(const ValueKey('history-search')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const ValueKey('history-search')),
          'borrow',
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('搜索记录'));
        await wait();
        expect(find.text('此范围内没有学习记录。可以调整日期或类型。'), findsOneWidget);
        await visible(find.byKey(const ValueKey('history-search')));
        await tester.tap(find.byKey(const ValueKey('history-search')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const ValueKey('history-search')),
          'tactful',
        );
        expect(
          tester
              .widget<TextField>(find.byKey(const ValueKey('history-search')))
              .controller!
              .text,
          'tactful',
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('搜索记录'));
        await wait();
        await visible(find.text('tactful · 首次学习'));
        expect(find.text('tactful · 首次学习'), findsOneWidget);
        await tap('签到日历 · 1 天');
        await back();
      }

      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        await sources();
        expect(find.text('合成测试包 · 版本 1'), findsOneWidget);
        expect(getCurriculum()['enrollments'][0]['range']['kind'], 'ordinals');
        await back();
        await history();
      } else {
        await tap('确认每日数量');
        await tap('导入学习包');
        await sources();
        reader.encoded = jsonEncode({'format': 'sensa-local-book-v1'});
        await tester.tap(find.text('导入学习包或词书'));
        for (var i = 0; i < 200; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy && model.error != null) break;
        }
        expect(model.error, contains('词书或学习范围无效'));
        reader.encoded = sample();
        await tap('导入学习包或词书');
        await tap('查看与搜索内容');
        await tester.enterText(
          find.byKey(const ValueKey('book-member-search')),
          'borrow',
        );
        await wait();
        expect(find.text('找到 1 项'), findsOneWidget);
        expect(find.text('tactful'), findsNothing);
        await back();
        await tap('设为当前新学词书');
        await tester.tap(find.byType(DropdownButtonFormField<String>).last);
        await tester.pumpAndSettle();
        await tap('按序号');
        await tester.enterText(find.byKey(const ValueKey('range-end')), '0');
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        await tap('保存范围');
        expect(find.text('请选择有效且非空的范围。'), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey('range-end')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const ValueKey('range-end')), '1');
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        await tap('保存范围');
        expect(getCurriculum()['scope']['members'].length, 1);
        final firstRevision = getCurriculum()['scopeRevision'];
        await tap('按当前来源开始新活动');
        expect(model.snapshot!.activity!['scopeRevision'], firstRevision);
        final activity = model.snapshot!.activity!['id'];
        await tap('揭示表达');
        await sources();
        await tap('暂停当前活动以调整');
        await tap('调整未来新学范围');
        await tester.tap(find.byType(DropdownButtonFormField<String>).last);
        await tester.pumpAndSettle();
        await tap('按序号');
        await tester.enterText(find.byKey(const ValueKey('range-start')), '2');
        await tester.tap(find.byKey(const ValueKey('range-end')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const ValueKey('range-end')), '2');
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        await tap('保存范围');
        expect(getCurriculum()['scope']['members'].length, 2);
        expect(model.snapshot!.activity!['id'], activity);
        expect(model.snapshot!.activity!['scopeRevision'], firstRevision);
        await back();
        model.showHome();
        await wait();
        await tap('开始今天的学习');
        expect(model.snapshot!.activity!['id'], activity);
        await tap('可以继续');
        await tap('结束本次学习');
        await tap('回到首页');
        await history();
        await sources();
        await tap('选择学习来源');
        for (final box in find.byType(CheckboxListTile).evaluate().toList()) {
          final widget = box.widget as CheckboxListTile;
          if (widget.value == true) {
            await tester.tap(find.byWidget(widget));
            await tester.pumpAndSettle();
          }
        }
        await tap('应用来源');
        expect(getCurriculum()['scope']['members'], isEmpty);
        await tap('按当前来源开始新活动');
        expect(model.snapshot!.activity!['immediateAvailable'], false);
        await tap('结束本次学习');
        await tap('回到首页');
        await sources();
        await tap('使用全部来源');
        expect(getCurriculum()['scope']['members'].length, 2);
        await back();
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
