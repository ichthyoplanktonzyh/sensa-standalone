import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/library_repository.dart';
import 'package:sensa_native/ui/library_view_model.dart';

void main() {
  for (final size in [
    const Size(375, 812),
    const Size(390, 844),
    const Size(800, 1024),
    const Size(1280, 800),
  ]) {
    testWidgets('formal navigation, search and large text at $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 1.5;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final model = LibraryViewModel(
        LibraryRepository('/tmp/sensa-layout-only.sqlite'),
      );
      model.snapshot = LibrarySnapshot.decode(
        jsonEncode({
          'libraryId': 'layout-only',
          'revision': 0,
          'dailyNewLimit': 5,
          'enrolled': false,
          'catalog': [],
          'learning': {'date': '2026-09-09', 'counts': {}},
        }),
      );
      addTearDown(model.dispose);
      await tester.pumpWidget(NativeApp(model: model));
      expect(find.text('载入验收材料'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('nav-2')));
      await tester.pumpAndSettle();
      final search = find.byKey(const ValueKey('library-search'));
      await tester.ensureVisible(search);
      await tester.enterText(search, 'borrow');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('nav-1')));
      await tester.pumpAndSettle();
      expect(find.text('我的词义世界'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('nav-2')));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(search).controller!.text, 'borrow');
      if (size.width < 1000) {
        await tester.tap(find.byTooltip('设置'));
      } else {
        await tester.tap(find.byKey(const ValueKey('nav-4')));
      }
      await tester.pumpAndSettle();
      expect(find.text('每日新学数量'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('今天，连接新的意义'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
