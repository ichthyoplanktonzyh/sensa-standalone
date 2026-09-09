import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class SemanticServiceException implements Exception {
  const SemanticServiceException(this.code);
  final String code;
}

/// Credentials remain in memory. No provider key belongs in a local library.
class SemanticService {
  Uri? _origin;
  String _token = '';
  String get origin => _origin?.toString() ?? '';
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
    _origin = uri;
    _token = token.trim();
  }

  void clear() {
    _origin = null;
    _token = '';
  }

  Future<Map<String, dynamic>> resolve(Map<String, dynamic> request) async {
    if (!configured) throw const SemanticServiceException('access_required');
    final client = http.Client();
    try {
      return await (() async {
        final message =
            http.Request(
                'POST',
                _origin!.resolve('/sensa/native/semantic/resolve'),
              )
              ..followRedirects = false
              ..headers.addAll({
                'Authorization': 'Bearer $_token',
                'Content-Type': 'application/json',
              })
              ..body = jsonEncode(request);
        final response = await client.send(message);
        if (response.statusCode == 401 || response.statusCode == 403) {
          throw const SemanticServiceException('access_required');
        }
        if (response.statusCode != 200) {
          throw const SemanticServiceException('provider_unavailable');
        }
        final bytes = <int>[];
        await for (final chunk in response.stream) {
          if (bytes.length + chunk.length > 96 * 1024) {
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
      })().timeout(const Duration(seconds: 50));
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
