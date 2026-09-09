import 'support/migration_app.dart';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/agent_provider.dart';
import 'package:sensa_native/data/pack_file_reader.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/ui/preparation_screen.dart';
import 'package:sensa_native/ui/agent_screen.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'package:uuid/uuid.dart';
import 'world_test.dart' show ImageFixture;

class ReferenceReader extends PackFileReader {
  String? value;
  @override
  Future<String?> pick() async => value;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'source backed references, authorized images, fixed binding and offline learning',
    (tester) async {
      final base = await createLibrary(name: 'resources-$run.sqlite');
      final reader = ReferenceReader();
      final model = LibraryViewModel(base.repository, packReader: reader);
      base.dispose();
      await model.load();
      addTearDown(model.dispose);
      final c = model.agents;
      await c.load();
      final receipt = File('${model.repository.path}.resources-receipt');
      Future<void> wait() async {
        for (var i = 0; i < 30; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        for (var i = 0; i < 600 && (c.busy || model.busy); i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(c.busy, false, reason: c.error);
        expect(model.busy, false, reason: model.error);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      Future<void> show(Widget w) async {
        await tester.pumpWidget(
          NativeApp(key: UniqueKey(), model: model, home: w),
        );
        await wait();
      }

      Future<void> tap(Finder f) async {
        if (f.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            f,
            180,
            scrollable: find.byType(Scrollable).last,
            maxScrolls: 60,
          );
        }
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await wait();
      }

      Future<Map<String, dynamic>> stats() async => jsonDecode(
        (await http.get(Uri.parse('http://127.0.0.1:4331/stats'))).body,
      );
      final before = await stats();
      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        expect(model.snapshot!.value['completionCount'], 1);
        final material = model.snapshot!.catalog.single['material'];
        expect(
          await model.repository.pronunciation(material['id']),
          hasLength(material['pronunciation']['byteSize']),
        );

        expect(
          model.snapshot!.catalog.single['material']['resources'],
          hasLength(5),
        );
        expect(model.preparations.single['reference'], isNull);
        expect(model.preparations.single['anchor'], isNull);
        await show(
          PreparationScreen(
            model: model,
            taskId: model.preparations.single['id'],
          ),
        );
        expect(await stats(), before);
        return;
      }
      await model.act({'kind': 'confirm_quantity', 'quantity': 5});
      final image = await ImageFixture(model.repository).pickImage();
      final digest = await ImageFixture(model.repository).putImage(image!);
      final draft = const Uuid().v4();
      await model.act({
        'kind': 'world',
        'action': {
          'kind': 'save',
          'id': draft,
          'expected_revision': 0,
          'draft': {
            'blocks': [
              {
                'kind': 'text',
                'id': const Uuid().v4(),
                'text': 'PRIVATE 下雨时我从朋友那里借来雨伞，用完归还。',
              },
              {'kind': 'image', 'id': const Uuid().v4(), 'digest': digest},
            ],
            'familiarExpression': '借来雨伞',
            'startingPoint': null,
          },
          'submit': true,
        },
      });
      await c.providers.save({
        'id': 'resource-provider',
        'name': '资源验收',
        'endpoint': 'http://127.0.0.1:4331',
        'model': 'fixture',
        'kind': 'compatible',
        'vision': true,
      }, 'fixture-access');
      for (final role in ['teacher', 'content', 'review']) {
        await c.providers.assign(role, 'resource-provider');
      }
      await c.providers.save({
        'id': 'static-resource',
        'name': '静态发音服务',
        'endpoint': 'http://127.0.0.1:4326',
        'model': 'fixture',
        'kind': 'sensa',
        'vision': false,
      }, 'local-native-test');
      await c.providers.assign('service', 'static-resource');
      final teacher = await c.create({
        'kind': 'world',
        'draft_id': draft,
        'revision': 1,
        'share_images': false,
      });
      await c.say(teacher!, '更正：我从朋友那里借来。');
      expect(c.error, isNull);
      await c.accept(teacher);
      await model.load();
      var meaning =
          (model.snapshot!.personal['meanings'] as List).single
              as Map<String, dynamic>;
      await model.act({
        'kind': 'world',
        'action': {
          'kind': 'bind',
          'meaning_id': meaning['id'],
          'expected_revision': meaning['revision'],
          'surface': 'borrow',
          'expression_type': 'word',
          'relation': 'approximates',
          'coverage': 'overlapping',
          'consent': 'confirm_expression_binding',
        },
      });
      meaning =
          (model.snapshot!.personal['meanings'] as List).firstWhere(
                (m) => m['bindingMetadata']?['relation'] == 'approximates',
              )
              as Map<String, dynamic>;
      await model.provisioningAction({
        'kind': 'add',
        'meaning_id': meaning['id'],
        'expected_revision': meaning['revision'],
        'policy': {'profileId': 'lightweight', 'profileVersion': 'v1'},
      });
      expect(model.error, isNull);
      final source = <String, dynamic>{
        'sourceId': 'resource-fixture',
        'edition': 'v1',
        'entryId': 'borrow-1',
        'sourceUrl': 'https://example.invalid/resource-fixture',
        'license': 'CC0 synthetic fixture',
        'attribution': 'Synthetic resource acceptance',
        'reviewer': 'fixture-editor',
        'expression': 'borrow',
        'resources': [
          {
            'materialRoleKey': 'pronunciation',
            'contentPayload': {
              'audioUrl': null,
              'phoneticNotation': '/ˈbɒrəʊ/',
              'accentLabel': '英式',
            },
          },
          {
            'materialRoleKey': 'language_structure',
            'contentPayload': {
              'expressionKind': 'word',
              'expressionTypeLabel': '单词',
              'partOfSpeech': '动词',
            },
          },
          {
            'materialRoleKey': 'usage_guidance',
            'contentPayload': {'example': 'May I borrow your umbrella?'},
          },
        ],
      };
      source['digest'] = sha256
          .convert(utf8.encode(jsonEncode(canonicalAgentJson(source))))
          .toString();
      reader.value = jsonEncode(source);
      await show(PreparationScreen(model: model, meaningId: meaning['id']));
      await tap(find.byKey(const ValueKey('reference-import')));
      await tap(find.byKey(const ValueKey('reference-confirm')));
      expect(model.error, isNull);
      await tap(find.byKey(const ValueKey('anchor-toggle')));
      expect(find.byType(Image), findsOneWidget);
      await tap(find.byKey(const ValueKey('anchor-confirm')));
      expect(model.error, isNull);
      await tap(find.text('使用模型服务准备'));
      expect(find.byType(AgentScreen), findsOneWidget);
      await tap(find.text('开始准备'));
      expect(c.error, isNull);
      await model.load();
      expect(model.preparations.single['status'], 'ready');
      final audio = model.snapshot!.catalog.single['material']['pronunciation'];
      expect(audio, isNotNull);
      expect(
        await model.repository.pronunciation(
          model.preparations.single['materialId'],
        ),
        hasLength(audio['byteSize']),
      );

      expect(
        model.snapshot!.catalog.single['material']['resources'],
        hasLength(5),
      );
      final generated = await stats();
      expect(generated['contentImages'], greaterThan(before['contentImages']));
      expect(generated['reviewImages'], greaterThan(before['reviewImages']));
      expect(generated['references'], greaterThan(before['references']));
      expect(model.snapshot!.value['completionCount'], 0);
      await model.selectMaterial(model.preparations.single['materialId']);
      await model.showHome();
      await tester.pumpWidget(MigrationApp(model: model));
      await wait();
      await tap(find.text('开始学习'));
      expect(find.text('May I borrow your umbrella?'), findsNothing);
      expect(find.text('/ˈbɒrəʊ/ · 英式'), findsNothing);
      final fixedRun = model.snapshot!.run!['id'];
      // Revoke and detach during a real fixed Run, then finish with its original materials.
      await show(PreparationScreen(model: model, meaningId: meaning['id']));
      await tap(find.byKey(const ValueKey('anchor-toggle')));
      await tap(find.byKey(const ValueKey('reference-remove')));
      expect(model.error, isNull);
      expect(model.snapshot!.run!['id'], fixedRun);
      await tester.pumpWidget(MigrationApp(model: model));
      await wait();
      await tap(find.text('揭示表达'));
      expect(find.text('May I borrow your umbrella?'), findsOneWidget);
      expect(find.text('/ˈbɒrəʊ/ · 英式'), findsOneWidget);
      await tap(find.text('可以继续'));
      expect(model.snapshot!.value['completionCount'], 1);
      expect(
        await stats(),
        generated,
        reason: 'Run, revoke and local learning must not call a model',
      );
      await receipt.writeAsString(
        jsonEncode(model.snapshot!.value),
        flush: true,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
