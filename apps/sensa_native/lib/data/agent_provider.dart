import '../l10n/interface_locale.dart';
import 'provider_auth.dart';
import 'agent_stream.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'world_repository.dart';
import 'provider_credentials.dart';
import 'package:uuid/uuid.dart';

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

/// Public preferences and role routing are separate from OS-protected credentials.
class AgentProviders {
  AgentProviders(this.file, {this.vault = const ProviderCredentials()});
  final File file;
  final ProviderCredentials vault;
  Future<void> _pending = Future.value();
  Future<void> _serial(Future<void> Function() work) {
    final next = _pending.then((_) => work());
    _pending = next.catchError((_) {});
    return next;
  }

  List<Map<String, dynamic>> profiles = [];
  String? selected;
  Map<String, String?> roles = {};
  final Map<String, String> _keys = {};
  final Map<String, Map<String, dynamic>> _sessions = {};
  String? accountEmail(String id) => _sessions[id]?['email'];
  final Map<String, String> credentialStates = {};
  Map<String, dynamic>? forPurpose(String purpose) => profiles
      .where(
        (p) =>
            p['id'] ==
                (roles.containsKey(purpose) ? roles[purpose] : selected) &&
            (purpose != 'service' || p['kind'] == 'sensa'),
      )
      .firstOrNull;
  Map<String, dynamic>? get current => forPurpose('teacher');
  bool ready(String purpose) =>
      forPurpose(purpose) != null &&
      credential(forPurpose(purpose)!['id']).isNotEmpty &&
      (_sessions[forPurpose(purpose)!['id']] == null ||
          _sessions[forPurpose(purpose)!['id']]!['authorized'] == true);
  bool get configured => ready('teacher');
  Map<String, dynamic> connection(Map<String, dynamic> p) => {
    for (final k in ['id', 'name', 'endpoint', 'model', 'kind', 'vision'])
      k: p[k],
  };
  String fingerprint(Map<String, dynamic> p) => sha256
      .convert(
        utf8.encode(
          '${file.absolute.path}\n${p['id']}\n${p['kind']}\n${p['endpoint']}',
        ),
      )
      .toString();
  Future<void> load() => _serial(_load);
  Future<void> _load() async {
    if (!await file.exists()) return;
    final value = jsonDecode(await file.readAsString());
    final items = (value['profiles'] as List).cast<Map<String, dynamic>>();
    for (final p in items) {
      validate(p);
    }
    profiles = items;
    selected = value['selected'];
    roles = Map<String, String?>.from(value['roles'] ?? {});
    await _unlock();
  }

