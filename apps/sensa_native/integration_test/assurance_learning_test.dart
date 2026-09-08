import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const reviewing = bool.fromEnvironment('SENSA_NATIVE_REVIEW');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  const artifactPath = String.fromEnvironment('SENSA_TEST_ARTIFACT_PATH');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'structured learning uses local tasks, evidence and cold recovery',
    (tester) async {
      expect(run, isNotEmpty);
      final model = await createLibrary(name: 'assurance-$run.sqlite');
      addTearDown(model.dispose);
      final receipt = File('${model.repository.path}.receipt');
      final artifact = recovery
          ? ''
          : await File(
              artifactPath.isEmpty
                  ? '${model.repository.path}.artifact'
                  : artifactPath,
            ).readAsString();
      await tester.pumpWidget(NativeApp(model: model));
      Future<void> ready() async {
        for (var i = 0; i < 600; i++) {
          await tester.pump(const Duration(milliseconds: 50));
          if (!model.busy) {
            await tester.pump();
            expect(model.error, isNull);
            expect(tester.takeException(), isNull);
            return;
          }
        }
        fail('native command timeout');
      }

      Future<void> tap(Finder f) async {
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await ready();
      }

      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        expect(
          find.text(reviewing ? '本次复习与修复已完成' : '本次高保证首学已完成'),
          findsOneWidget,
        );
        expect(model.snapshot!.value['completionCount'], 1);
      } else {
        if (!reviewing) {
          expect(model.snapshot!.quantity, isNull);
          await model.act({'kind': 'confirm_quantity', 'quantity': 5});
          await model.act({
            'kind': 'import_runtime_release',
            'release_json': artifact,
          });
          await model.act({
            'kind': 'set_policy',
            'scope': 'learner',
            'policy': {
              'profileId': 'high_assurance',
              'profileVersion': 'high-assurance-profile-v1',
            },
          });
          await model.act({'kind': 'add_to_learning'});
        }
        await model.act(
          reviewing
              ? {'kind': 'start_retention', 'early': false}
              : {'kind': 'start_or_resume'},
        );
        await ready();
        await tap(find.text('暂停'));
        await tap(find.byKey(const ValueKey('assurance-resume')));
        final release =
            (jsonDecode(artifact) as Map<String, dynamic>)['release'];
        var steps = 0;
        var played = false;
        var restoredDraft = false;
        var assisted = false;
        var failedReview = false;
        while (model.snapshot!.assurance!['completed'] != true) {
          expect(steps++, lessThan(40));
          final a = model.snapshot!.assurance!;
          final action = a['queue']['session']['action'];
          if (action['intent'] == 'instruction' ||
              action['intent'] == 'repair') {
            await tap(find.byKey(const ValueKey('assurance-reveal')));
            if (!played) {
              final audio = find.byIcon(Icons.volume_up_outlined);
              if (audio.evaluate().isNotEmpty) {
                await tap(audio.first);
                await tester.pump(const Duration(seconds: 2));
              }
              played = true;
            }
          } else {
            final r = a['resource'];
            if (r['kind'] == 'meaning_to_form_recall') {
              final f = find.byKey(const ValueKey('assurance-answer'));
              final lemma = a['teaching']['lemma'] as String;
              if (!reviewing && !assisted) {
                await tap(find.text('需要首字母提示'));
                assisted = true;
                expect(
                  model.snapshot!.assurance!['draft']['support'],
                  'first_letter',
                );
              }
              await tester.ensureVisible(f);
              await tester.enterText(
                f,
                reviewing && !failedReview ? 'wrong-answer' : lemma,
              );
              await tester.pump(const Duration(milliseconds: 400));
              await ready();
              if (!restoredDraft && !reviewing) {
                await model.load();
                await ready();
                expect(model.snapshot!.assurance!['draft']['text'], lemma);
                restoredDraft = true;
              }
            } else {
              final p = (release['packages'] as List).firstWhere(
                (p) => p['identity']['packageKey'] == action['packageId'],
              );
              final tasks = (p['assessmentInventory'] as Map).values
                  .whereType<List>()
                  .expand((x) => x);
              final task = tasks.firstWhere(
                (t) => t['taskKey'] == action['taskKey'],
              );
              final options = task['options'] as List;
              final correct = options.firstWhere(
                (o) => o['isCorrect'] == (!reviewing || failedReview),
              );
              await tap(
                find.byKey(
                  ValueKey('assurance-option-${correct['optionKey']}'),
                ),
              );
            }
            await tap(find.byKey(const ValueKey('assurance-submit')));
            if (reviewing && !failedReview) {
              expect(
                model.snapshot!.assurance!['draft']['evaluation']['outcome'],
                'miss',
              );
              failedReview = true;
            }
            expect(
              model.snapshot!.assurance!['draft']['evaluation'],
              isNotNull,
            );
          }
          await tap(find.byKey(const ValueKey('assurance-continue')));
        }
        expect(model.snapshot!.value['completionCount'], 1);
        expect(model.snapshot!.value['handoffCount'], 1);
        if (!reviewing) {
          expect(restoredDraft, isTrue);
          expect(assisted, isTrue);
        } else {
          expect(failedReview, isTrue);
          expect(model.snapshot!.retention['reviewCount'], 1);
          expect(model.snapshot!.retention['relearningCount'], 1);
        }
        expect(
          find.text(reviewing ? '本次复习与修复已完成' : '本次高保证首学已完成'),
          findsOneWidget,
        );
        await receipt.writeAsString(
          jsonEncode(model.snapshot!.value),
          flush: true,
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
