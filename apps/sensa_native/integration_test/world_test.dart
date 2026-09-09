import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:uuid/uuid.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/world_repository.dart';
import 'package:sensa_native/ui/world_screen.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'pack_import_test.dart' show sample;

// Only the OS file selection is replaced; image decoding, SQLite, FFI and UI are real.
class ImageFixture extends WorldRepository {
  ImageFixture(super.library);
  @override
  Future<Uint8List?> pickImage() async => base64Decode(png);
}

const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGMQ6kgDIgYIBQAavgQBYrSJKQAAAABJRU5ErkJggg==';
Object? ordered(Object? value) {
  if (value is Map) {
    final keys = value.keys.cast<String>().toList()..sort();
    return {for (final key in keys) key: ordered(value[key])};
  }
  if (value is List) return value.map(ordered).toList();
  return value;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'rich context, draft restart, semantic branches and explicit admission',
    (tester) async {
      final library = await createLibrary(name: 'world-$run.sqlite');
      addTearDown(library.dispose);
      final repository = ImageFixture(library.repository);
      final receipt = File('${library.repository.path}.world-receipt');
      if (!recovery) {
        await library.act({'kind': 'confirm_quantity', 'quantity': 5});
        await library.act({'kind': 'import_pack', 'pack_json': sample()});
        final id = const Uuid().v4();
        await library.act({
          'kind': 'semantic',
          'action': {
            'kind': 'begin',
            'id': id,
            'snapshot': {
              'sentence': 'The crane lifted it.',
              'language': 'en',
              'expression': {'text': 'crane', 'start': 4, 'end': 9},
              'source': {
                'url': null,
                'title': 'no-cost synthetic',
                'capturedAt': '2026-09-09T00:00:00Z',
              },
            },
            'intake_id': null,
            'previous_id': null,
            'clarification': null,
          },
        });
        final lookup = (library.snapshot!.personal['lookups'] as List).first;
        final proposal = {
          'explanation': '起重机',
          'expression': {'surface': 'crane', 'type': 'word', 'language': 'en'},
          'semanticSpec': {
            'schemaVersion': 'sensa-sense-semantic-spec-v1',
            'coreMeaningFocus': 'A machine for lifting heavy loads.',
            'prototypeScenes': [
              {
                'summary': 'A machine lifts a heavy load.',
                'participantRoles': ['machine', 'load'],
                'states': [],
                'directionOrCausality': null,
              },
            ],
            'includedCases': [],
            'excludedCases': ['a bird'],
            'neighborContrasts': [],
            'openQuestions': [],
          },
        };
        await library.act({
          'kind': 'semantic',
          'action': {
            'kind': 'finish',
            'result': {
              'version': 'sensa-native-semantic-v1',
              'id': id,
              'inputDigest': lookup['request']['inputDigest'],
              'status': 'ready',
              'provenance': {
                'provider': 'fixture',
                'model': 'no-cost',
                'policyVersion': 'consumer-semantic-v4',
                'outputDigest': sha256
                    .convert(utf8.encode(jsonEncode(ordered(proposal))))
                    .toString(),
              },
              'proposal': proposal,
            },
          },
        });
        await library.act({
          'kind': 'semantic',
          'action': {
            'kind': 'accept',
            'id': id,
            'consent': 'accept_context_expression_sense',
          },
        });
        expect(library.error, isNull);
      }
      await tester.pumpWidget(
        MaterialApp(
          home: WorldScreen(library: library, repository: repository),
        ),
      );
      Future<void> wait() async {
        for (var i = 0; i < 30; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      Future<void> tap(Finder f) async {
        if (f.evaluate().isEmpty) {
          final scroll = find.byType(Scrollable).last;
          await tester.scrollUntilVisible(
            f,
            170,
            scrollable: scroll,
            maxScrolls: 35,
          );
        }
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await wait();
      }

      Future<void> text(String key, String value) async {
        final f = find.byKey(ValueKey(key));
        await tester.ensureVisible(f);
        await tester.tap(f);
        await tester.pumpAndSettle();
        await tester.enterText(f, value);
        FocusManager.instance.primaryFocus?.unfocus();
        await wait();
      }

      Future<void> chip(String name) async =>
          tap(find.widgetWithText(ChoiceChip, name));
      Future<void> back() async => tap(find.byType(BackButton).first);
      await wait();
      if (recovery) {
        expect(
          await repository.load(),
          jsonDecode(await receipt.readAsString()),
        );
        await chip('草稿与材料');
        await tap(find.text('中文场景备忘'));
        expect(find.text('在工地看到机器吊起重物。'), findsOneWidget);
        expect(find.byType(WorldImage), findsOneWidget);
        final data = await repository.load();
        final accepted = (data['meanings'] as List).where(
          (m) => m['worldContext'] != null,
        );
        expect(accepted.length, greaterThanOrEqualTo(2));
        expect(library.preparations.single['status'], 'pending');
        expect(library.preparations.single['attemptCount'], 0);
        expect(
          (data['meanings'] as List).where((m) => m['expression'] == 'derrick'),
          hasLength(1),
        );
        await back();
        await tap(find.text('继续编辑的草稿'));
        await text('world-familiar', '重启后继续编辑');
        await back();
        final resumed = await repository.load();
        expect(
          (resumed['drafts'] as List).where(
            (d) => d['draft']['familiarExpression'] == '重启后继续编辑',
          ),
          hasLength(1),
        );
        expect(resumed['meanings'], data['meanings']);
        return;
      }
      final before = (await library.repository.load()).value;
      await tap(find.text('新建图文材料'));
      await text('world-block-0', '在工地看到机器吊起重物。');
      await text('world-familiar', '中文场景备忘');
      await tap(find.text('添加图片'));
      await tap(find.byTooltip('上移材料').last);
      await tap(find.text('添加文字'));
      await tap(find.byTooltip('移除材料块').last);
      await back();
      var data = await repository.load();
      expect(data['drafts'], hasLength(1));
      expect(data['meanings'], hasLength(1));
      await tap(find.text('中文场景备忘'));
      expect(find.text('在工地看到机器吊起重物。'), findsOneWidget);
      await tap(find.text('选择已有意思并确认'));
      await tap(find.widgetWithText(ListTile, 'crane'));
      await tap(find.text('确认并保存连接'));
      data = await repository.load();
      expect(data['meanings'], hasLength(2));
      expect((data['drafts'] as List).first['status'], 'accepted');
      await tap(find.text('中文场景备忘'));
      await tap(find.text('再确认一个意思'));
      await tap(find.widgetWithText(ListTile, 'tactful'));
      await tap(find.text('确认并保存连接'));
      data = await repository.load();
      expect(data['meanings'], hasLength(3));
      final after = (await library.repository.load()).value;
      for (final entry in before.entries) {
        if (!['revision', 'personal'].contains(entry.key)) {
          expect(after[entry.key], entry.value, reason: entry.key);
        }
      }
      await chip('已保存');
      await chip('图谱');
      expect(find.byType(WorldGraph), findsOneWidget);
      await tap(find.text('上下文').last);
      expect(find.text('上下文与表达'), findsOneWidget);
      await back();
      await chip('列表');
      await tap(find.widgetWithText(ListTile, 'crane').first);
      await tap(find.text('补充一个表达'));
      await text('binding-surface', '');
      await tap(find.byKey(const ValueKey('binding-relation')));
      await tap(find.text('表达这个意思').last);
      await tap(find.byKey(const ValueKey('binding-coverage')));
      await tap(find.text('恰好覆盖').last);
      await tap(find.text('确认表达连接'));
      expect(find.byKey(const ValueKey('binding-surface')), findsOneWidget);
      await text('binding-surface', 'derrick');
      await tap(find.text('确认表达连接'));
      data = await repository.load();
      expect(
        (data['meanings'] as List).where((m) => m['expression'] == 'derrick'),
        hasLength(1),
      );
      await back();
      await tap(find.widgetWithText(ListTile, 'derrick'));
      await tap(find.text('移除这个连接'));
      await tap(find.text('恢复这个连接'));
      await tap(find.text('显式加入学习'));
      await tap(find.text('确认加入学习'));
      expect(library.preparations.single['status'], 'pending');
      expect(library.preparations.single['attemptCount'], 0);
      expect(
        library.snapshot!.value['completionCount'],
        before['completionCount'],
      );
      await back();
      await back();
      // Leave an editable copied draft alongside the immutable accepted context for cold recovery.
      await chip('草稿与材料');
      await tap(find.text('中文场景备忘'));
      await tap(find.text('复制为新草稿'));
      await text('world-familiar', '继续编辑的草稿');
      await back();
      data = await repository.load();
      expect(
        (data['drafts'] as List).where((d) => d['status'] == 'editing'),
        hasLength(1),
      );
      final digest = (data['drafts'] as List).first['draft']['blocks']
          .firstWhere((b) => b['kind'] == 'image')['digest'];
      expect(await repository.image(digest), base64Decode(png));
      await receipt.writeAsString(jsonEncode(data));
    },
  );
}
