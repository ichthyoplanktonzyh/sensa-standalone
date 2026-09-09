import 'package:sensa_native/l10n/interface_locale.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/library_repository.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/ui/intake_setup_screen.dart';

void main() {
  for (final language in ['zh', 'en']) {
    testWidgets(
      '$language browser selection never silently becomes an Agent-only install',
      (tester) async {
        await interfaceLocale.select(language);
        const channel = MethodChannel('app.sensa/intake-install');
        final calls = <Map<Object?, Object?>>[];
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          (call) async {
            if (call.method.startsWith('choose')) {
              expect((call.arguments as Map)['prompt'], l10n.chooseFolder);
              return '/tmp/synthetic-directory';
            }
            final args = call.arguments as Map<Object?, Object?>;
            calls.add(args);
            return {
              'browser': args['browser'],
              'label': 'Synthetic library',
              'executable': '/tmp/synthetic-tool',
            };
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            channel,
            null,
          ),
        );
        final model = LibraryViewModel(
          LibraryRepository('/tmp/layout-only.sqlite'),
        );
        model.snapshot = LibrarySnapshot.decode(
          jsonEncode({'libraryId': 'synthetic-id', 'revision': 0}),
        );
        addTearDown(model.dispose);
        await tester.pumpWidget(
          NativeApp(
            model: model,
            home: IntakeSetupScreen(model: model),
          ),
        );
        Future<void> tap(String text) async {
          final finder = find.text(text);
          await tester.ensureVisible(finder);
          await tester.tap(finder);
          await tester.pumpAndSettle();
        }

        await tap(l10n.uiChooseToolLocation);
        await tap(l10n.uiChooseBrowserConnectionFolder);
        await tap(l10n.uiCreateConnection);
        expect(calls, isEmpty);
        expect(
          find.text(l10n.uiEnterTheCharacterChromeExtensionId),
          findsOneWidget,
        );
        final field = find.widgetWithText(
          TextField,
          l10n.uiSensaChromeExtensionId,
        );
        await tester.ensureVisible(field);
        await tester.enterText(field, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        await tap(l10n.uiCreateConnection);
        expect(calls, hasLength(1));
        expect(calls.single['browser'], true);
        expect(calls.single['extensionId'], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(
          find.text(l10n.uiOpenTheSensaExtensionSelectThe),
          findsOneWidget,
        );
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
