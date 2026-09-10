import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/data/library_repository.dart';
import 'package:sensa_native/data/world_repository.dart';
import 'package:sensa_native/l10n/interface_locale.dart';
import 'package:sensa_native/ui/assurance_view.dart';
import 'package:sensa_native/ui/agent_screen.dart';
import 'package:sensa_native/ui/preparation_screen.dart';
import 'package:sensa_native/ui/library_screen.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/ui/personal_world_screen.dart';
import 'package:sensa_native/ui/product_theme.dart';
import 'package:sensa_native/ui/world_screen.dart';

Map<String, dynamic> snapshot({String phase = 'recall'}) => {
  'libraryId': 'ux-fixture',
  'revision': 0,
  'dailyNewLimit': 5,
  'enrolled': true,
  'catalog': [],
  'personal': {'meanings': [], 'intakes': []},
  'run': {'id': 'run-1', 'phase': phase, 'paused': false},
  'material': {
    'id': 'm1',
    'expression': 'borrow',
    'sense': 'Use something temporarily',
    'scene': List.filled(
      20,
      'May I borrow your umbrella for the afternoon?',
    ).join(' '),
    'source': 'fixture',
  },
};

Widget host(Widget child) => MaterialApp(
  locale: interfaceLocale.locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  theme: productTheme(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: const TextScaler.linear(1.5)),
    child: child!,
  ),
  home: child,
);

class FixtureWorld extends WorldRepository {
  FixtureWorld(super.library);
  @override
  Future<Map<String, dynamic>> load() async => {
    'meanings': [
      for (var i = 0; i < 3; i++)
        {
          'id': 'meaning-$i',
          'status': 'confirmed',
          'contextAnchorId': 'context',
          'senseVersionId': 'sense-$i',
          'sense': 'Meaning $i',
          'expression': 'Expression $i',
          'snapshot': {'sentence': 'A shared context for these expressions.'},
        },
    ],
    'drafts': [],
  };
}

