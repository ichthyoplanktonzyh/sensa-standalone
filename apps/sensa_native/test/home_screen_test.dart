import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/data/library_repository.dart';
import 'package:sensa_native/l10n/interface_locale.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/ui/home_screen.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'native_use_case_ux_test.dart' show host;

Map<String, dynamic> homeData({
  Map<String, dynamic> counts = const {},
  Map<String, dynamic>? activity,
  List<Map<String, dynamic>> tasks = const [],
  bool enrolled = false,
  int introduced = 0,
}) => {
  'libraryId': 'home-fixture',
  'revision': 0,
  'dailyNewLimit': 5,
  'enrolled': enrolled,
  'catalog': [
    if (enrolled) {'enrolled': true},
  ],
  'personal': {'meanings': [], 'intakes': [], 'preparations': tasks},
  'learning': {
    'date': '2026-09-10',
    'counts': counts,
    'activity': activity,
    'newStartedToday': introduced,
  },
};

void main() {
  for (final language in ['zh', 'en']) {
    for (final size in [
      const Size(375, 667),
      const Size(800, 632),
      const Size(1280, 800),
    ]) {
      testWidgets(
        '$language $size home states have actionable, accurate next steps',
        (tester) async {
          await interfaceLocale.select(language);
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final model = LibraryViewModel(
            LibraryRepository('/tmp/home-fixture-unused.sqlite'),
          );
          addTearDown(model.dispose);
          String? action;
          final cases = [
            (homeData(), l10n.uiAddLearningContent, 'browse'),
            (
              homeData(
                counts: {'newAvailable': 5, 'distinctExecutableTargets': 5},
              ),
              l10n.uiStartToday,
              'mixed',
            ),
            (
              homeData(
                counts: {'dueReviews': 8, 'distinctExecutableTargets': 8},
              ),
              l10n.uiStartToday,
              'mixed',
            ),
            (
              homeData(
                activity: {
                  'status': 'paused',
                  'mode': 'review_only',
                  'canAnswer': true,
                },
              ),
              l10n.uiContinueToday,
              'review_only',
            ),
            (
              homeData(
                activity: {
                  'status': 'active',
                  'mode': 'mixed',
                  'emptyReason': 'waiting',
                },
              ),
              l10n.homeProgress,
              'mixed',
            ),
            (
              homeData(counts: {'relearningWaiting': 1}),
              l10n.homeProgress,
              'manage',
            ),
            (
              homeData(
                tasks: [
                  {'status': 'blocked'},
                ],
              ),
              l10n.uiViewPreparation,
              'prepare',
            ),
            (
              homeData(enrolled: true, introduced: 5),
              l10n.homeManage,
              'manage',
            ),
            (homeData(enrolled: true), l10n.homeManage, 'manage'),
          ];
          for (final (data, label, expectedAction) in cases) {
            model.snapshot = LibrarySnapshot.decode(jsonEncode(data));
            await tester.pumpWidget(
              host(
                HomeScreen(
                  model: model,
                  opening: false,
                  onStudy: (mode) async {
                    action = mode;
                  },
                  onManage: () => action = 'manage',
                  onPrepare: () => action = 'prepare',
                  onBrowse: () => action = 'browse',
                  onCapture: () => action = 'capture',
                ),
              ),
            );
            final start = find.byKey(const ValueKey('home-start'));
            expect(
              find.descendant(of: start, matching: find.text(label)),
              findsOneWidget,
            );
            await tester.ensureVisible(start);
            await tester.pumpAndSettle();
            await tester.tap(start);
            expect(action, expectedAction);
            expect(tester.takeException(), isNull);
          }
          model.busy = true;
          await tester.pumpWidget(
            host(
              HomeScreen(
                model: model,
                opening: false,
                onStudy: (_) async {},
                onManage: () {},
                onPrepare: () {},
                onBrowse: () {},
                onCapture: () {},
              ),
            ),
          );
          expect(
            tester
                .widget<FilledButton>(find.byKey(const ValueKey('home-start')))
                .onPressed,
            isNull,
          );
          expect(
            tester
                .widget<TextButton>(find.byKey(const ValueKey('home-review')))
                .onPressed,
            isNull,
          );
          await tester.pumpWidget(const SizedBox.shrink());
        },
      );
    }
  }
  for (final language in ['en', 'zh']) {
    testWidgets(
      '$language primary home action fits the standard small phone viewport',
      (tester) async {
        await interfaceLocale.select(language);
        tester.view.physicalSize = const Size(375, 667);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final model = LibraryViewModel(
          LibraryRepository('/tmp/home-fixture-unused.sqlite'),
        );
        addTearDown(model.dispose);
        model.snapshot = LibrarySnapshot.decode(
          jsonEncode(
            homeData(
              counts: {'newAvailable': 5, 'distinctExecutableTargets': 5},
            ),
          ),
        );
        await tester.pumpWidget(NativeApp(model: model));
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.byKey(const ValueKey('home-start'))).bottom,
          lessThanOrEqualTo(
            tester.getRect(find.byKey(const ValueKey('nav-0'))).top,
          ),
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets('home capture opens editor directly; cancel returns home', (
    tester,
  ) async {
    final model = LibraryViewModel(
      LibraryRepository('/tmp/home-fixture-unused.sqlite'),
    );
    addTearDown(model.dispose);
    model.snapshot = LibrarySnapshot.decode(jsonEncode(homeData()));
    await tester.pumpWidget(NativeApp(model: model));
    final capture = find.byKey(const ValueKey('home-capture'));
    await tester.scrollUntilVisible(
      capture,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(capture);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('capture-context')), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.byType(HomeScreen), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('nav-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('nav-0')));
    await tester.pumpAndSettle();
    expect(find.text(l10n.uiConnectWithNewMeanings), findsOneWidget);
    expect(
      tester
          .state<ScrollableState>(find.byType(Scrollable).first)
          .position
          .pixels,
      0,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
