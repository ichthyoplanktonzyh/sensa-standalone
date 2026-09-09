import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sensa_native/main.dart';
import 'package:sensa_native/data/agent_provider.dart';
import 'package:sensa_native/ui/provider_login_screen.dart';
import 'package:sensa_native/src/rust/frb_generated.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const run = String.fromEnvironment('SENSA_NATIVE_RUN');
  const recovery = bool.fromEnvironment('SENSA_NATIVE_RECOVERY');
  setUpAll(() async => RustLib.init());
  testWidgets(
    'email login, secure refresh, account isolation and local-only logout',
    (tester) async {
      final model = await createLibrary(name: 'account-$run.sqlite');
      addTearDown(model.dispose);
      final c = model.agents;
      await c.load();
      final p = c.providers;
      final receipt = File('${model.repository.path}.account-receipt');
      Future<void> wait() async {
        for (var i = 0; i < 40; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      Future<void> tap(String label) async {
        final f = find.text(label).last;
        await tester.ensureVisible(f);
        await tester.pumpAndSettle();
        await tester.tap(f);
        await wait();
      }

      Future<void> enter(String key, String value) async {
        final f = find.byKey(ValueKey(key));
        await tester.ensureVisible(f);
        await tester.tap(f);
        await tester.enterText(f, value);
        FocusManager.instance.primaryFocus?.unfocus();
        await wait();
      }

      Future<void> show(Map<String, dynamic> profile) async {
        await tester.pumpWidget(
          MaterialApp(
            home: ProviderLoginScreen(controller: c, profile: profile),
          ),
        );
        await wait();
      }

      if (recovery) {
        expect(model.snapshot!.value, jsonDecode(await receipt.readAsString()));
        expect(p.accountEmail('account-fixture'), 'learner@example.invalid');
        // The fixture is no longer running. An unexpired secure session is usable without a refresh call.
        await p.ensureAccess('service');
        expect(p.credential('account-fixture'), 'synthetic-access-2');
        final before = model.snapshot!.value;
        await show(p.profiles.firstWhere((v) => v['id'] == 'account-fixture'));
        await tap('退出在线账户');
        expect(p.credential('account-fixture'), '');
        await p.load();
        expect(p.accountEmail('account-fixture'), isNull);
        await model.load();
        expect(model.snapshot!.value, before);
        expect(find.text('已退出本机在线服务账户。'), findsOneWidget);
        return;
      }
      var sends = 0, verifies = 0, refreshes = 0;
      String? fixtureFailure;
      var allowAccess = false;
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        request.response.headers.contentType = ContentType.json;
        try {
          if (request.uri.path == '/sensa/native/access/session') {
            final body =
                jsonDecode(await utf8.decoder.bind(request).join()) as Map;
            if (body.keys.single != 'installationId' ||
                ![
                  'Bearer synthetic-access-1',
                  'Bearer synthetic-access-2',
                ].contains(request.headers.value('authorization'))) {
              throw StateError('invalid native session bootstrap');
            }
            if (!allowAccess) {
              request.response.statusCode = 403;
              request.response.write('{}');
              await request.response.close();
              return;
            }
            request.response.write('{"authorized":true}');
            await request.response.close();
            return;
          }
          if (request.headers.value('apikey') != 'synthetic-publishable') {
            throw StateError('fixture key mismatch');
          }
          final body = jsonDecode(await utf8.decoder.bind(request).join());
          Map<String, dynamic> session(
            String email,
            int expires,
            String access,
          ) => {
            'access_token': access,
            'refresh_token': email.startsWith('invalid')
                ? 'synthetic-rejected-refresh'
                : 'synthetic-refresh-1',
            'expires_in': expires,
            'user': {'id': email, 'email': email},
          };
          if (request.uri.path == '/auth/v1/otp') {
            if (body['create_user'] != false) {
              throw StateError('signup must remain disabled');
            }
            sends++;
            request.response.write('{}');
          } else if (request.uri.path == '/auth/v1/verify') {
            verifies++;
            if (body['type'] != 'email') throw StateError('OTP type mismatch');
            if (body['token'] != '123456') {
              request.response.statusCode = 400;
              request.response.write('{}');
            } else {
              request.response.write(
                jsonEncode(session(body['email'], 1, 'synthetic-access-1')),
              );
            }
          } else if (request.uri.path == '/auth/v1/token') {
            refreshes++;
            if (request.uri.queryParameters['grant_type'] != 'refresh_token') {
              throw StateError('refresh grant mismatch');
            }
            if (body['refresh_token'] == 'synthetic-rejected-refresh') {
              request.response.statusCode = 400;
              request.response.write('{}');
            } else {
              request.response.write(
                jsonEncode(
                  session(
                    'learner@example.invalid',
                    3600,
                    'synthetic-access-2',
                  ),
                ),
              );
            }
          } else {
            throw StateError('unexpected auth request');
          }
        } catch (e) {
          fixtureFailure = e.toString();
          request.response.statusCode = 500;
          request.response.write('{}');
        }
        await request.response.close();
      });
      final address = 'http://127.0.0.1:${server.port}';
      await model.act({'kind': 'confirm_quantity', 'quantity': 5});
      final before = model.snapshot!.value;
      final profile = <String, dynamic>{
        'id': 'account-fixture',
        'name': '账户验收',
        'endpoint': address,
        'model': 'fixture',
        'kind': 'sensa',
        'vision': false,
      };
      await p.save(profile, '');
      await p.assign('service', profile['id']);
      await p.assign('content', profile['id']);
      await show(profile);
      await enter('auth-url', address);
      await enter('auth-key', 'synthetic-publishable');
      await enter('auth-email', 'learner@example.invalid');
      await tap('发送验证码');
      expect(
        sends,
        1,
        reason:
            '${fixtureFailure ?? ''} ${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data).join(' | ')}',
      );
      await enter('auth-code', '000000');
      await tap('验证并登录');
      expect(p.credential(profile['id']), '');
      expect(find.text('验证码或登录凭据已失效，请重新登录。'), findsOneWidget);
      await enter('auth-code', '123456');
      await tap('验证并登录');
      expect(verifies, 2);
      expect(p.accountEmail(profile['id']), 'learner@example.invalid');
      expect(p.ready('service'), false);
      await expectLater(
        Future.wait([p.ensureAccess('service'), p.ensureAccess('content')]),
        throwsA(isA<AgentFailure>()),
      );
      // A failed service bootstrap must not lose the newly rotated refresh token.
      expect(p.credential(profile['id']), 'synthetic-access-2');
      allowAccess = true;
      await tap('检查在线访问');
      expect(p.ready('service'), true);
      expect(refreshes, 1);
      expect(p.credential(profile['id']), 'synthetic-access-2');
      await p.load();
      expect(p.accountEmail(profile['id']), 'learner@example.invalid');
      final public = await p.file.readAsString();
      for (final secret in [
        'synthetic-access',
        'synthetic-refresh',
        'synthetic-publishable',
        'learner@example.invalid',
      ]) {
        expect(public, isNot(contains(secret)));
      }
      final copy = File('${model.repository.path}.copied-config');
      await copy.writeAsString(public);
      addTearDown(() => copy.delete());
      final other = AgentProviders(copy);
      await other.load();
      expect(other.credential(profile['id']), '');
      expect(other.accountEmail(profile['id']), isNull);
      final invalid = {...profile, 'id': 'invalid-fixture'};
      await p.save(invalid, '');
      await p.login(
        invalid,
        address,
        'synthetic-publishable',
        'invalid@example.invalid',
        '123456',
      );
      await p.assign('review', invalid['id']);
      await expectLater(p.ensureAccess('review'), throwsA(isA<AgentFailure>()));
      expect(p.credential(invalid['id']), '');
      await model.load();
      expect(
        model.snapshot!.value,
        before,
        reason: 'Authentication must not mutate local learning facts',
      );
      await receipt.writeAsString(
        jsonEncode(model.snapshot!.value),
        flush: true,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
