import '../l10n/interface_locale.dart';
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
              child: _resource(context, resource),
            ),
      ],
    );
  }

  Widget _resource(BuildContext context, Map<String, dynamic> resource) {
    final p = resource['contentPayload'] as Map<String, dynamic>;
    final label = switch (resource['materialRoleKey']) {
      'recall_support' => context.l10n.uiRecallHint,
      'pronunciation' => context.l10n.uiPronunciation,
      'language_structure' => context.l10n.uiLanguageStructure,
      'usage_guidance' => context.l10n.uiUsageExamples,
      'scene_bridge' => context.l10n.uiRelatedScene,
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
