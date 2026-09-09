import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'retention_fixture.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets('formal material review, waiting and cold relearning', (
    tester,
  ) async {
    expect(run, isNotEmpty);
    final model = await createLibrary(name: 'product-retention-$run.sqlite');
    addTearDown(model.dispose);
    final receipt = File('${model.repository.path}.receipt');
    if (!recovery) {
      expect(model.snapshot!.catalog, isEmpty);
      // Historical graduation is a fixture, not an interaction being claimed.
      await File(
        model.repository.path,
      ).writeAsBytes(gzip.decode(base64Decode(retentionFixture)), flush: true);
      await model.load();
    } else {
      expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
    }
    await tester.pumpWidget(NativeApp(model: model));
    Future<void> settle({bool error = false}) async {
      for (var i = 0; i < 500; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        if (!model.busy) break;
      }
      expect(model.busy, false);
      if (!error) expect(model.error, isNull);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }

    Future<void> tap(Finder finder, {bool error = false}) async {
      if (finder.evaluate().isEmpty) {
        await tester.scrollUntilVisible(finder, 180, maxScrolls: 30);
      }
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await settle(error: error);
    }

    Future<void> material() async {
      await tap(find.byKey(const ValueKey('nav-2')));
      await tap(
        find.byKey(ValueKey('material-${model.snapshot!.material!['id']}')),
      );
    }

    await settle();
    await material();
    if (recovery) {
      final before = model.snapshot!;
      await tap(find.text('提前回想'));
      await tap(find.text('揭示表达'));
      await tap(find.text('可以继续'));
      expect(find.text('本次再学习已完成'), findsOneWidget);
      expect(model.snapshot!.dueAtMs, before.dueAtMs);
      expect(model.snapshot!.retention['reviewCount'], 1);
      expect(model.snapshot!.retention['relearningCount'], 1);
      expect(model.snapshot!.retention['pendingCount'], 0);
      expect(model.snapshot!.value['handoffCount'], 1);
    } else {
      await tap(find.text('开始到期复习'));
      expect(find.text('到期复习'), findsOneWidget);
      final id = model.snapshot!.run!['id'];
      await tap(find.text('暂停学习'));
      await tap(find.text('继续学习'));
      expect(model.snapshot!.run!['id'], id);
      await tap(find.text('揭示表达'));
      await tap(find.text('再回想'));
      expect(find.text('稍后再回想'), findsOneWidget);
      expect(model.snapshot!.retention['reviewCount'], 1);
      final due = model.snapshot!.dueAtMs;
      await tap(find.text('结束本次'));
      expect(find.text('今天，连接新的意义'), findsOneWidget);
      await material();
      await tap(find.text('继续再学习'), error: true);
      expect(model.error, isNotNull);
      await tap(find.text('重新读取'));
      await tap(find.text('提前回想'));
      await tap(find.text('揭示表达'));
      await tap(find.text('再回想'));
      expect(model.snapshot!.phase, 'waiting');
      expect(model.snapshot!.retention['reviewCount'], 1);
      expect(model.snapshot!.dueAtMs, due);
      await receipt.writeAsString(
        jsonEncode(model.snapshot!.value),
        flush: true,
      );
    }
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
