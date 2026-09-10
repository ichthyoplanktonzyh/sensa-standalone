import 'package:sensa_native/l10n/interface_locale.dart';
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
      final preferenceFile = File('${model.repository.path}.interface.json');
      await interfaceLocale.load(preferenceFile);
      if (!recovery) await interfaceLocale.select('en');
      expect(interfaceLocale.locale.languageCode, 'en');
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
      expect(find.text(l10n.uiLoadAcceptanceMaterial), findsNothing);
      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        await tap(find.byKey(const ValueKey('nav-1')));
        await tap(find.byKey(const ValueKey('content-section-1')));
        expect(find.text('tactful'), findsOneWidget);
        expect(model.snapshot!.value['completionCount'], 1);
        await tap(find.byKey(const ValueKey('nav-1')));
        await tap(find.byKey(const ValueKey('content-section-0')));
        expect(find.text(l10n.uiSaved), findsOneWidget);
        expect(model.snapshot!.personal['meanings'].length, 1);
      } else {
        expect(model.snapshot!.quantity, isNull);
        await tap(find.text(l10n.uiSetDailyQuantity));
        expect(find.text(l10n.uiConnectWithNewMeanings), findsOneWidget);
        await tap(find.byKey(const ValueKey('nav-1')));
        await tap(find.byKey(const ValueKey('content-section-1')));
        final original = model.snapshot!.revision;
        await tap(
          find.text(l10n.uiImportLearningPackage),
        ); // OS picker cancellation substitute.
        expect(model.snapshot!.revision, original);
        reader.encoded = 'not json';
        await tap(find.text(l10n.uiImportLearningPackage));
        expect(model.error, isNotNull);
        expect(model.snapshot!.catalog, isEmpty);
        await tap(find.text(l10n.uiReload));
        reader.encoded = sample();
        await tap(find.text(l10n.uiImportLearningPackage));
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
        expect(find.text(l10n.uiLoadAcceptanceMaterial), findsNothing);
        await tap(find.text(l10n.uiAddToLearning));
        await tap(find.text(l10n.uiChangeModeForThisItem));
        await tap(find.text(l10n.learningLightweight));
        await tap(find.text(l10n.uiStartLearning));
        expect(find.text('tactful'), findsNothing);
        await tap(find.text(l10n.uiRevealExpression));
        await tap(find.text(l10n.uiAgain));
        expect(model.snapshot!.value['completionCount'], 0);
        await tap(find.text(l10n.uiRevealExpression));
        await tap(find.text(l10n.uiGood));
        expect(find.text(l10n.uiInitialLearningComplete626), findsOneWidget);
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.value['handoffCount'], 1);
        await tap(find.text(l10n.uiBackToHome));
        await tap(find.byKey(const ValueKey('home-capture')));
        expect(find.byKey(const ValueKey('capture-context')), findsOneWidget);
        await text('capture-context', 'May I borrow your umbrella?');
        await tap(find.text(l10n.uiSaveToInboxFirst));
        expect(
          tester
              .widget<ChoiceChip>(find.widgetWithText(ChoiceChip, l10n.uiInbox))
              .selected,
          true,
        );
        await tap(find.widgetWithText(ChoiceChip, l10n.uiInbox));
        await tap(find.text(l10n.uiChooseExpressionAndMeaning));
        await text('capture-expression', 'borrow');
        await tap(
          find.byKey(
            const ValueKey('sense-00000000-0000-4000-8000-000000000002'),
          ),
        );
        await tap(find.text(l10n.uiConfirmMeaningAndSave));
        expect(model.snapshot!.personal['meanings'].length, 1);
        expect(model.snapshot!.personal['meanings'][0]['focus'], isNull);
        expect(
          model.snapshot!.catalog.where((e) => e['enrolled'] == true).length,
          1,
          reason: 'Semantic acceptance must not enroll borrow',
        );
        // Open the same confirmed meaning from the compact list. Detail reads
        // the real Rust World projection; browsing and copying do not enroll it.
        final meaning = model.snapshot!.personal['meanings'][0];
        await tap(find.byKey(ValueKey('personal-meaning-${meaning['id']}')));
        expect(find.text(l10n.uiContextAndExpression), findsOneWidget);
        await tap(find.text(l10n.uiSaveAsNew));
        expect(
          tester
              .widget<TextField>(find.byKey(const ValueKey('capture-context')))
              .controller!
              .text,
          'May I borrow your umbrella?',
        );
        await tester.pageBack();
        await wait();
        await tap(find.text(l10n.uiRemoveThisConnection));
        await tap(find.text(l10n.uiRestoreThisConnection));
        await tester.pageBack();
        await wait();
        expect(model.snapshot!.personal['meanings'][0]['status'], 'confirmed');
        expect(
          model.snapshot!.catalog.where((e) => e['enrolled'] == true).length,
          1,
        );
        await tap(find.byTooltip(l10n.uiImagesAndConnections));
        expect(find.text(l10n.uiImagesAndConnections), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.byTooltip(l10n.uiLearningPreparation));
        expect(find.text(l10n.uiLearningPreparation), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.byTooltip(l10n.uiCaptureConnections));
        expect(find.text(l10n.uiImportCaptureRequest), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.byKey(const ValueKey('nav-2')));
        await tap(find.byKey(const ValueKey('study-quantity')));
        await tap(find.widgetWithText(ChoiceChip, '10'));
        await tap(find.text(l10n.uiSaveQuantity));
        expect(model.snapshot!.quantity, 10);
        expect(model.snapshot!.value['completionCount'], 1);
        final checkin = find.byKey(const ValueKey('study-check-in'));
        if (checkin.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            checkin,
            200,
            scrollable: find.byType(Scrollable).first,
            maxScrolls: 30,
          );
        }
        await tester.ensureVisible(checkin);
        await wait();
        if (tester.widget<FilledButton>(checkin).onPressed != null) {
          await tap(checkin);
        }
        expect(tester.widget<FilledButton>(checkin).onPressed, isNull);
        expect(model.snapshot!.value['completionCount'], 1);
        await tap(find.text(l10n.uiAllLearningHistory));
        expect(find.text(l10n.uiLearningHistory), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(find.text(l10n.uiLearningSources));
        expect(find.text(l10n.uiLearningSources), findsOneWidget);
        await tester.pageBack();
        await wait();
        await tap(
          find.byKey(const ValueKey('nav-4')).evaluate().isNotEmpty
              ? find.byKey(const ValueKey('nav-4'))
              : find.byTooltip(l10n.uiSettings),
        );
        final beforeLanguage = model.snapshot!.value;
        await tap(find.byKey(const ValueKey('interface-language-en')));
        await tap(find.text('简体中文').last);
        expect(interfaceLocale.locale.languageCode, 'zh');
        expect(find.text('默认学习方式'), findsOneWidget);
        expect(model.snapshot!.value, beforeLanguage);
        await tap(find.byKey(const ValueKey('interface-language-zh')));
        await tap(find.text('English').last);
        expect(interfaceLocale.locale.languageCode, 'en');
        expect(model.snapshot!.value, beforeLanguage);
        await tap(find.text(l10n.uiDailyNewQuantity));
        await tap(find.widgetWithText(ChoiceChip, '10'));
        await tap(find.text(l10n.uiSaveQuantity));
        expect(model.snapshot!.quantity, 10);
        await tap(find.text(l10n.uiModelServices));
        await tap(find.text(l10n.uiAddModelService));
        await tap(find.text(l10n.uiCancel));
        expect(model.agents.providers.profiles, isEmpty);
        await tester.pageBack();
        await wait();
        final beforePractice = model.snapshot!.value;
        await tap(find.byKey(const ValueKey('nav-3')));
        expect(find.text(l10n.uiFreePractice), findsOneWidget);
        await tap(find.text(l10n.uiChoosePracticeScope));
        await tap(find.text(l10n.uiCancel));
        // Formal tab's BackButton must return home, never pop the root route.
        await tap(find.byType(BackButton));
        expect(find.text(l10n.uiConnectWithNewMeanings), findsOneWidget);
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
