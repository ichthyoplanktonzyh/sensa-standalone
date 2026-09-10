import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/l10n/interface_locale.dart';
import 'package:sensa_native/ui/practice_home.dart';
import 'package:sensa_native/ui/practice_scope_screen.dart';
import 'native_use_case_ux_test.dart' show host;

Map<String, dynamic> catalog() => {
  'selection': {'sourceId': 'current_study'},
  'targets': [
    {
      'targetId': 'a',
      'expression': 'tactful',
      'sense': 'Considerate',
      'context': 'A tactful reply.',
    },
  ],
  'blockedTargets': [],
  'sources': [
    {
      'sourceId': 'current_study',
      'targets': [
        {
          'targetId': 'a',
          'expression': 'tactful',
          'sense': 'Considerate',
          'context': 'A tactful reply.',
        },
      ],
    },
    {
      'sourceId': 'personal_semantic_world',
      'targets': [
        {
          'targetId': 'b',
          'expression': 'personal expression',
          'sense': 'Personal meaning',
          'context': 'Saved context',
        },
      ],
    },
  ],
};
void main() {
  for (final language in ['zh', 'en']) {
    for (final size in [
      const Size(375, 667),
      const Size(800, 632),
      const Size(1280, 800),
    ]) {
      testWidgets('$language $size practice cards, resume and empty scope', (
        tester,
      ) async {
        await interfaceLocale.select(language);
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final brief = TextEditingController(text: 'Listen');
        addTearDown(brief.dispose);
        var starts = 0;
        var scopes = 0;
        Future<void> show({bool resume = false, bool empty = false}) async {
          final c = catalog();
          if (empty) c['targets'] = [];
          await tester.pumpWidget(
            host(
              SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: PracticeHome(
                    data: {
                      'catalog': c,
                      'history': [],
                      'session': resume
                          ? {
                              'snapshot': {
                                'brief': 'Saved practice',
                                'expressions': [
                                  {'expression': 'pinned expression'},
                                ],
                              },
                            }
                          : null,
                    },
                    busy: false,
                    brief: brief,
                    onScope: () => scopes++,
                    onStart: () => starts++,
                    onAbandon: () {},
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }

        await show();
        expect(find.text(l10n.practiceComingSoon), findsNWidgets(3));
        final start = find.byKey(const ValueKey('practice-start'));
        await tester.ensureVisible(start);
        await tester.pumpAndSettle();
        await tester.tap(start);
        expect(starts, 1);
        await tester.ensureVisible(
          find.byKey(const ValueKey('practice-scope')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('practice-scope')));
        expect(scopes, 1);
        await show(resume: true);
        expect(find.text('pinned expression'), findsOneWidget);
        expect(find.byKey(const ValueKey('practice-start')), findsNothing);
        final resume = find.byKey(const ValueKey('practice-resume'));
        await tester.ensureVisible(resume);
        await tester.pumpAndSettle();
        await tester.tap(resume);
        expect(starts, 2);
        await show(empty: true);
        expect(tester.widget<FilledButton>(start).onPressed, isNull);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      });
    }
  }
  testWidgets('scope selection remains a draft until confirmed', (
    tester,
  ) async {
    await interfaceLocale.select('en');
    Map<String, dynamic>? selected;
    await tester.pumpWidget(
      host(
        Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              selected = await Navigator.of(context).push<Map<String, dynamic>>(
                MaterialPageRoute(
                  builder: (_) => PracticeScopeScreen(catalog: catalog()),
                ),
              );
            },
            child: const Text('Open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.textContaining('A tactful reply.'), findsOneWidget);
    await tester.tap(find.text(l10n.practiceChangeScope));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10n.uiMySemanticWorld).last);
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, l10n.uiUseThisScope),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    expect(selected, isNull);
    await tester.tap(find.text(l10n.uiUseThisScope));
    await tester.pumpAndSettle();
    expect(selected, {
      'sourceId': 'personal_semantic_world',
      'targetIds': ['b'],
    });
  });
  testWidgets('caption highlights provider marks without exposing delimiters', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(const PracticeCaption(caption: 'A [[[tactful]]] reply.')),
    );
    final rich =
        tester.widget<Text>(find.byType(Text).last).textSpan! as TextSpan;
    expect(rich.toPlainText(), 'A tactful reply.');
    expect((rich.children![1] as TextSpan).style!.fontWeight, FontWeight.w600);
  });
}