  Future<void> unlock() => _serial(_unlock);
  Future<void> _unlock() async {
    _keys.clear();
    _sessions.clear();
    for (final p in profiles) {
      final id = p['id'] as String;
      credentialStates[id] = 'missing';
      if (p['credentialInvalid'] == true) {
        credentialStates[id] = 'invalid';
        continue;
      }
      final ref = p['credentialRef'];
      if (ref is! String) continue;
      try {
        final raw = await vault.read(ref);
        if (raw == null) continue;
        final entry = jsonDecode(raw);
        if (entry['fingerprint'] != fingerprint(p)) {
          credentialStates[id] = 'changed';
          continue;
        }
        if (entry['invalid'] == true) {
          credentialStates[id] = 'invalid';
          continue;
        }
        final key = entry['credential'];
        if (key is String &&
            key.isNotEmpty &&
            !key.contains(RegExp(r'[\r\n]'))) {
          _keys[id] = key;
          if (p['kind'] == 'sensa' && entry['session'] is Map) {
            final session = Map<String, dynamic>.from(entry['session']);
            if (session['access'] == key) _sessions[id] = session;
          }
          credentialStates[id] = 'saved';
        }
      } catch (_) {
        credentialStates[id] = 'locked';
      }
    }
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

  Future<void> save(Map<String, dynamic> p, String key) =>
      _serial(() => _save(Map<String, dynamic>.from(p), key));
  Future<void> _save(
    Map<String, dynamic> p,
    String key, {
    Map<String, dynamic>? session,
  }) async {
    validate(p);
    if (key.contains(RegExp(r'[\r\n]'))) {
      throw const AgentFailure('configuration');
    }
    final old = profiles.where((v) => v['id'] == p['id']).firstOrNull;
    final same = old != null && fingerprint(old) == fingerprint(p);
    String? ref = same ? old['credentialRef'] : null;
    String? created;
    if (key.trim().isNotEmpty) {
      ref = created = const Uuid().v4();
      try {
        await vault.write(
          ref,
          jsonEncode({
            'fingerprint': fingerprint(p),
            'credential': key.trim(),
            'session': ?session,
          }),
        );
      } catch (_) {
        try {
          await vault.delete(ref);
        } catch (_) {}
        throw const AgentFailure('secure_storage');
      }
    }
    final updated = {
      ...connection(p),
      'credentialRef': ?ref,
      if (same && key.trim().isEmpty && old['credentialInvalid'] == true)
        'credentialInvalid': true,
    };
    final next = [
      for (final v in profiles)
        if (v['id'] != p['id']) v,
      updated,
    ];
    try {
      await _persist(next, selected ?? p['id'], roles);
    } catch (_) {
      if (created != null) {
        try {
          await vault.delete(created);
        } catch (_) {}
      }
      rethrow;
    }
    profiles = next;
    selected ??= p['id'];
    _keys.remove(p['id']);
    _sessions.remove(p['id']);
    if (key.trim().isNotEmpty) {
      _keys[p['id']] = key.trim();
      if (session != null) _sessions[p['id']] = session;
    } else if (same) {
      await _unlock();
    }
    if (!same || key.trim().isNotEmpty) {
      credentialStates[p['id']] = _keys.containsKey(p['id'])
          ? 'saved'
          : 'missing';
    }
    if (old?['credentialRef'] != null && old!['credentialRef'] != ref) {
      try {
        await vault.delete(old['credentialRef']);
      } catch (_) {}
    }
  }

  Future<void> login(
    Map<String, dynamic> p,
    String address,
    String apiKey,
    String email,
    String code,
  ) => _serial(() async {
    if (p['kind'] != 'sensa' ||
        !profiles.any((v) => fingerprint(v) == fingerprint(p))) {
      throw const AgentFailure('configuration');
    }
    final session = {
      ...await ProviderAuth.verify(address, apiKey, email, code),
      'installationId': const Uuid().v4(),
      'authorized': false,
    };
    await _save(p, session['access'], session: session);
    await ProviderAuth.authorizeService(p['endpoint'], session);
    await _save(
      p,
      session['access'],
      session: {...session, 'authorized': true},
    );
  });
  Future<void> ensureAccess(String purpose) => _serial(() async {
    final p = forPurpose(purpose);
    if (p == null) return;
    var session = _sessions[p['id']];
    if (session == null) return;
    try {
      if ((session['expiresAt'] as int) <=
          DateTime.now().millisecondsSinceEpoch + 60000) {
        session = await ProviderAuth.refresh(session);
        // Persist rotated refresh credentials before any separate service request can fail.
        await _save(p, session['access'], session: session);
      }
      if (session['authorized'] != true) {
        await ProviderAuth.authorizeService(p['endpoint'], session);
        await _save(
          p,
          session['access'],
          session: {...session, 'authorized': true},
        );
      }
    } on OnlineAuthFailure catch (e) {
      if (e.code == 'invalid') await _forget(p['id']);
      throw const AgentFailure('credentials');
    }
  });
  Future<void> logout(String id) => _serial(() async {
    final session = _sessions[id];
    final endpoint =
        profiles.firstWhere((p) => p['id'] == id)['endpoint'] as String;
    // Clear local access even when offline; local learning and library ownership do not change.
    await _forget(id);
    if (session != null) {
      try {
        await ProviderAuth.revokeService(endpoint, session, const Uuid().v4());
      } catch (_) {}
      try {
        await ProviderAuth.request(
          session['authUrl'],
          session['apiKey'],
          'logout?scope=local',
          {},
          access: session['access'],
        );
      } catch (_) {}
    }
  });

  Future<void> assign(String purpose, String? id) =>
      _serial(() => _assign(purpose, id));
  Future<void> _assign(String purpose, String? id) async {
    if (id != null &&
        !profiles.any(
          (p) =>
              p['id'] == id && (purpose != 'service' || p['kind'] == 'sensa'),
        )) {
      throw const AgentFailure('configuration');
    }
    final next = {...roles, purpose: id};
    await _persist(profiles, selected, next);
    roles = next;
  }

  Future<void> _persist(
    List<Map<String, dynamic>> list,
    String? choice,
    Map<String, String?> assignments,
  ) async {
    await file.parent.create(recursive: true);
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(
      jsonEncode({
        'version': 2,
        'profiles': list,
        'selected': choice,
        'roles': assignments,
      }),
      flush: true,
    );
    await tmp.rename(file.path);
  }

  Future<void> persist() => _serial(() => _persist(profiles, selected, roles));
  Future<void> forget(String id) => _serial(() => _forget(id));
  Future<void> _forget(String id) async {
    final p = profiles.firstWhere((p) => p['id'] == id);
    _keys.remove(id);
    _sessions.remove(id);
    credentialStates[id] = 'missing';
    if (p['credentialRef'] != null) {
      try {
        await vault.delete(p['credentialRef']);
      } catch (_) {
        credentialStates[id] = 'locked';
        throw const AgentFailure('secure_storage');
      }
    }
    final next = [
      for (final v in profiles)
        if (v['id'] == id) connection(v) else v,
    ];
    await _persist(next, selected, roles);
    profiles = next;
  }

  Future<void> remove(String id) => _serial(() => _remove(id));
  Future<void> _remove(String id) async {
    await _forget(id);
    final next = profiles.where((p) => p['id'] != id).toList();
    final assignments = {
      for (final e in roles.entries) e.key: e.value == id ? null : e.value,
    };
    // Deletion never silently routes calls to another service.
    for (final purpose in ['teacher', 'content', 'review', 'service']) {
      if (forPurpose(purpose)?['id'] == id) assignments[purpose] = null;
    }
    final choice = selected == id ? null : selected;
    await _persist(next, choice, assignments);
    profiles = next;
    selected = choice;
    roles = assignments;
  }

  Future<void> invalidate(Map<String, dynamic> used, String attemptedKey) =>
      _serial(() => _invalidate(used, attemptedKey));
  Future<void> _invalidate(
    Map<String, dynamic> used,
    String attemptedKey,
  ) async {
    final p = profiles.where((p) => p['id'] == used['id']).firstOrNull;
    if (p == null ||
        fingerprint(p) != fingerprint(used) ||
        credential(p['id']) != attemptedKey) {
      return;
    }
    _keys.remove(p['id']);
    _sessions.remove(p['id']);
    credentialStates[p['id']] = 'invalid';
    final next = [
      for (final v in profiles)
        if (v['id'] == p['id']) {...v, 'credentialInvalid': true} else v,
    ];
    try {
      await _persist(next, selected, roles);
      profiles = next;
    } catch (_) {}
    if (p['credentialRef'] != null) {
      try {
        await vault.write(
          p['credentialRef'],
          jsonEncode({'fingerprint': fingerprint(p), 'invalid': true}),
        );
      } catch (_) {}
    }
  }

  String credential(String id) => _keys[id] ?? '';
  String status(String id) {
    final session = _sessions[id];
    if (session != null && session['authorized'] != true) {
      return l10n.uiEmailVerifiedWaitingForServiceAccess;
    }
    return switch (credentialStates[id]) {
      'saved' => l10n.uiCredentialsSavedSecurely,
      'invalid' => l10n.uiCredentialsExpiredUpdateThem,
      'locked' => l10n.uiSecureStorageUnavailable,
      'changed' => l10n.uiServiceChangedEnterCredentialsAgain,
      _ => l10n.uiCredentialsRequired,
    };
  }

  void clear() {
    _sessions.clear();
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
    WorldRepository media, {
    void Function(String)? onPreview,
  }) async {
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
      'stream': p['kind'] == 'compatible' && request['purpose'] != 'review',
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
        if (response.statusCode == 401 || response.statusCode == 403) {
          await providers.invalidate(p, key);
        }
        if (response.statusCode != 200) {
          throw AgentFailure(
            response.statusCode == 401 || response.statusCode == 403
                ? 'credentials'
                : response.statusCode == 413
                ? 'size'
                : 'provider',
          );
        }
        dynamic value;
        if ((response.headers['content-type'] ?? '').startsWith(
          'text/event-stream',
        )) {
          if (p['kind'] != 'compatible') throw const AgentFailure('response');
          value = await readAgentStream(response.stream, onPreview: onPreview);
        } else {
          final bytes = <int>[];
          await for (final chunk in response.stream) {
            if (bytes.length + chunk.length > 256 * 1024) {
              throw const AgentFailure('response');
            }
            bytes.addAll(chunk);
          }
          value = jsonDecode(utf8.decode(bytes));
        }
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
    } on FormatException {
      throw const AgentFailure('response');
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
