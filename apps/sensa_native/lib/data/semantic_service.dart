import 'dart:async';
import 'agent_provider.dart';
import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

class SemanticServiceException implements Exception {
  const SemanticServiceException(this.code);
  final String code;
}

/// Legacy wire adapters use the same protected Sensa service connection.
class SemanticService {
  SemanticService({this.providers});
  final AgentProviders Function()? providers;
  Uri? _legacyOrigin;
  String _legacyToken = '';
  Map<String, dynamic>? get connection {
    final p = providers?.call().forPurpose('service');
    return p?['kind'] == 'sensa' ? p : null;
  }

  bool get managed => providers?.call().profiles.isNotEmpty ?? false;
  Uri? get _origin => managed
      ? (connection == null ? null : Uri.parse(connection!['endpoint']))
      : _legacyOrigin;
  String get _token => managed
      ? (connection == null ? '' : providers!().credential(connection!['id']))
      : _legacyToken;
  String get origin => _origin?.origin ?? '';
  bool get configured => _origin != null && _token.isNotEmpty;
  void configure(String origin, String token) {
    final uri = Uri.tryParse(origin.trim());
    if (uri == null ||
        !uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.query.isNotEmpty ||
        uri.fragment.isNotEmpty ||
        (uri.path.isNotEmpty && uri.path != '/') ||
        !(uri.scheme == 'https' ||
            uri.scheme == 'http' &&
                ['localhost', '127.0.0.1', '::1'].contains(uri.host)) ||
        token.trim().isEmpty ||
        token.contains(RegExp(r'[\r\n]'))) {
      throw const SemanticServiceException('invalid_service_configuration');
    }
    _legacyOrigin = uri;
    _legacyToken = token.trim();
  }

  void clear() {
    _legacyOrigin = null;
    _legacyToken = '';
  }

  Future<Map<String, dynamic>> resolve(Map<String, dynamic> request) =>
      send(request, path: '/sensa/native/semantic/resolve');

  Future<void> cancelPreparation(Map<String, dynamic> request) async {
    await send(
      {'id': request['id'], 'inputDigest': request['inputDigest']},
      path: '/sensa/native/content/cancel',
      timeout: const Duration(seconds: 8),
    );
  }

  Future<Map<String, dynamic>> prepare(Map<String, dynamic> request) => send(
    request,
    path: '/sensa/native/content/prepare',
    timeout: const Duration(seconds: 80),
    maxBytes: 256 * 1024,
  );

  Future<Uint8List> pronunciation(Map<String, dynamic> reference) async {
    if (!configured) throw const SemanticServiceException('access_required');
    final endpoint = _origin!;
    final used = connection;
    final uri = endpoint
        .replace(
          path:
              '${endpoint.path.replaceFirst(RegExp(r'/+$'), '')}/sensa/native/content/pronunciation/${reference['digest']}',
        )
        .replace(
          queryParameters: {
            'expressionDigest': reference['sourceTextDigest'] as String,
          },
        );
    final token = _token;
    final client = http.Client();
    try {
      return await (() async {
        final response = await client.send(
          http.Request('GET', uri)
            ..followRedirects = false
            ..headers['Authorization'] = 'Bearer $token',
        );
        if ((response.statusCode == 401 || response.statusCode == 403) &&
            used != null) {
          await providers!().invalidate(used, token);
        }
        if (response.statusCode != 200 ||
            response.headers['content-type']?.split(';').first !=
                'audio/mpeg') {
          throw const SemanticServiceException('media_unavailable');
        }
        final expected = reference['byteSize'] as int;
        if (expected <= 0 || expected > 2097152) {
          throw const SemanticServiceException('invalid_response');
        }
        final bytes = BytesBuilder(copy: false);
        await for (final chunk in response.stream) {
          if (bytes.length + chunk.length > expected) {
            throw const SemanticServiceException('invalid_response');
          }
          bytes.add(chunk);
        }
        if (bytes.length != expected) {
          throw const SemanticServiceException('invalid_response');
        }
        return bytes.takeBytes();
      })().timeout(const Duration(seconds: 20));
    } finally {
      client.close();
    }
  }

  Future<Map<String, dynamic>> send(
    Map<String, dynamic> request, {
    required String path,
    Duration timeout = const Duration(seconds: 50),
    int maxBytes = 96 * 1024,
  }) async {
    if (!configured) throw const SemanticServiceException('access_required');
    final used = connection;
    final token = _token;
    final endpoint = _origin!;
    final client = http.Client();
    try {
      return await (() async {
        final message =
            http.Request(
                'POST',
                endpoint.replace(
                  path:
                      '${endpoint.path.replaceFirst(RegExp(r'/+$'), '')}$path',
                ),
              )
              ..followRedirects = false
              ..headers.addAll({
                'Authorization': 'Bearer $token',
                'Content-Type': 'application/json',
              })
              ..body = jsonEncode(request);
        final response = await client.send(message);
        if (response.statusCode == 401 || response.statusCode == 403) {
          if (used != null) await providers!().invalidate(used, token);
          throw const SemanticServiceException('access_required');
        }
        if (response.statusCode != 200) {
          throw const SemanticServiceException('provider_unavailable');
        }
        final bytes = <int>[];
        await for (final chunk in response.stream) {
          if (bytes.length + chunk.length > maxBytes) {
            throw const SemanticServiceException('invalid_response');
          }
          bytes.addAll(chunk);
        }
        final value = jsonDecode(utf8.decode(bytes));
        if (value is! Map<String, dynamic> ||
            value['id'] != request['id'] ||
            value['inputDigest'] != request['inputDigest']) {
          throw const SemanticServiceException('invalid_response');
        }
        return value;
      })().timeout(timeout);
    } on SemanticServiceException {
      rethrow;
    } on TimeoutException {
      throw const SemanticServiceException('lookup_timeout');
    } on FormatException {
      throw const SemanticServiceException('invalid_response');
    } catch (_) {
      throw const SemanticServiceException('network_unavailable');
    } finally {
      client.close();
    }
  }
}
