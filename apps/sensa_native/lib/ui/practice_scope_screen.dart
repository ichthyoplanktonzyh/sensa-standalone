import 'package:flutter/material.dart';
import '../l10n/interface_locale.dart';
import 'product_theme.dart';

class PracticeScopeScreen extends StatefulWidget {
  const PracticeScopeScreen({super.key, required this.catalog});
  final Map<String, dynamic> catalog;
  @override
  State<PracticeScopeScreen> createState() => _PracticeScopeScreenState();
}

class _PracticeScopeScreenState extends State<PracticeScopeScreen> {
  late String source = widget.catalog['selection']['sourceId'];
  late final Set<String> chosen =
      ((widget.catalog['selection']['targetIds'] as List?) ?? [])
          .cast<String>()
          .toSet();
  bool editing = false;
  List<Map<String, dynamic>> sourceTargets(String id) {
    for (final s in widget.catalog['sources']) {
      if (s['sourceId'] == id) {
        return (s['targets'] as List).cast<Map<String, dynamic>>();
      }
    }
    return [];
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final personal = source == 'personal_semantic_world';
    final targets = editing
        ? sourceTargets(source)
        : (widget.catalog['targets'] as List).cast<Map<String, dynamic>>();
    final valid = chosen.intersection(
      sourceTargets(
        'personal_semantic_world',
      ).map((t) => t['targetId'] as String).toSet(),
    );
    return Scaffold(
      appBar: AppBar(title: Text(l.uiPracticeScope)),
      body: Readable(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (!editing)
                    OutlinedButton(
                      onPressed: () => setState(() => editing = true),
                      child: Text(l.practiceChangeScope),
                    )
                  else
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      initialValue: source,
                      items: [
                        DropdownMenuItem(
                          value: 'current_study',
                          child: Text(l.uiCurrentLearningScope),
                        ),
                        DropdownMenuItem(
                          value: 'personal_semantic_world',
                          child: Text(l.uiMySemanticWorld),
                        ),
                      ],
                      onChanged: (v) => setState(() => source = v!),
                    ),
                  const SizedBox(height: 12),
                  Text(
                    personal
                        ? l.uiPracticeSavedMeaningsWithoutAddingThem
                        : l.uiCurrentLearningScope,
                  ),
                  if (personal && editing)
                    TextButton(
                      onPressed: () => setState(() {
                        final all = targets
                            .map((t) => t['targetId'] as String)
                            .toSet();
                        if (valid.length == all.length) {
                          chosen.clear();
                        } else {
                          chosen.addAll(all);
                        }
                      }),
                      child: Text(l.uiSelectAllClear),
                    ),
                ],
              ),
            ),
            Expanded(
              child: targets.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(l.practiceEmptyScope),
                      ),
                    )
                  : ListView.builder(
                      itemCount: targets.length,
                      itemBuilder: (_, i) {
                        final t = targets[i];
                        final subtitle = Text(
                          [t['sense'], t['context']]
                              .whereType<String>()
                              .where((s) => s.isNotEmpty)
                              .join('\n'),
                        );
                        return personal && editing
                            ? CheckboxListTile(
                                value: valid.contains(t['targetId']),
                                title: Text(t['expression']),
                                subtitle: subtitle,
                                onChanged: (v) => setState(() {
                                  if (v == true) {
                                    chosen.add(t['targetId']);
                                  } else {
                                    chosen.remove(t['targetId']);
                                  }
                                }),
                              )
                            : ListTile(
                                title: Text(t['expression']),
                                subtitle: subtitle,
                              );
                      },
                    ),
            ),
            if (editing)
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton(
                    onPressed: targets.isEmpty || (personal && valid.isEmpty)
                        ? null
                        : () => Navigator.pop(context, {
                            'sourceId': source,
                            if (personal) 'targetIds': valid.toList(),
                          }),
                    child: Text(l.uiUseThisScope),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
