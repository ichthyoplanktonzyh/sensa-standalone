import 'package:flutter/material.dart';
import '../l10n/interface_locale.dart';
import 'product_theme.dart';

class PracticeHome extends StatelessWidget {
  const PracticeHome({
    super.key,
    required this.data,
    required this.busy,
    required this.brief,
    required this.onScope,
    required this.onStart,
    required this.onAbandon,
  });
  final Map<String, dynamic> data;
  final bool busy;
  final TextEditingController brief;
  final VoidCallback onScope, onStart, onAbandon;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final catalog = data['catalog'];
    final targets = catalog['targets'] as List;
    final forms = targets
        .map((t) => t['expression'] as String)
        .toSet()
        .toList();
    final session = data['session'];
    final history = data['history'] as List;
    final text = Theme.of(context).textTheme;
    final titles = [
      l.practiceListening,
      l.practiceSpeaking,
      l.practiceReading,
      l.practiceWriting,
    ];
    final cues = [
      l.practiceListeningCue,
      l.practiceSpeakingCue,
      l.practiceReadingCue,
      l.practiceWritingCue,
    ];
    const icons = [
      Icons.headphones_outlined,
      Icons.mic_none,
      Icons.menu_book_outlined,
      Icons.edit_outlined,
    ];
    Widget activity(int i) => ProductPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(
            icons[i],
            color: i == 0
                ? Theme.of(context).colorScheme.primary
                : Colors.blueGrey,
            size: 28,
          ),
          const SizedBox(height: 24),
          Text(titles[i], style: text.titleLarge),
          const SizedBox(height: 8),
          Text(cues[i]),
          const SizedBox(height: 20),
          if (i == 0) ...[
            Text(l.uiYouglishRequiresAnInternetConnection),
            if (session == null) ...[
              if (targets.isEmpty) Text(l.practiceEmptyScope),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text(l.practiceBriefOptional),
                children: [
                  TextField(
                    key: const ValueKey('practice-brief'),
                    controller: brief,
                    maxLength: 500,
                    decoration: InputDecoration(
                      labelText: l.uiWhatWouldYouLikeToPractice,
                    ),
                  ),
                ],
              ),
              FilledButton.icon(
                key: const ValueKey('practice-start'),
                onPressed: busy || targets.isEmpty ? null : onStart,
                icon: const Icon(Icons.play_arrow),
                label: Text(l.uiStartListening),
              ),
            ] else
              Text(l.practicePinnedScope),
          ] else
            Text(l.practiceComingSoon, style: text.labelLarge),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        Material(
          color: const Color(0xffedf0f7),
          borderRadius: BorderRadius.circular(24),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            key: const ValueKey('practice-scope'),
            onTap: busy ? null : onScope,
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${l.uiPracticeScope} · ${catalog['selection']['sourceId'] == 'personal_semantic_world' ? l.uiMySemanticWorld : l.uiCurrentLearningScope}',
                  ),
                  const SizedBox(height: 12),
                  Text(
                    forms.isEmpty
                        ? l.practiceEmptyScope
                        : '${forms.take(4).join(' · ')}${forms.length > 4 ? ' …' : ''}',
                    style: text.titleLarge,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 16,
                    runSpacing: 8,
                    children: [
                      Text(
                        l.uiTargetsExpressions(
                          '${targets.length}',
                          '${forms.length}',
                        ),
                      ),
                      Text(l.uiChoosePracticeScope),
                      const Icon(Icons.arrow_forward, size: 20),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        if ((catalog['blockedTargets'] as List? ?? []).isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(l.uiSomeExpressionsWithAmbiguousPronunciationWere),
          ),
        if (session != null) ...[
          const SizedBox(height: 24),
          ProductPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l.practiceResumeTitle, style: text.titleLarge),
                const SizedBox(height: 12),
                Text(session['snapshot']['brief']),
                Text(
                  (session['snapshot']['expressions'] as List)
                      .map((t) => t['expression'])
                      .join(' · '),
                ),
                const SizedBox(height: 8),
                Text(l.practicePinnedScope),
                const SizedBox(height: 16),
                FilledButton.icon(
                  key: const ValueKey('practice-resume'),
                  onPressed: busy ? null : onStart,
                  icon: const Icon(Icons.play_arrow),
                  label: Text(l.uiContinueListening),
                ),
                TextButton(
                  onPressed: busy ? null : onAbandon,
                  child: Text(l.uiAbandonThisPractice),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 24),
        LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth >= 640
                ? (constraints.maxWidth - 16) / 2
                : constraints.maxWidth;
            return Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                for (var i = 0; i < 4; i++)
                  SizedBox(width: width, child: activity(i)),
              ],
            );
          },
        ),
        const SizedBox(height: 32),
        Text(l.uiPracticeHistory, style: text.titleLarge),
        if (history.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(l.practiceEmptyHistory),
          ),
        for (final h in history.take(3)) _HistoryEntry(entry: h),
        if (history.length > 3)
          TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => Scaffold(
                  appBar: AppBar(title: Text(l.uiPracticeHistory)),
                  body: Readable(
                    child: ListView.builder(
                      itemCount: history.length,
                      itemBuilder: (_, i) => _HistoryEntry(entry: history[i]),
                    ),
                  ),
                ),
              ),
            ),
            child: Text(l.practiceMoreHistory),
          ),
      ],
    );
  }
}

class _HistoryEntry extends StatelessWidget {
  const _HistoryEntry({required this.entry});
  final dynamic entry;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(entry['snapshot']['brief']),
      subtitle: Text(
        l.uiInteractions(
          entry['status'] == 'active'
              ? l.uiInProgress
              : entry['status'] == 'completed'
              ? l.uiEnded
              : l.uiAbandoned,
          '${entry['turnCount']}',
        ),
      ),
    );
  }
}

class PracticeCaption extends StatelessWidget {
  const PracticeCaption({super.key, required this.caption});
  final String caption;
  @override
  Widget build(BuildContext context) {
    final spans = <TextSpan>[];
    final marked = RegExp(r'\[\[\[(.*?)\]\]\]', dotAll: true);
    var offset = 0;
    for (final match in marked.allMatches(caption)) {
      spans.add(TextSpan(text: caption.substring(offset, match.start)));
      spans.add(
        TextSpan(
          text: match.group(1),
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: Theme.of(context).colorScheme.primary,
            backgroundColor: const Color(0xffe9edf8),
          ),
        ),
      );
      offset = match.end;
    }
    spans.add(TextSpan(text: caption.substring(offset)));
    return Semantics(
      liveRegion: true,
      child: Text.rich(
        TextSpan(children: spans),
        style: Theme.of(context).textTheme.titleLarge?.copyWith(height: 1.6),
      ),
    );
  }
}
