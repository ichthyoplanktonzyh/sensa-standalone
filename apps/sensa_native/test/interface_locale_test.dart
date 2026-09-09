import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/l10n/interface_locale.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/library_repository.dart';
import 'package:sensa_native/ui/library_view_model.dart';

void main() {
  test('both language catalogs cover every message and its parameters', () {
    final en =
        jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync()) as Map;
    final zh =
        jsonDecode(File('lib/l10n/app_zh.arb').readAsStringSync()) as Map;
    final keys = en.keys
        .cast<String>()
        .where((k) => !k.startsWith('@'))
        .toSet();
    expect(
      zh.keys.cast<String>().where((k) => !k.startsWith('@')).toSet(),
      keys,
    );
    final english = lookupAppLocalizations(const Locale('en'));
    expect(english.uiTargets(1), '1 target');
    expect(english.uiTargets(2), '2 targets');
    final placeholder = RegExp(r'\{(\w+)\}');
    for (final key in keys) {
      Set<String> arguments(String value) =>
          placeholder.allMatches(value).map((m) => m[1]!).toSet();
      expect(
        arguments(zh[key] as String),
        arguments(en[key] as String),
        reason: key,
      );
      expect((en[key] as String).trim(), isNotEmpty, reason: key);
      if (key != 'simplifiedChinese') {
        expect(
          RegExp(r'[\u3400-\u9fff]').hasMatch(en[key] as String),
          false,
          reason: key,
        );
      }
    }
  });

  test(
    'language survives reopening and invalid preferences recover safely',
    () async {
      final folder = await Directory.systemTemp.createTemp('sensa-language-');
      addTearDown(() => folder.delete(recursive: true));
      final file = File('${folder.path}/interface.json');
      final first = InterfaceLocale();
      final reopened = InterfaceLocale();
      addTearDown(first.dispose);
      addTearDown(reopened.dispose);
      await first.load(file);
      expect(first.locale.languageCode, 'zh');
      await first.select('en');
      await reopened.load(file);
      expect(reopened.locale.languageCode, 'en');
      expect(reopened.strings.uiSettings, 'Settings');
      await reopened.select('zh');
      await first.load(file);
      expect(first.locale.languageCode, 'zh');
      await file.writeAsString('broken');
      await reopened.load(file);
      expect(reopened.locale.languageCode, 'zh');
      // An inaccessible destination must not pretend the preference was saved.
      await reopened.load(File('${file.path}/unwritable.json'));
      await reopened.select('en');
      expect(reopened.saveFailed, true);
      expect(reopened.locale.languageCode, 'zh');
    },
  );

  testWidgets('language can be chosen before onboarding or enrollment', (
    tester,
  ) async {
    await interfaceLocale.select('zh');
    addTearDown(() => interfaceLocale.select('zh'));
    final model = LibraryViewModel(
      LibraryRepository('/tmp/locale-welcome-only.sqlite'),
    );
    addTearDown(model.dispose);
    model.snapshot = LibrarySnapshot.decode(
      jsonEncode({
        'libraryId': 'locale-welcome-only',
        'revision': 0,
        'dailyNewLimit': null,
        'enrolled': false,
        'catalog': [],
        'learning': {},
      }),
    );
    await tester.pumpWidget(NativeApp(model: model));
    await tester.tap(find.byKey(const ValueKey('interface-language-zh')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('English').last);
    await tester.pumpAndSettle();
    expect(find.text('Start at your own pace'), findsOneWidget);
    expect(find.text('Set daily quantity'), findsOneWidget);
    expect(model.snapshot!.quantity, isNull);
    expect(model.snapshot!.revision, 0);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'switching updates active notices and keeps search and library facts',
    (tester) async {
      await interfaceLocale.select('zh');
      addTearDown(() => interfaceLocale.select('zh'));
      final model = LibraryViewModel(
        LibraryRepository('/tmp/locale-layout-only.sqlite'),
      );
      addTearDown(model.dispose);
      model.snapshot = LibrarySnapshot.decode(
        jsonEncode({
          'libraryId': 'locale-layout-only',
          'revision': 7,
          'dailyNewLimit': 5,
          'enrolled': false,
          'catalog': [],
          'learning': {'date': '2026-09-09', 'counts': {}},
        }),
      );
      final original = jsonEncode(model.snapshot!.value);
      model.setNotice(() => l10n.uiPackageImportedChooseContentToAdd);
      await tester.pumpWidget(NativeApp(model: model));
      await tester.tap(find.byKey(const ValueKey('nav-2')));
      await tester.pumpAndSettle();
      final search = find.byKey(const ValueKey('library-search'));
      await tester.ensureVisible(search);
      await tester.enterText(search, '我的 context — borrow');
      await tester.tap(find.byTooltip('设置'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('interface-language-zh')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('English').last);
      await tester.pumpAndSettle();
      expect(find.text('Interface language'), findsOneWidget);
      expect(find.text('Default learning mode'), findsOneWidget);
      expect(
        find.text(l10n.uiPackageImportedChooseContentToAdd),
        findsOneWidget,
      );
      expect(find.text('已导入，选择内容后可加入学习。'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('nav-2')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(search).controller!.text,
        '我的 context — borrow',
      );
      expect(jsonEncode(model.snapshot!.value), original);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
