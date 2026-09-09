import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class OnlineAuthFailure implements Exception {
  const OnlineAuthFailure(this.code);
  final String code;
}

/// Supabase email OTP/refresh protocol, matching the retained Web sign-in flow.
class ProviderAuth {
  static Uri base(String address) {
    final u = Uri.parse(address);
    if (!u.hasAuthority ||
        u.host.isEmpty ||
        address.length > 500 ||
        u.userInfo.isNotEmpty ||
        u.query.isNotEmpty ||
        u.fragment.isNotEmpty ||
        (u.path.isNotEmpty && u.path != '/') ||
        !(u.scheme == 'https' ||
            u.scheme == 'http' &&
                ['localhost', '127.0.0.1', '::1'].contains(u.host))) {
      throw const OnlineAuthFailure('configuration');
    }
    return u;
  }

  static Future<Map<String, dynamic>> request(
    String address,
    String apiKey,
    String path,
    Map<String, dynamic> body, {
    String? access,
  }) async {
    final u = base(address).replace(
      path: '/auth/v1/${path.split('?').first}',
      query: path.contains('?') ? path.split('?').last : null,
    );
    if (apiKey.trim().isEmpty || apiKey.contains(RegExp(r'[\r\n]'))) {
      throw const OnlineAuthFailure('configuration');
    }
    final client = http.Client();
    try {
      return await (() async {
        final response = await client.send(
          http.Request('POST', u)
            ..followRedirects = false
            ..headers.addAll({
              'apikey': apiKey,
              'Authorization': 'Bearer ${access ?? apiKey}',
              'Content-Type': 'application/json',
            })
            ..body = jsonEncode(body),
        );
        final bytes = <int>[];
        await for (final chunk in response.stream) {
          if (bytes.length + chunk.length > 32000) {
            throw const OnlineAuthFailure('response');
          }
          bytes.addAll(chunk);
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw OnlineAuthFailure(
            response.statusCode == 429
                ? 'rate_limit'
                : response.statusCode == 400 ||
                      response.statusCode == 401 ||
                      response.statusCode == 403
                ? 'invalid'
                : 'unavailable',
          );
        }
        return bytes.isEmpty
            ? <String, dynamic>{}
            : Map<String, dynamic>.from(jsonDecode(utf8.decode(bytes)));
      })().timeout(const Duration(seconds: 12));
    } on OnlineAuthFailure {
      rethrow;
    } catch (_) {
      throw const OnlineAuthFailure('unavailable');
    } finally {
      client.close();
    }
  }

  static Future<void> sendCode(
    String address,
    String apiKey,
    String email,
  ) async {
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email.trim())) {
      throw const OnlineAuthFailure('email');
    }
    await request(address, apiKey, 'otp', {
      'email': email.trim(),
      'create_user': false,
    });
  }

  static Map<String, dynamic> session(
    Map<String, dynamic> result,
    String address,
    String apiKey,
  ) {
    for (final key in ['access_token', 'refresh_token']) {
      if (result[key] is! String ||
          (result[key] as String).isEmpty ||
          (result[key] as String).contains(RegExp(r'[\r\n]'))) {
        throw const OnlineAuthFailure('response');
      }
    }
    if (result['user']?['id'] is! String ||
        result['user']?['email'] is! String ||
        result['expires_in'] is! num ||
        result['expires_in'] <= 0 ||
        result['expires_in'] > 604800) {
      throw const OnlineAuthFailure('response');
    }
    return {
      'authUrl': address,
      'apiKey': apiKey,
      'access': result['access_token'],
      'refresh': result['refresh_token'],
      'subject': result['user']['id'],
      'email': result['user']['email'],
      'expiresAt':
          DateTime.now().millisecondsSinceEpoch +
          (result['expires_in'] as num).toInt() * 1000,
    };
  }

  static Future<Map<String, dynamic>> verify(
    String address,
    String apiKey,
    String email,
    String code,
  ) async {
    final result = session(
      await request(address, apiKey, 'verify', {
        'email': email.trim(),
        'token': code.trim(),
        'type': 'email',
      }),
      address,
      apiKey,
    );
    if ((result['email'] as String).toLowerCase() !=
        email.trim().toLowerCase()) {
      throw const OnlineAuthFailure('invalid');
    }
    return result;
  }

  static Future<void> authorizeService(
    String endpoint,
    Map<String, dynamic> session,
  ) => _service(endpoint, session, '/sensa/native/access/session', {
    'installationId': session['installationId'],
  }, 'authorized');
  static Future<void> revokeService(
    String endpoint,
    Map<String, dynamic> session,
    String operationId,
  ) => _service(endpoint, session, '/sensa/account/session/revoke', {
    'operationId': operationId,
  }, 'revoked');
  static Future<void> _service(
    String endpoint,
    Map<String, dynamic> session,
    String path,
    Map<String, dynamic> body,
    String resultKey,
  ) async {
    final uri = Uri.parse(endpoint);
    // Provider configuration already applies the same HTTPS/loopback and credential-free URL rules.
    final client = http.Client();
    try {
      await (() async {
        final response = await client
            .send(
              http.Request(
                  'POST',
                  uri.replace(
                    path: '${uri.path.replaceFirst(RegExp(r'/+$'), '')}$path',
                  ),
                )
                ..followRedirects = false
                ..headers.addAll({
                  'Authorization': 'Bearer ${session['access']}',
                  'Content-Type': 'application/json',
                })
                ..body = jsonEncode(body),
            )
            .timeout(const Duration(seconds: 12));
        final bytes = <int>[];
        await for (final chunk in response.stream.timeout(
          const Duration(seconds: 12),
        )) {
          if (bytes.length + chunk.length > 4096) {
            throw const OnlineAuthFailure('response');
          }
          bytes.addAll(chunk);
        }
        if (response.statusCode != 200 ||
            jsonDecode(utf8.decode(bytes))[resultKey] != true) {
          throw const OnlineAuthFailure('access');
        }
      })().timeout(const Duration(seconds: 12));
    } on OnlineAuthFailure {
      rethrow;
    } catch (_) {
      throw const OnlineAuthFailure('unavailable');
    } finally {
      client.close();
    }
  }

  static Future<Map<String, dynamic>> refresh(Map<String, dynamic> old) async {
    final next = session(
      await request(
        old['authUrl'],
        old['apiKey'],
        'token?grant_type=refresh_token',
        {'refresh_token': old['refresh']},
      ),
      old['authUrl'],
      old['apiKey'],
    );
    if (next['subject'] != old['subject']) {
      throw const OnlineAuthFailure('invalid');
    }
    return {
      ...next,
      'installationId': old['installationId'],
      'authorized': false,
    };
  }
}
