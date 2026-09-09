import 'dart:convert';

/// Buffers tool arguments until a complete, bounded SSE response is received.
/// The optional preview is ephemeral text; it never executes tools or commits facts.
Future<Map<String, dynamic>> readAgentStream(
  Stream<List<int>> stream, {
  void Function(String)? onPreview,
}) async {
  var size = 0;
  var done = false, finished = false;
  var content = '', model = '';
  final calls = <int, Map<String, dynamic>>{};
  final lines = stream
      .map((chunk) {
        size += chunk.length;
        if (size > 256 * 1024) throw const FormatException('response_limit');
        return chunk;
      })
      .transform(utf8.decoder)
      .transform(const LineSplitter());
  await for (final line in lines) {
    if (line.isEmpty || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) throw const FormatException('invalid_sse');
    final data = line.substring(5).trim();
    if (data == '[DONE]') {
      done = true;
      continue;
    }
    if (done) throw const FormatException('data_after_done');
    final value = jsonDecode(data) as Map<String, dynamic>;
    if (value['model'] is String) model = value['model'];
    final choices = value['choices'] as List;
    if (choices.isEmpty) continue;
    if (choices.length != 1 || choices[0]['index'] != 0 || finished) {
      throw const FormatException('invalid_choice');
    }
    final choice = choices[0];
    final delta = choice['delta'] as Map<String, dynamic>;
    if (delta['content'] != null) {
      content += delta['content'] as String;
      onPreview?.call(content);
    }
    for (final part in delta['tool_calls'] ?? []) {
      final index = part['index'] as int;
      if (index < 0 || index > 3) throw const FormatException('tool_limit');
      final call = calls.putIfAbsent(
        index,
        () => {
          'id': '',
          'type': 'function',
          'function': {'name': '', 'arguments': ''},
        },
      );
      if (part['type'] != null && part['type'] != 'function') {
        throw const FormatException('tool_type');
      }
      if (part['id'] != null) call['id'] += part['id'] as String;
      for (final key in ['name', 'arguments']) {
        if (part['function']?[key] != null) {
          call['function'][key] += part['function'][key] as String;
        }
      }
    }
    if (choice['finish_reason'] != null) {
      final reason = choice['finish_reason'];
      if (reason != (calls.isEmpty ? 'stop' : 'tool_calls')) {
        throw const FormatException('incomplete_response');
      }
      finished = true;
    }
  }
  if (!done || !finished) throw const FormatException('truncated_response');
  final ordered = calls.keys.toList()..sort();
  return {
    'model': model,
    'choices': [
      {
        'message': {
          'content': content,
          'tool_calls': [for (final index in ordered) calls[index]],
        },
      },
    ],
  };
}
