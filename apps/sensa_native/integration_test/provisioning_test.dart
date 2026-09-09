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
    'personal target preparation and existing Profile learning survive restart',
    (tester) async {
      final model = await createLibrary(name: 'provisioning-$run.sqlite');
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

      Future<void> capture(String expression, {bool configure = false}) async {
        await tap(find.text('保存材料'));
        await text('capture-context', 'PRIVATE CAPTURE $expression');
        await text('capture-expression', expression);
        await tap(find.text('在线解释这个表达'));
        if (configure) {
          await tap(find.text('配置在线服务'));
          await text('semantic-origin', 'http://127.0.0.1:4324');
          await text('semantic-token', 'local-native-test');
          await tap(find.text('使用此服务'));
        }
        await tap(find.text('请求解释'));
        await tap(find.text('确认词义并保存到本机'));
        await tap(find.text('加入学习'));
        await tap(find.text('确认加入学习'));
      }

      Map<String, dynamic> task(String expression) =>
          model.preparations.firstWhere(
            (v) =>
                v['target']['proposal']['expression']['surface'] == expression,
          );
      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        expect(model.semanticService.configured, isFalse);
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.catalog, hasLength(1));
        await tap(find.byTooltip('我的词义世界'));
        await tap(find.byTooltip('学习准备'));
        await tap(find.text('recoverable'));
        expect(find.text('配置在线服务'), findsOneWidget);
        await tap(find.text('取消准备'));
        expect(task('recoverable')['status'], 'cancelled');
        expect(task('recoverable')['attemptCount'], 1);
        expect(model.snapshot!.value['completionCount'], 1);
      } else {
        await model.act({'kind': 'confirm_quantity', 'quantity': 5});
        await wait();
        await tap(find.byTooltip('我的词义世界'));
        await capture('tactful', configure: true);
        expect(task('tactful')['status'], 'pending');
        expect(model.snapshot!.catalog, isEmpty);
        await tap(find.text('开始准备材料'));
        expect(task('tactful')['status'], 'ready');
        expect(model.snapshot!.catalog, hasLength(1));
        expect(model.snapshot!.value['completionCount'], 0);
        expect(
          model
              .snapshot!
              .policyPlan!['plan']['effective']['policy']['profileId'],
          'lightweight',
        );
        await tap(find.text('回到学习入口'));
        await tap(find.text('开始今天的学习'));
        await tap(find.text('揭示表达'));
        await tap(find.text('可以继续'));
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.value['handoffCount'], 1);
        await tap(find.byTooltip('我的词义世界'));
        await capture('rejected');
        await tap(find.text('开始准备材料'));
        expect(task('rejected')['reason'], 'material_rejected');
        await tap(find.text('明确重试准备'));
        await tap(find.text('明确重试准备'));
        expect(task('rejected')['attemptCount'], 3);
        expect(model.snapshot!.catalog, hasLength(1));
        await tap(find.byType(BackButton).first);
        await capture('delayed');
        final start = find.text('开始准备材料');
        await visible(start);
        await tester.tap(start);
        for (var i = 0; i < 100; i++) {
          await tester.pump(const Duration(milliseconds: 10));
          if (task('delayed')['status'] == 'generating') break;
        }
        final cancel = find.text('取消准备');
        await tester.ensureVisible(cancel);
        await tester.pump();
        await tester.tap(cancel);
        await wait();
        expect(task('delayed')['status'], 'cancelled');
        expect(model.snapshot!.catalog, hasLength(1));
        await tap(find.byType(BackButton).first);
        await capture('recoverable');
        final pending = task('recoverable');
        await model.provisioningAction({
          'kind': 'begin',
          'task_id': pending['id'],
          'expected_revision': pending['revision'],
        });
        await wait();
        expect(task('recoverable')['status'], 'generating');
        expect(model.snapshot!.value['completionCount'], 1);
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
