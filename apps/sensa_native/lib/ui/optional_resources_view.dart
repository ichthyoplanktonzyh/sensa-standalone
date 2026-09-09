import 'package:flutter/material.dart';

/// These resources were admitted with the immutable material by the local core.
/// Disclosure follows the same practice/instruction split as the Web contract.
class OptionalResourcesView extends StatelessWidget {
  const OptionalResourcesView({
    super.key,
    required this.material,
    required this.revealed,
  });
  final Map<String, dynamic> material;
  final bool revealed;
  @override
  Widget build(BuildContext context) {
    final resources = (material['resources'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final resource in resources)
          if ((resource['materialRoleKey'] == 'recall_support') == !revealed)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: _resource(resource),
            ),
      ],
    );
  }

  Widget _resource(Map<String, dynamic> resource) {
    final p = resource['contentPayload'] as Map<String, dynamic>;
    final label = switch (resource['materialRoleKey']) {
      'recall_support' => '回忆提示',
      'pronunciation' => '发音',
      'language_structure' => '语言结构',
      'usage_guidance' => '用法例句',
      'scene_bridge' => '联系场景',
      _ => '',
    };
    final body = switch (resource['materialRoleKey']) {
      'pronunciation' => [
        p['phoneticNotation'],
        p['accentLabel'],
      ].whereType<String>().join(' · '),
      'language_structure' => [
        p['expressionTypeLabel'],
        p['partOfSpeech'],
      ].whereType<String>().join(' · '),
      'usage_guidance' => p['example'] as String,
      _ => p['text'] as String,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        Text(body),
      ],
    );
  }
}
