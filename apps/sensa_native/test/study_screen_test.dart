import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/data/library_repository.dart';
import 'package:sensa_native/l10n/interface_locale.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/ui/study_screen.dart';
import 'native_use_case_ux_test.dart' show host;

void main() {
  for (final language in ['en', 'zh']) {
    for (final size in [
      const Size(375, 667),
      const Size(800, 632),
      const Size(1280, 800),
    ]) {
      testWidgets('$language $size study management, check-in and calendar', (
        tester,
      ) async {
        await interfaceLocale.select(language);
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final model = LibraryViewModel(
          LibraryRepository('/tmp/study-widget-unused.sqlite'),
        );
        addTearDown(model.dispose);
        model.snapshot = LibrarySnapshot.decode(
          jsonEncode({
            'libraryId': 'study',
            'revision': 0,
            'dailyNewLimit': 5,
            'enrolled': true,
            'curriculum': {
              'scope': {
                'members': [{}, {}],
              },
            },
            'personal': {
              'preparations': [
                {'status': 'blocked'},
                {'status': 'ready'},
              ],
            },
            'policyState': {
              'defaultPolicy': {'profileId': 'lightweight'},
            },
            'learning': {
              'date': '2026-09-10',
              'newStartedToday': 2,
              'counts': {'dueReviews': 3, 'distinctExecutableTargets': 3},
              'activity': {'status': 'paused', 'mode': 'review_only'},
              'checkins': [
                {'date': '2026-09-10'},
              ],
              'history': [
                for (var i = 0; i < 4; i++)
                  {
                    'mode': 'mixed',
                    'status': 'ended',
                    'startedAtMs': 1788998400000 - i * 1000,
                    'summary': {'distinctTargetCount': i + 1},
                  },
              ],
            },
          }),
        );
        String? action;
        await tester.pumpWidget(
          host(
            StudyScreen(
              model: model,
              onStart: (m) async {
                action = m;
              },
              onScope: () => action = 'scope',
              onPreparation: () => action = 'prepare',
              onHistory: () => action = 'history',
              onQuantity: () => action = 'quantity',
              onPolicy: () => action = 'policy',
            ),
          ),
        );
        Future<void> tapKey(String key) async {
          final finder = find.byKey(ValueKey(key));
          if (finder.evaluate().isEmpty) {
            await tester.scrollUntilVisible(
              finder,
              200,
              scrollable: find.byType(Scrollable).first,
            );
          }
          await tester.ensureVisible(finder);
          await tester.pumpAndSettle();
          await tester.tap(finder);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }

        for (final pair in [
          ('study-scope', 'scope'),
          ('study-start', 'review_only'),
          ('study-quantity', 'quantity'),
          ('study-policy', 'policy'),
          ('study-preparation', 'prepare'),
          ('study-history', 'history'),
        ]) {
          await tapKey(pair.$1);
          expect(action, pair.$2);
        }
        expect(
          tester
              .widget<FilledButton>(
                find.byKey(const ValueKey('study-check-in')),
              )
              .onPressed,
          isNull,
        );
        final previous = find.byTooltip(l10n.studyPreviousMonth);
        await tester.ensureVisible(previous);
        await tester.pumpAndSettle();
        await tester.tap(previous);
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip(l10n.studyNextMonth));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(model.snapshot!.quantity, 5);
        await tester.pumpWidget(const SizedBox.shrink());
      });
    }
  }
}
