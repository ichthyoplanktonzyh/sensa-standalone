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
  testWidgets(
    'local inbox, direct acceptance, membership and explicit learning survive restart',
    (tester) async {
      final model = await createLibrary(name: 'personal-$run.sqlite');
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.receipt');
      await tester.pumpWidget(MigrationApp(model: model));
      Future<void> wait() async {
        for (var i = 0; i < 600; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy) {
            await tester.pumpAndSettle();
            if (!model.busy) {
              expect(model.error, isNull);
              expect(tester.takeException(), isNull);
              return;
            }
          }
        }
        fail('command timeout');
      }

      Future<void> tap(Finder f) async {
        if (f.evaluate().isEmpty) {
          final view = find.byKey(const ValueKey('capture-scroll'));
          await tester.scrollUntilVisible(
            f,
            200,
            scrollable: find
                .descendant(of: view, matching: find.byType(Scrollable))
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
        await tester.ensureVisible(f);
        await tester.enterText(f, value);
        await tester.pumpAndSettle();
      }

      Future<void> world() async => tap(find.byTooltip('我的词义世界'));
      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        await world();
        expect(find.text('tactful'), findsNWidgets(2));
      } else {
        expect(model.snapshot!.quantity, isNull);
        await world();
        await tap(find.text('保存材料'));
        await text('capture-context', '😀 She was tactful.');
        await text('capture-source-title', 'A conversation');
        await text('capture-source-url', 'https://example.org/story');
        await tap(find.text('先保存到收件箱'));
        expect(model.snapshot!.personal['meanings'], isEmpty);
        expect(model.snapshot!.quantity, isNull);
        await tap(find.text('收件箱'));
        expect(find.text('😀 She was tactful.'), findsOneWidget);
        await tap(
          find.byTooltip('Back'),
        ); // Return to the learning surface to import a known local binding.
        await tap(find.text('确认每日数量'));
        await tap(find.text('载入验收材料'));
        await world();
        await tap(find.text('收件箱'));
        await tap(find.text('选择表达与词义'));
        await text('capture-expression', 'tactful');
        final material = model.snapshot!.material!['id'];
        await tap(find.byKey(ValueKey('sense-$material')));
        await tap(find.text('确认词义并保存'));
        await tap(find.text('已保存'));
        expect(model.snapshot!.personal['meanings'][0]['focus'], isNull);
        expect(model.snapshot!.enrolled, isFalse);
        expect(model.snapshot!.learning['checkins'], isEmpty);
        await tap(find.text('加入学习'));
        expect(model.snapshot!.enrolled, isTrue);
        await tap(find.text('移除'));
        await tap(find.text('已移除'));
        await tap(find.text('恢复'));
        await tap(find.text('已保存'));
        expect(find.text('已加入学习'), findsOneWidget);
        // Complete information can be accepted in-place, with no new inbox row.
        await tap(find.text('保存材料'));
        await text('capture-context', 'She gave a tactful answer.');
        await text('capture-expression', 'tactful');
        await tap(find.byKey(ValueKey('sense-$material')));
        await tap(find.text('确认词义并保存'));
        expect(model.snapshot!.personal['meanings'].length, 2);
        expect(model.snapshot!.personal['intakes'].length, 1);
        await tap(find.text('加入学习'));
        expect(
          model.snapshot!.catalog.where((m) => m['enrolled'] == true).length,
          1,
        );
        await tap(find.byTooltip('Back'));
        await model.showHome();
        await wait();
        await tap(find.text('开始今天的学习'));
        await tap(find.text('揭示表达'));
        await tap(find.text('可以继续'));
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