void main() {
  for (final language in ['en', 'zh']) {
    for (final size in [const Size(375, 667), const Size(800, 632)]) {
      testWidgets(
        '$language $size relation navigation survives short windows and large type',
        (tester) async {
          await interfaceLocale.select(language);
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final model = LibraryViewModel(
            LibraryRepository('/tmp/ux-widget-unused.sqlite'),
          );
          addTearDown(model.dispose);
          model.snapshot = LibrarySnapshot.decode(jsonEncode(snapshot()));
          await tester.pumpWidget(
            host(
              WorldScreen(
                library: model,
                repository: FixtureWorld(model.repository),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.widgetWithText(ChoiceChip, l10n.uiGraph));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          if (size.width < 600) {
            expect(
              find.byKey(const ValueKey('world-graph-relations')),
              findsOneWidget,
            );
            await tester.scrollUntilVisible(
              find.text('Expression 2'),
              180,
              scrollable: find.descendant(
                of: find.byKey(const ValueKey('world-graph-relations')),
                matching: find.byType(Scrollable),
              ),
            );
            await tester.pumpAndSettle();
            await tester.tap(find.text('Expression 2'));
            await tester.pumpAndSettle();
            expect(find.text(l10n.uiContextAndExpression), findsOneWidget);
          } else {
            expect(find.byType(InteractiveViewer), findsOneWidget);
          }
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
        },
      );
    }

    testWidgets('$language capture back keeps or discards unsaved text', (
      tester,
    ) async {
      await interfaceLocale.select(language);
      tester.view.physicalSize = const Size(375, 667);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final model = LibraryViewModel(
        LibraryRepository('/tmp/ux-widget-unused.sqlite'),
      );
      addTearDown(model.dispose);
      model.snapshot = LibrarySnapshot.decode(jsonEncode(snapshot()));
      await tester.pumpWidget(host(PersonalWorldScreen(model: model)));
      await tester.tap(find.text(l10n.uiSaveContent));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('capture-context')),
        'A context to keep.',
      );
      await tester.pump();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text(l10n.uiDiscardCaptureTitle), findsOneWidget);
      await tester.tap(find.text(l10n.uiKeepEditing));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('capture-context')))
            .controller!
            .text,
        'A context to keep.',
      );
      await tester.pump();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text(l10n.uiDiscardChanges));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('capture-context')), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets(
    'ready preparation leads to learning and keeps reference controls accessible',
    (tester) async {
      final model = LibraryViewModel(
        LibraryRepository('/tmp/ux-widget-unused.sqlite'),
      );
      addTearDown(model.dispose);
      model.snapshot = LibrarySnapshot.decode(
        jsonEncode({
          ...snapshot(),
          'personal': {
            'meanings': [],
            'preparations': [
              {
                'id': 'task',
                'revision': 1,
                'status': 'ready',
                'attemptCount': 1,
                'target': {
                  'proposal': {
                    'expression': {'surface': 'borrow'},
                    'semanticSpec': {'coreMeaningFocus': 'Use temporarily'},
                  },
                },
              },
            ],
          },
        }),
      );
      await tester.pumpWidget(
        host(PreparationScreen(model: model, taskId: 'task')),
      );
      expect(find.text(l10n.uiMaterialReady), findsOneWidget);
      expect(find.text(l10n.uiBackToLearning), findsOneWidget);
      expect(find.byKey(const ValueKey('reference-import')), findsNothing);
      await tester.tap(find.text(l10n.uiContextResources));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('reference-import')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('service setup offers creation before purpose assignment', (
    tester,
  ) async {
    final model = LibraryViewModel(
      LibraryRepository('/tmp/ux-widget-unused.sqlite'),
    );
    addTearDown(model.dispose);
    await tester.pumpWidget(
      host(AgentSettingsScreen(controller: model.agents)),
    );
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    expect(find.text(l10n.uiAddModelService), findsOneWidget);
    model.agents.providers.profiles = [
      {
        'id': 'service',
        'name': 'Example service',
        'model': 'example',
        'kind': 'compatible',
        'vision': false,
      },
    ];
    await tester.pumpWidget(
      host(
        AgentSettingsScreen(
          key: const ValueKey('configured'),
          controller: model.agents,
        ),
      ),
    );
    expect(find.byType(DropdownButtonFormField<String>), findsNWidgets(4));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'new learning prompt starts at top while same prompt rebuild keeps reading position',
    (tester) async {
      final model = LibraryViewModel(
        LibraryRepository('/tmp/ux-widget-unused.sqlite'),
      );
      addTearDown(model.dispose);
      model.home = false;
      model.snapshot = LibrarySnapshot.decode(jsonEncode(snapshot()));
      await tester.pumpWidget(host(LibraryScreen(model: model)));
      final scroll = find.byType(Scrollable).first;
      await tester.drag(scroll, const Offset(0, -700));
      await tester.pumpAndSettle();
      expect(
        tester.state<ScrollableState>(scroll).position.pixels,
        greaterThan(0),
      );
      model.notifyListeners();
      await tester.pumpAndSettle();
      expect(
        tester.state<ScrollableState>(scroll).position.pixels,
        greaterThan(0),
      );
      model.snapshot = LibrarySnapshot.decode(
        jsonEncode({
          ...snapshot(),
          'run': {'id': 'run-2', 'phase': 'recall'},
        }),
      );
      model.notifyListeners();
      await tester.pumpAndSettle();
      expect(tester.state<ScrollableState>(scroll).position.pixels, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'recall submission enables immediately while draft persistence is debounced',
    (tester) async {
      final model = LibraryViewModel(
        LibraryRepository('/tmp/ux-widget-unused.sqlite'),
      );
      addTearDown(model.dispose);
      model.snapshot = LibrarySnapshot.decode(
        jsonEncode({
          ...snapshot(),
          'assurance': {
            'id': 'a1',
            'purpose': 'initial_learning',
            'draft': {'text': '', 'support': 'independent'},
            'queue': {
              'stats': {},
              'states': [],
              'session': {
                'action': {'intent': 'assessment'},
              },
            },
            'resource': {
              'kind': 'meaning_to_form_recall',
              'cueL1': 'Use temporarily',
            },
          },
        }),
      );
      await tester.pumpWidget(
        host(
          Scaffold(
            body: SingleChildScrollView(child: AssuranceView(model: model)),
          ),
        ),
      );
      final submit = find.byKey(const ValueKey('assurance-submit'));
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      await tester.enterText(
        find.byKey(const ValueKey('assurance-answer')),
        'borrow',
      );
      await tester.pump();
      expect(tester.widget<FilledButton>(submit).onPressed, isNotNull);
      await tester.enterText(
        find.byKey(const ValueKey('assurance-answer')),
        '   ',
      );
      await tester.pump();
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
