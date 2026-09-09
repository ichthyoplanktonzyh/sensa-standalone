import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/ui/agent_screen.dart';
import 'package:sensa_native/ui/preparation_screen.dart';
import 'package:sensa_native/ui/world_screen.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'world_test.dart' show ImageFixture;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'teacher multimodal loop, corrections, reviewed material and offline recovery',
    (tester) async {
      final library = await createLibrary(name: 'agent-$run.sqlite');
      addTearDown(library.dispose);
      final c = library.agents;
      final world = ImageFixture(library.repository);
      final receipt = File('${library.repository.path}.agent-receipt');
      Future<void> wait() async {
        for (var i = 0; i < 20; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        for (var i = 0; i < 300 && c.busy; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(c.busy, false, reason: c.error);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      Future<void> tap(Finder f) async {
        if (f.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            f,
            160,
            scrollable: find.byType(Scrollable).last,
            maxScrolls: 50,
          );
        }
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await wait();
      }

      Future<void> text(String key, String value) async {
        final f = find.byKey(ValueKey(key));
        if (f.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            f,
            160,
            scrollable: find.byType(Scrollable).last,
            maxScrolls: 50,
          );
        }
        await tester.ensureVisible(f);
        await tester.tap(f);
        await tester.pumpAndSettle();
        await tester.enterText(f, value);
        FocusManager.instance.primaryFocus?.unfocus();
        await wait();
      }

      Future<void> show(Widget w) async {
        await tester.pumpWidget(MaterialApp(key: UniqueKey(), home: w));
        await wait();
      }

      Future<Map<String, dynamic>> stats() async =>
          jsonDecode(
                (await http.get(Uri.parse('http://127.0.0.1:4331/stats'))).body,
              )
              as Map<String, dynamic>;
      await c.load();
      if (recovery) {
        final saved = jsonDecode(await receipt.readAsString());
        final before = await stats();
        expect(await world.load(), saved['world']);
        expect(c.sessions, saved['sessions']);
        expect(c.providers.profiles, hasLength(3));
        expect(c.providers.configured, true);
        final pending = c.sessions.firstWhere((s) => s['status'] == 'proposal');
        await show(AgentScreen(controller: c, id: pending['id']));
        expect(find.text('建议已整理，等待你确认'), findsOneWidget);
        await tap(find.text('就是这个意思，保存'));
        expect(c.error, isNull);
        expect(c.session(pending['id'])['status'], 'accepted');
        expect(
          await stats(),
          before,
          reason:
              'Cold open and explicit local acceptance must not call a model',
        );
        final snapshot = await library.repository.load();
        expect(snapshot.catalog, hasLength(1));
        expect(snapshot.run, isNull);
        expect(snapshot.value['completionCount'], saved['completions']);
        return;
      }
      await library.act({'kind': 'confirm_quantity', 'quantity': 5});
      final before = await library.repository.load();
      final initialStats = await stats();
      await show(WorldScreen(library: library, repository: world));
      await tap(find.text('新建图文材料'));
      await text('world-block-0', 'PRIVATE 我看见朋友把雨伞交给另一个人，想知道怎么表达借的意思。');
      await text('world-familiar', '关于借雨伞');
      await tap(find.text('添加图片'));
      await tap(find.text('和语言老师聊一聊'));
      await tap(find.byTooltip('模型服务'));
      await tap(find.text('添加模型服务'));
      await text('agent-provider-name', '本地验收模型');
      await text('agent-provider-url', 'http://127.0.0.1:4331');
      await text('agent-provider-model', 'fixture');
      await text('agent-provider-key', 'fixture-access');
      await tap(find.text('此模型支持图片输入'));
      await tap(find.text('保存模型服务'));
      await tap(find.byType(BackButton).first);
      // Separate role assignments must drive real model requests, not merely labels.
      await c.providers.save({
        ...c.providers.connection(c.providers.current!),
        'id': 'generator-$run',
        'name': '生成服务',
        'model': 'fixture-generator',
      }, 'fixture-access');

      await c.providers.save({
        ...c.providers.connection(c.providers.current!),
        'id': 'reviewer-$run',
        'name': '审核服务',
        'model': 'fixture-reviewer',
      }, 'fixture-access');
      c.changed();
      await tap(find.byTooltip('模型服务'));
      await tap(
        find.byWidgetPredicate(
          (w) =>
              w is DropdownButtonFormField<String> &&
              w.key.toString().contains('provider-role-content-'),
        ),
      );
      await tap(find.text('生成服务').last);
      await tap(
        find.byWidgetPredicate(
          (w) =>
              w is DropdownButtonFormField<String> &&
              w.key.toString().contains('provider-role-review-'),
        ),
      );
      await tap(find.text('审核服务').last);
      await tap(find.byType(BackButton).first);
      await tap(find.text('发送材料，开始交流'));
      expect(c.error, isNull);
      expect(c.sessions.single['status'], 'waiting');
      expect((await world.load())['meanings'], isEmpty);
      expect(find.text('老师：你是把东西给别人用，还是从别人那里借来？'), findsOneWidget);
      await text('agent-reply', '把自己的东西给别人用。');
      await tap(find.text('发送补充'));
      expect(c.error, isNull);
      expect(c.sessions.single['candidate']['expression']['surface'], 'lend');
      await text('agent-reply', '更正一下，我是从别人那里借来使用。');
      await tap(find.text('发送补充'));
      expect(c.error, isNull);
      expect(c.sessions.single['candidate']['expression']['surface'], 'borrow');
      expect((await world.load())['meanings'], isEmpty);
      await tap(find.text('就是这个意思，保存'));
      expect(c.error, isNull);
      var data = await world.load();
      final meaning = (data['meanings'] as List).single;
      expect(meaning['focus'], isNull);
      expect(meaning['addedToLearning'], false);
      expect(meaning['resolutionProvenance']['modelUsed'], 'fixture-actual');
      await library.load();
      await show(PreparationScreen(model: library, meaningId: meaning['id']));
      await tap(find.text('确认加入学习'));
      expect(library.error, isNull);
      expect(library.preparations.single['attemptCount'], 0);
      await tap(find.text('使用模型服务准备'));
      await tap(find.text('开始准备'));
      expect(c.error, isNull);
      expect(
        c.sessions.where((s) => s['kind'] == 'content').single['status'],
        'committed',
      );
      await library.load();
      expect(library.preparations.single['status'], 'ready');
      expect(library.snapshot!.catalog, hasLength(1));
      expect(library.snapshot!.run, isNull);
      expect(
        library.snapshot!.value['completionCount'],
        before.value['completionCount'],
      );
      final finished = await stats();
      expect(finished['images'], greaterThan(initialStats['images']));
      expect(finished['rejections'], initialStats['rejections'] + 1);
      expect(finished['models']['fixture-generator'], greaterThan(0));
      expect(finished['models']['fixture-reviewer'], greaterThan(0));
      expect(finished['acceptances'], initialStats['acceptances'] + 1);
      expect(
        finished['observations'],
        greaterThan(initialStats['observations']),
      );
      // A second text-only conversation stays at a proposal for a separate-process offline acceptance.
      final source = Map<String, dynamic>.from(
        c.sessions.firstWhere((s) => s['kind'] == 'teacher')['source'],
      );
      source['share_images'] = false;
      // Exercise the authenticated Sensa envelope over real HTTP as the other provider.
      await c.providers.save({...c.providers.current!, 'kind': 'sensa'}, '');
      expect(
        c.providers.configured,
        false,
        reason: 'Do not transfer credentials to a changed service',
      );
      await c.providers.save(c.providers.current!, 'fixture-access');
      final second = await c.create(source);
      expect(second, isNotNull, reason: c.error);
      final imageCount = (await stats())['images'];
      await c.run(second!);
      expect(c.session(second)['status'], 'waiting', reason: c.error);
      await c.say(second, '把自己的东西给别人用。');
      expect(c.session(second)['status'], 'proposal', reason: c.error);
      expect(
        (await stats())['images'],
        imageCount,
        reason: 'Text-only opt-out must exclude image bytes',
      );
      expect(
        await c.providers.file.readAsString(),
        isNot(contains('fixture-access')),
      );
      expect(jsonEncode(c.sessions), isNot(contains('fixture-access')));
      data = await world.load();
      await receipt.writeAsString(
        jsonEncode({
          'world': data,
          'sessions': c.sessions,
          'completions': library.snapshot!.value['completionCount'],
        }),
      );
    },
  );
}
