import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/library_repository.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/ui/intake_setup_screen.dart';

void main() {
  testWidgets(
    'browser selection never silently becomes an Agent-only install',
    (tester) async {
      const channel = MethodChannel('app.sensa/intake-install');
      final calls = <Map<Object?, Object?>>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        if (call.method.startsWith('choose')) return '/tmp/synthetic-directory';
        final args = call.arguments as Map<Object?, Object?>;
        calls.add(args);
        return {
          'browser': args['browser'],
          'label': 'Synthetic library',
          'executable': '/tmp/synthetic-tool',
        };
      });
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

      await tap('选择连接工具保存位置');
      await tap('选择浏览器连接文件夹');
      await tap('创建此库的连接');
      expect(calls, isEmpty);
      expect(find.textContaining('请填写 Chrome 提供的 32 位扩展 ID'), findsOneWidget);
      final field = find.widgetWithText(TextField, 'Sensa Chrome 扩展 ID');
      await tester.ensureVisible(field);
      await tester.enterText(field, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      await tap('创建此库的连接');
      expect(calls, hasLength(1));
      expect(calls.single['browser'], true);
      expect(calls.single['extensionId'], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(find.textContaining('打开 Sensa 浏览器插件'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
