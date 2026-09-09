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
  testWidgets(
    'online resolution, clarification, failure and offline local acceptance',
    (tester) async {
      final model = await createLibrary(name: 'semantic-$run.sqlite');
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.receipt');
      await tester.pumpWidget(NativeApp(model: model));
      Future<void> wait() async {
        for (var i = 0; i < 1200; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy && !model.semanticBusy) {
            await tester.pumpAndSettle();
            if (!model.busy && !model.semanticBusy) {
              expect(model.error, isNull);
              expect(tester.takeException(), isNull);
              return;
            }
          }
        }
        fail('semantic command timeout');
      }

      Future<void> tap(Finder f) async {
        if (f.evaluate().isEmpty) {
          final scroll =
              find
                  .byKey(const ValueKey('semantic-scroll'))
                  .evaluate()
                  .isNotEmpty
              ? find.byKey(const ValueKey('semantic-scroll'))
              : find.byKey(const ValueKey('capture-scroll'));
          await tester.scrollUntilVisible(
            f,
            180,
            scrollable: find
                .descendant(of: scroll, matching: find.byType(Scrollable))
                .first,
          );
        }
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await wait();
      }

      Future<void> text(String key, String value) async {
        final f = find.byKey(ValueKey(key));
        if (f.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            f,
            180,
            scrollable: find
                .descendant(
                  of: find.byKey(const ValueKey('semantic-scroll')),
                  matching: find.byType(Scrollable),
                )
                .first,
          );
        }
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await tester.pumpAndSettle();
        await tester.enterText(f, value);
        await tester.pumpAndSettle();
        expect(tester.widget<TextField>(f).controller!.text, value);
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        expect(tester.widget<TextField>(f).controller!.text, value);
      }

      Future<void> capture(String sentence, String expression) async {
        await tap(find.text('保存材料'));
        await text('capture-context', sentence);
        await text('capture-expression', expression);
        await tap(find.text('在线解释这个表达'));
      }

      await tap(find.byTooltip('我的词义世界'));
      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        expect(model.semanticService.configured, isFalse);
        await tap(find.text('收件箱'));
        await tap(find.text('待确认：tactful'));
        expect(find.text('配置在线服务'), findsOneWidget);
        await tap(find.text('确认词义并保存到本机'));
        expect(model.snapshot!.personal['meanings'], hasLength(3));
        expect(model.snapshot!.run, isNull);
      } else {
        await capture('She was tactful.', 'tactful');
        await tap(find.text('配置在线服务'));
        await text('semantic-origin', 'http://127.0.0.1:4323');
        await text('semantic-token', 'local-native-test');
        await tap(find.text('使用此服务'));
        await tap(find.text('请求解释'));
        expect(model.lookups.single['focus'], isNull);
        expect(model.snapshot!.personal['meanings'], isEmpty);
        await tap(find.text('确认词义并保存到本机'));
        expect(model.snapshot!.personal['meanings'], hasLength(1));
        expect(find.text('学习材料尚未准备'), findsOneWidget);
        await capture('The crane lifted it.', 'crane');
        await tap(find.text('请求解释'));
        expect(model.lookups.first['status'], 'unresolved');
        await text('semantic-focus', 'simulate failure');
        await tap(find.text('按关注点重新解释'));
        expect(model.lookups.first['status'], 'failed');
        await text('semantic-focus', 'lifting machine');
        await tap(find.text('按关注点重新解释'));
        expect(model.lookups.first['status'], 'ready');
        expect(model.lookups.first['focus']['text'], 'lifting machine');
        await tap(find.text('确认词义并保存到本机'));
        expect(model.snapshot!.personal['meanings'], hasLength(2));
        // Leave a valid unaccepted result for a separate process with no service credentials.
        await capture('He was tactful.', 'tactful');
        await tap(find.text('请求解释'));
        expect(model.lookups.first['status'], 'ready');
        await tap(find.byType(BackButton).first);
        await tap(find.byType(BackButton).first);
        await tap(find.text('收件箱'));
        expect(find.text('待确认：tactful'), findsOneWidget);
        expect(model.snapshot!.run, isNull);
        expect(
          model.snapshot!.personal['meanings'].every(
            (m) => m['addedToLearning'] == false,
          ),
          isTrue,
        );
        await receipt.writeAsString(jsonEncode(model.snapshot!.value));
      }
      expect(tester.takeException(), isNull);
    },
  );
}
