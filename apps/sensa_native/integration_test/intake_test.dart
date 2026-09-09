import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/pack_file_reader.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/ui/intake_connection_screen.dart';
import 'package:sensa_native/ui/personal_world_screen.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';
import 'package:uuid/uuid.dart';

class IntakeReader extends PackFileReader {
  String? value;
  @override
  Future<String?> pick() async => value;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'external intake preview, local confirmation, idempotency and cold recovery',
    (tester) async {
      final base = await createLibrary(name: 'intake-$run.sqlite');
      final reader = IntakeReader();
      final model = LibraryViewModel(base.repository, packReader: reader);
      base.dispose();
      await model.load();
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.intake-receipt');
      Future<void> wait() async {
        for (var i = 0; i < 60; i++) {
          await tester.pump(const Duration(milliseconds: 100));
          if (!model.busy) {
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            return;
          }
        }
        fail('timeout');
      }

      Future<void> tap(Finder f) async {
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await wait();
      }

      Future<void> show(Widget w) async {
        await tester.pumpWidget(NativeApp(model: model, home: w));
        await wait();
      }

      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        await show(PersonalWorldScreen(model: model));
        expect(find.textContaining('borrow'), findsWidgets);
        expect(model.snapshot!.catalog, isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
        return;
      }
      final request = <String, dynamic>{
        'version': 'sensa-intake-v1',
        'libraryId': model.snapshot!.id,
        'clientId': const Uuid().v4(),
        'operationId': const Uuid().v4(),
        'snapshot': {
          'sentence': 'May I borrow your umbrella?',
          'language': 'en',
          'source': {
            'url': 'https://www.youtube.com/watch?v=abcdefghijk',
            'title': 'Synthetic video',
            'capturedAt': '2026-09-09T00:00:00Z',
            'video': {
              'platform': 'youtube',
              'videoId': 'abcdefghijk',
              'startMs': 1500,
              'endMs': 4000,
            },
          },
          'expression': {'text': 'borrow', 'start': 6, 'end': 12},
        },
        'resolution': null,
        'acceptance': null,
      };
      await show(IntakeConnectionScreen(model: model));
      reader.value = jsonEncode({...request, 'libraryId': const Uuid().v4()});
      await tap(find.byKey(const ValueKey('intake-import')));
      expect(find.text('这份请求属于另一学习库，未导入。'), findsOneWidget);
      expect(model.snapshot!.personal['intakes'], isEmpty);
      reader.value = jsonEncode(request);
      await tap(find.byKey(const ValueKey('intake-import')));
      await tap(find.text('取消'));
      expect(model.snapshot!.personal['intakes'], isEmpty);
      await tap(find.byKey(const ValueKey('intake-import')));
      await tap(find.byKey(const ValueKey('intake-import-confirm')));
      expect(model.error, isNull);
      expect(model.snapshot!.personal['intakes'], hasLength(1));
      expect(model.snapshot!.personal['meanings'], isEmpty);
      await tap(find.byKey(const ValueKey('intake-import')));
      await tap(find.byKey(const ValueKey('intake-import-confirm')));
      expect(model.error, isNull);
      expect(model.snapshot!.personal['intakes'], hasLength(1));
      request['operationId'] = const Uuid().v4();
      request['resolution'] = {
        'kind': 'proposal',
        'proposal': {
          'explanation': '临时借来使用，之后归还。',
          'expression': {'surface': 'borrow', 'type': 'word', 'language': 'en'},
          'semanticSpec': {
            'schemaVersion': 'sensa-sense-semantic-spec-v1',
            'coreMeaningFocus': '临时取得并归还',
            'prototypeScenes': [
              {
                'summary': '向朋友借伞，使用后归还。',
                'participantRoles': [],
                'states': [],
                'directionOrCausality': null,
              },
            ],
            'includedCases': [],
            'excludedCases': [],
            'neighborContrasts': [],
            'openQuestions': [],
          },
        },
      };
      request['acceptance'] = {
        'kind': 'direct',
        'consent': 'accept_context_expression_sense',
        'authorization': 'native:explicit_import_confirmation',
      };
      reader.value = jsonEncode(request);
      await tap(find.byKey(const ValueKey('intake-import')));
      expect(find.text('确认上下文、表达与词义？'), findsOneWidget);
      await tap(find.byKey(const ValueKey('intake-import-confirm')));
      expect(model.error, isNull);
      expect(model.snapshot!.personal['meanings'], hasLength(1));
      expect(model.snapshot!.catalog, isEmpty);
      expect(model.snapshot!.run, isNull);
      expect(
        model.snapshot!.personal['meanings'][0]['sourceLink'],
        'https://www.youtube.com/watch?v=abcdefghijk&t=1s',
      );
      await show(PersonalWorldScreen(model: model));
      await tap(find.byTooltip('刷新采集结果'));
      expect(find.textContaining('borrow'), findsWidgets);
      await receipt.writeAsString(
        jsonEncode(model.snapshot!.value),
        flush: true,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
