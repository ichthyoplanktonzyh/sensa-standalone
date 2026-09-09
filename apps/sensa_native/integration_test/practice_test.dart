import 'package:sensa_native/l10n/interface_locale.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/practice_repository.dart';
import 'package:sensa_native/ui/practice_screen.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'pack_import_test.dart' show sample;

// Runs inside the real platform WebView. No network, media or paid provider.
const fixture = '''
window.YG={Widget:class {
 constructor(id,o){this.e=o.events;this.n=1;document.getElementById(id).textContent='Synthetic provider — no actual video';}
 fetch(q,l,a){this.q=q;setTimeout(()=>{this.e.onFetchDone({totalResult:3});this.caption();},100);}
 caption(){this.e.onCaptionChange({caption:'A [[['+this.q+']]] example.',video:'synthetic-'+this.n,trackNumber:this.n});}
 play(){this.caption();}pause(){}replay(){this.caption();}
 next(){this.n++;this.caption();}previous(){this.n=Math.max(1,this.n-1);this.caption();}
 setSpeed(r){this.rate=r;}close(){}
}};
''';
const unavailable =
    '''window.YG={Widget:class{constructor(id,o){this.e=o.events;}fetch(){setTimeout(()=>this.e.onError({}),100);}pause(){}close(){}}};''';
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  const live = bool.fromEnvironment('SENSA_NATIVE_LIVE');
  setUpAll(() async => RustLib.init());
  testWidgets('isolated practice, native provider bridge and cold recovery', (
    tester,
  ) async {
    final model = await createLibrary(name: 'practice-$run.sqlite');
    await model.load();
    addTearDown(model.dispose);
    final practice = PracticeRepository(model.repository.path);
    final receipt = File('${model.repository.path}.receipt');
    if (!recovery) {
      await model.act({'kind': 'confirm_quantity', 'quantity': 5});
      await model.act({'kind': 'import_pack', 'pack_json': sample()});
      await model.act({
        'kind': 'curriculum',
        'action': {
          'kind': 'enroll',
          'book_id': 'integration-pack',
          'version': '1',
          'range': {'kind': 'all'},
        },
      });
      await model.act({
        'kind': 'personal',
        'action': {
          'kind': 'accept',
          'snapshot': {
            'sentence': 'A tactful reply.',
            'language': 'en',
            'expression': {'text': 'tactful', 'start': 2, 'end': 9},
            'source': {
              'url': null,
              'title': 'synthetic practice',
              'capturedAt': '2026-09-09T00:00:00Z',
            },
          },
          'material_id': '00000000-0000-4000-8000-000000000001',
          'intake_id': null,
          'focus': null,
          'consent': 'accept_context_expression_sense',
        },
      });
      await model.act({'kind': 'activity_start', 'mode': 'mixed'});
      expect(model.error, isNull);
    }
    final before = (await model.repository.load()).value;
    if (recovery) expect(before, jsonDecode(await receipt.readAsString()));
    final key = GlobalKey<NavigatorState>();
    Future<void> page(String? script) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: interfaceLocale.locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          navigatorKey: key,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        PracticeScreen(library: model, fixtureScript: script),
                  ),
                ),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      for (var i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    Future<void> visible(Finder f) async {
      final scroll = find
          .descendant(
            of: find.byKey(const ValueKey('practice-scroll')),
            matching: find.byType(Scrollable),
          )
          .first;
      if (f.evaluate().isEmpty) {
        tester.state<ScrollableState>(scroll).position.jumpTo(0);
        await tester.pump();
        await tester.scrollUntilVisible(f, 200, scrollable: scroll);
      }
      await tester.ensureVisible(f.last);
      await tester.pumpAndSettle();
    }

    Future<void> tap(String label) async {
      final chip = find.widgetWithText(ChoiceChip, label);
      final f = chip.evaluate().isNotEmpty ? chip : find.text(label);
      await visible(f);
      await tester.tap(f.last);
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(tester.takeException(), isNull);
    }

    Future<void> waitText(String label) async {
      for (var i = 0; i < 220; i++) {
        await tester.pump(const Duration(milliseconds: 100));
        if (find.text(label).evaluate().isNotEmpty) return;
      }
      fail(
        'Missing provider state: $label; texts=${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data).toList()}; ledger=${await practice.load()}',
      );
    }

    if (!recovery) {
      await page(unavailable);
      await tap('进入真实语流');
      await waitText('暂时无法连接 YouGlish，请检查网络后重试。');
      expect((await practice.load())['session'], isNull);
      await tap('保存并返回自由练习');
      key.currentState!.pop();
      await tester.pumpAndSettle();
    }
    await page(live ? null : fixture);
    if (!recovery) {
      await tap('选择练习范围');
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('我的词义世界').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(CheckboxListTile).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('使用此范围'));
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(
        (await practice.load())['catalog']['selection']['sourceId'],
        'personal_semantic_world',
      );
    }
    await tap(recovery ? '继续真实语流' : '进入真实语流');
    if (live) {
      for (var i = 0; i < 200; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      final observation = (await practice.load())['session'];
      debugPrint(
        'LIVE YOUGLISH OBSERVATION: ${jsonEncode(observation?['state'])}',
      );
      if (observation?['state']['providerStatus'] == 'ready') {
        await tap('播放');
        for (var i = 0; i < 80; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        debugPrint(
          'LIVE YOUGLISH PLAYBACK: ${jsonEncode((await practice.load())['session']['state'])}',
        );
      }
      await tap('保存并返回自由练习');
      expect((await model.repository.load()).value, before);
      expect(
        observation?['state']['providerStatus'],
        'ready',
        reason:
            'External provider probe is separate from deterministic acceptance',
      );
      return;
    }
    await waitText('找到 3 段真实语流');
    await tap('播放');
    await tap('下一段');
    expect((await practice.load())['session']['state']['video'], 'synthetic-2');
    await tap('0.75×');
    await tap('英国');
    await waitText('找到 3 段真实语流');
    expect((await practice.load())['session']['state']['accent'], 'uk');
    await tap('重听');
    if (recovery) {
      await tap('结束本次练习');
      expect((await practice.load())['session'], isNull);
      expect((await practice.load())['history'][0]['status'], 'completed');
    } else {
      await tap('保存并返回自由练习');
      expect((await practice.load())['session']['state']['rate'], 0.75);
      await receipt.writeAsString(jsonEncode(before));
    }
    expect((await model.repository.load()).value, before);
    expect(tester.takeException(), isNull);
  });
}
