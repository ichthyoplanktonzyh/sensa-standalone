import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/data/agent_stream.dart';

String event(Map<String, dynamic> delta, [String? finish]) =>
    'data: ${jsonEncode({
      'model': 'fixture',
      'choices': [
        {'index': 0, 'delta': delta, 'finish_reason': finish},
      ],
    })}\n\n';
Stream<List<int>> bytes(String s) =>
    Stream.fromIterable(utf8.encode(s).map((b) => [b]));
void main() {
  test(
    'split UTF8 and arguments commit only after complete terminator',
    () async {
      final wire =
          '${event({'content': '语言老师'})}${event({
            'tool_calls': [
              {
                'index': 0,
                'id': 'call-1',
                'type': 'function',
                'function': {
                  'name': 'ask_learner',
                  'arguments': '{"question":',
                },
              },
            ],
          })}${event({
            'tool_calls': [
              {
                'index': 0,
                'function': {'arguments': '"再说一句？"}'},
              },
            ],
          }, 'tool_calls')}data: [DONE]\n\n';
      final previews = <String>[];
      final result = await readAgentStream(
        bytes(wire),
        onPreview: previews.add,
      );
      expect(previews.last, '语言老师');
      final message = result['choices'][0]['message'];
      expect(jsonDecode(message['tool_calls'][0]['function']['arguments']), {
        'question': '再说一句？',
      });
      expect(message['tool_calls'][0]['id'], 'call-1');
    },
  );
  test(
    'truncation, length cutoff, late data and excessive bytes reject',
    () async {
      for (final wire in [
        event({'content': '未完成'}),
        '${event({'content': '未完成'}, 'length')}data: [DONE]\n\n',
        '${event({'content': '完成'}, 'stop')}data: [DONE]\n\n${event({'content': '多余'})}',
        '${event({'content': 'x' * (256 * 1024)}, 'stop')}data: [DONE]\n\n',
      ]) {
        await expectLater(readAgentStream(bytes(wire)), throwsFormatException);
      }
    },
  );
}
