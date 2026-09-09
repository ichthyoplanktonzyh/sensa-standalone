import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'world_repository.dart';

Object? canonicalAgentJson(Object? value) {
  if (value is Map) {
    final keys = value.keys.cast<String>().toList()..sort();
    return {for (final k in keys) k: canonicalAgentJson(value[k])};
  }
  if (value is List) return value.map(canonicalAgentJson).toList();
  return value;
}

class AgentFailure implements Exception {
  const AgentFailure(this.code);
  final String code;
}

/// Persist only public connection preferences. Credentials never enter SQLite or files.
class AgentProviders {
  AgentProviders(this.file);
  final File file;
  List<Map<String, dynamic>> profiles = [];
  String? selected;
  final Map<String, String> _keys = {};
  Map<String, dynamic>? get current =>
      profiles.where((p) => p['id'] == selected).firstOrNull;
  bool get configured =>
      current != null && (_keys[selected]?.isNotEmpty ?? false);
  Future<void> load() async {
    if (!await file.exists()) return;
    final value = jsonDecode(await file.readAsString());
    final items = (value['profiles'] as List).cast<Map<String, dynamic>>();
    for (final p in items) {
      validate(p);
    }
    profiles = items;
    selected = value['selected'];
  }

  static void validate(Map<String, dynamic> p) {
    final uri = Uri.tryParse(p['endpoint'].toString());
    if (p['id'] is! String ||
        p['name'] is! String ||
        p['model'] is! String ||
        p['vision'] is! bool ||
        p['model'].toString().length > 100 ||
        p['name'].toString().length > 80 ||
        uri == null ||
        !uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.query.isNotEmpty ||
        uri.fragment.isNotEmpty ||
        !(uri.scheme == 'https' ||
            uri.scheme == 'http' &&
                ['localhost', '127.0.0.1', '::1'].contains(uri.host)) ||
        !['sensa', 'compatible'].contains(p['kind']) ||
        p['model'].toString().trim().isEmpty ||
        p['name'].toString().trim().isEmpty) {
      throw const AgentFailure('configuration');
    }
  }

  Future<void> save(Map<String, dynamic> p, String key) async {
    validate(p);
    if (key.contains(RegExp(r'[\r\n]'))) {
      throw const AgentFailure('configuration');
    }
    final previous = profiles.where((old) => old['id'] == p['id']).firstOrNull;
    if (previous != null &&
        (previous['endpoint'] != p['endpoint'] ||
            previous['kind'] != p['kind'])) {
      _keys.remove(p['id']);
    }
    if (key.trim().isNotEmpty) _keys[p['id']] = key.trim();
    profiles = [
      for (final old in profiles)
        if (old['id'] != p['id']) old,
      {
        for (final k in ['id', 'name', 'endpoint', 'model', 'kind', 'vision'])
          k: p[k],
      },
    ];
    selected = p['id'];
    await persist();
  }

  Future<void> persist() async {
    await file.parent.create(recursive: true);
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(
      jsonEncode({'profiles': profiles, 'selected': selected}),
      flush: true,
    );
    await tmp.rename(file.path);
  }

  Future<void> remove(String id) async {
    _keys.remove(id);
    profiles.removeWhere((p) => p['id'] == id);
    if (selected == id) selected = profiles.firstOrNull?['id'];
    await persist();
  }

  String credential(String id) => _keys[id] ?? '';
  void clear() {
    _keys.clear();
  }
}

class AgentTransport {
  http.Client? _client;
  void cancel() {
    _client?.close();
    _client = null;
  }

