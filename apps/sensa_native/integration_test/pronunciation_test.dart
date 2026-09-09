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
  testWidgets('static pronunciation, text fallback and offline cold playback', (
    tester,
  ) async {
    final model = await createLibrary(name: 'pronunciation-$run.sqlite');
    addTearDown(model.dispose);
    final receipt = File('${model.repository.path}.receipt');
    await tester.pumpWidget(NativeApp(model: model));
    Future<void> wait() async {
      for (var i = 0; i < 1800; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        if (!model.busy && !model.semanticBusy && !model.provisioningBusy) {
          await tester.pumpAndSettle();
          if (!model.busy && !model.semanticBusy && !model.provisioningBusy) {
            expect(model.error, isNull);
            expect(tester.takeException(), isNull);
            return;
          }
        }
      }
      fail('preparation timeout');
    }

    Finder scroll() {
      for (final key in [
        'preparation-scroll',
        'semantic-scroll',
        'capture-scroll',
        'personal-items',
      ]) {
        final f = find.byKey(ValueKey(key));
        if (f.evaluate().isNotEmpty) {
          return find
              .descendant(of: f, matching: find.byType(Scrollable))
              .first;
        }
      }
      return find.byType(Scrollable).last;
    }

    Future<void> visible(Finder f) async {
      if (f.evaluate().isEmpty) {
        await tester.scrollUntilVisible(f, 180, scrollable: scroll());
      }
      await tester.ensureVisible(f);
      await tester.pumpAndSettle();
    }

    Future<void> tap(Finder f) async {
      await visible(f);
      await tester.tap(f);
      await wait();
    }

    Future<void> text(String key, String value) async {
      final f = find.byKey(ValueKey(key));
      await visible(f);
      await tester.tap(f);
      await tester.pumpAndSettle();
      await tester.enterText(f, value);
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(f).controller!.text, value);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
    }

    Future<void> capture(String expression) async {
      await tap(find.byTooltip('我的词义世界'));
      await tap(find.text('保存材料'));
      await text('capture-context', 'A person is $expression');
      await text('capture-expression', expression);
      await tap(find.text('在线解释这个表达'));
      await tap(find.text('请求解释'));
      await tap(find.text('确认词义并保存到本机'));
      await tap(find.text('加入学习'));
      await tap(find.text('确认加入学习'));
      await tap(find.text('开始准备材料'));
      expect(
        model.preparations.firstWhere(
          (t) => t['target']['proposal']['expression']['surface'] == expression,
        )['status'],
        'ready',
      );
      await tap(find.text('回到学习入口'));
      await tap(find.text('开始学习'));
      expect(find.byKey(const ValueKey('pronunciation-play')), findsNothing);
      await tap(find.text('揭示表达'));
    }

    Future<void> audioReady() async {
      for (var i = 0; i < 400; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        if (find.text('播放发音').evaluate().isNotEmpty) return;
      }
      fail('audio did not become ready');
    }

    Future<void> play() async {
      await audioReady();
      final before = jsonEncode(model.snapshot!.value);
      await tap(find.byKey(const ValueKey('pronunciation-play')));
      for (var i = 0; i < 400; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        if (find.text('发音播放完成').evaluate().isNotEmpty) break;
      }
      expect(
        find.text('发音播放完成'),
        findsOneWidget,
        reason: tester
            .widget<Text>(find.byKey(const ValueKey('pronunciation-status')))
            .data,
      );
      expect(jsonEncode(model.snapshot!.value), before);
    }

    if (recovery) {
      expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
      expect(model.semanticService.configured, isFalse);
      await play();
      await tap(find.text('可以继续'));
      expect(model.snapshot!.value['completionCount'], 4);
      expect(model.snapshot!.value['handoffCount'], 4);
    } else {
      model.semanticService.configure(
        'http://127.0.0.1:4326',
        'local-native-test',
      );
      await model.act({'kind': 'confirm_quantity', 'quantity': 5});
      await wait();
      await capture('broken');
      expect(find.textContaining('发音暂不可用'), findsOneWidget);
      await tap(find.text('重试下载发音'));
      expect(find.textContaining('发音暂不可用'), findsOneWidget);
      await tap(find.text('可以继续'));
      expect(model.snapshot!.value['completionCount'], 1);
      await capture('missing');
      expect(
        find.byKey(const ValueKey('pronunciation-absent')),
        findsOneWidget,
      );
      await tap(find.text('可以继续'));
      await capture('invalid');
      await audioReady();
      await tap(find.byKey(const ValueKey('pronunciation-play')));
      for (var i = 0; i < 400; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        if (find.textContaining('发音无法播放').evaluate().isNotEmpty) break;
      }
      expect(
        find.textContaining('发音无法播放'),
        findsOneWidget,
        reason: tester
            .widget<Text>(find.byKey(const ValueKey('pronunciation-status')))
            .data,
      );
      await tap(find.text('可以继续'));
      await capture('tactful');
      await play();
      await tap(find.text('再回想'));
      expect(find.byKey(const ValueKey('pronunciation-play')), findsNothing);
      await tap(find.text('揭示表达'));
      model.semanticService.clear();
      await play();
      await receipt.writeAsString(
        jsonEncode(model.snapshot!.value),
        flush: true,
      );
    }
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
