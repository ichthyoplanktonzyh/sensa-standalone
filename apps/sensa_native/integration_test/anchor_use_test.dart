import 'support/migration_app.dart';
import 'legacy_wire_fixture.dart';
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
    'native anchor consent, revocation and replacement survive restart',
    (tester) async {
      final model = await createLibrary(name: 'anchor-$run.sqlite');
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.receipt');
      await tester.pumpWidget(MigrationApp(model: model));
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
        await text('capture-context', '张琳在谈话中很 $expression');
        await text('capture-expression', expression);
        await tap(find.text('在线解释这个表达'));
        if (configure) {
          model.semanticService.configure(
            'http://127.0.0.1:4325',
            'local-native-test',
          );
        }
        await resolveLegacyFixture(tester, model);
        await wait();
        await tap(find.text("确认并保存词义"));
        await tap(find.text('加入学习'));
        await tap(find.text('确认加入学习'));
      }

      Map<String, dynamic> task(String expression) =>
          model.preparations.firstWhere(
            (v) =>
                v['target']['proposal']['expression']['surface'] == expression,
          );
      Future<void> authorize() async {
        await tap(find.byKey(const ValueKey('anchor-toggle')));
        expect(find.text('允许使用这段原文？'), findsOneWidget);
        await tap(find.byKey(const ValueKey('anchor-confirm')));
      }

      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        expect(model.semanticService.configured, isFalse);
        expect(model.snapshot!.value['completionCount'], 1);
        await tap(find.byTooltip('我的词义世界'));
        await tap(find.byTooltip('学习准备'));
        await tap(find.text('recoverable'));
        expect(find.text("已授权使用原文"), findsOneWidget);
        await tap(find.text('撤销原文授权'));
        expect(find.text("未授权使用原文"), findsOneWidget);
        expect(task('recoverable')['anchor'], isNull);
        expect(task('recoverable')['status'], 'pending');
      } else {
        await model.act({'kind': 'confirm_quantity', 'quantity': 5});
        await wait();
        await tap(find.byTooltip('我的词义世界'));
        await capture('tactful', configure: true);
        expect(find.text("未授权使用原文"), findsOneWidget);
        await authorize();
        expect(task('tactful')['anchor']['sentence'], '张琳在谈话中很 tactful');
        await prepareLegacyFixture(tester, model);
        await wait();
        expect(task('tactful')['status'], 'ready');
        final privateId = task('tactful')['materialId'];
        await tap(find.text('回到学习入口'));
        await tap(find.text('开始今天的学习'));
        expect(model.snapshot!.material!['scene'], contains('张琳'));
        await tap(find.text('揭示表达'));
        await tap(find.text('可以继续'));
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.value['handoffCount'], 1);
        await tap(find.byTooltip('我的词义世界'));
        await tap(find.byTooltip('学习准备'));
        await tap(find.text('tactful'));
        await tap(find.text('撤销原文授权'));
        expect(task('tactful')['status'], 'pending');
        await prepareLegacyFixture(tester, model);
        await wait();
        expect(task('tactful')['status'], 'ready');
        expect(task('tactful')['materialId'], isNot(privateId));
        expect(model.snapshot!.catalog, hasLength(1));
        expect(model.snapshot!.value['completionCount'], 1);
        await tap(find.byType(BackButton).first);
        await tap(find.byType(BackButton).first);
        await capture('delayed');
        await authorize();
        // Keep the delayed legacy request in flight while exercising local cancellation.
        final generating = prepareLegacyFixture(tester, model);
        for (var i = 0; i < 100; i++) {
          await tester.pump(const Duration(milliseconds: 10));
          if (task('delayed')['status'] == 'generating') break;
        }
        final revoke = find.text('撤销原文授权');
        await tester.ensureVisible(revoke);
        await tester.pump();
        await tester.tap(revoke);
        await wait();
        expect(task('delayed')['status'], 'pending');
        expect(task('delayed')['anchor'], isNull);
        expect(model.snapshot!.catalog, hasLength(1));
        await generating;
        await tap(find.byType(BackButton).first);
        await capture('recoverable');
        await authorize();
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