  Future<Map<String, dynamic>> complete(
    Map<String, dynamic> request,
    AgentProviders providers,
    WorldRepository media,
  ) async {
    final p = Map<String, dynamic>.from(request['provider']);
    final key = providers.credential(p['id']);
    if (key.isEmpty) throw const AgentFailure('credentials');
    AgentProviders.validate(p);
    final messages = (jsonDecode(jsonEncode(request['messages'])) as List)
        .cast<Map<String, dynamic>>();
    final material = request['material'];
    if (material != null) {
      final parts = <Map<String, dynamic>>[
        {'type': 'text', 'text': messages[1]['content']},
      ];
      var total = 0;
      for (final block in material['blocks']) {
        if (block['kind'] != 'image') continue;
        if (p['vision'] != true) throw const AgentFailure('vision');
        final bytes = await media.image(block['digest']);
        total += bytes.length;
        if (total > 6 * 1024 * 1024) throw const AgentFailure('size');
        final mime = bytes[0] == 137
            ? 'image/png'
            : bytes[0] == 255
            ? 'image/jpeg'
            : 'image/webp';
        parts.add({
          'type': 'image_url',
          'image_url': {'url': 'data:$mime;base64,${base64Encode(bytes)}'},
        });
      }
      messages[1]['content'] = parts;
    }
    final body = <String, dynamic>{
      'model': p['model'],
      if (Uri.parse(p['endpoint']).host == 'api.deepseek.com')
        'thinking': {'type': 'disabled'},
      'messages': messages,
      'max_tokens': 3000,
      'stream': false,
      if ((request['tools'] as List).isNotEmpty) 'tools': request['tools'],
      if (request['purpose'] == 'review')
        'response_format': {'type': 'json_object'},
    };
    final origin = Uri.parse(p['endpoint']);
    final path = origin.path.replaceFirst(RegExp(r'/+$'), '');
    final uri = origin.replace(
      path: p['kind'] == 'sensa'
          ? '$path/sensa/native/agent/turn'
          : '$path/chat/completions',
    );
    Map<String, dynamic> wire = body;
    if (p['kind'] == 'sensa') {
      wire = {'id': request['id'], 'purpose': request['purpose'], 'body': body};
      wire['inputDigest'] = sha256
          .convert(utf8.encode(jsonEncode(canonicalAgentJson(wire))))
          .toString();
    }
    final encoded = jsonEncode(wire);
    if (utf8.encode(encoded).length > 12 * 1024 * 1024) {
      throw const AgentFailure('size');
    }
    final client = http.Client();
    _client = client;
    try {
      return await (() async {
        final response = await client.send(
          http.Request('POST', uri)
            ..followRedirects = false
            ..headers.addAll({
              'Authorization': 'Bearer $key',
              'Content-Type': 'application/json',
            })
            ..body = encoded,
        );
        if (response.statusCode != 200) {
          throw AgentFailure(
            response.statusCode == 401 || response.statusCode == 403
                ? 'credentials'
                : response.statusCode == 413
                ? 'size'
                : 'provider',
          );
        }
        final bytes = <int>[];
        await for (final chunk in response.stream) {
          if (bytes.length + chunk.length > 256 * 1024) {
            throw const AgentFailure('response');
          }
          bytes.addAll(chunk);
        }
        final value = jsonDecode(utf8.decode(bytes));
        final content = p['kind'] == 'sensa' ? value['response'] : value;
        if (p['kind'] == 'sensa' &&
            (value['id'] != wire['id'] ||
                value['inputDigest'] != wire['inputDigest'])) {
          throw const AgentFailure('response');
        }
        final message = content['choices'][0]['message'];
        if (request['purpose'] == 'review') {
          final result = jsonDecode(message['content']);
          if (result['accepted'] is! bool || result['reason'] is! String) {
            throw const AgentFailure('response');
          }
          return {
            ...Map<String, dynamic>.from(result),
            'model_used': content['model'] is String ? content['model'] : '',
          };
        }
        return {
          'model_used': content['model'] is String ? content['model'] : '',
          'message': message['content'] ?? '',
          'calls': [
            for (final call in message['tool_calls'] ?? [])
              {
                'id': call['id'],
                'name': call['function']['name'],
                'args': jsonDecode(call['function']['arguments']),
              },
          ],
        };
      })().timeout(const Duration(seconds: 45));
    } on AgentFailure {
      rethrow;
    } on TimeoutException {
      throw const AgentFailure('timeout');
    } catch (_) {
      throw const AgentFailure('network');
    } finally {
      client.close();
      if (identical(_client, client)) _client = null;
    }
  }
}
