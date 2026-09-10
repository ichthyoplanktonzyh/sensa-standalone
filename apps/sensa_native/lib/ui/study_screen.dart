import 'package:flutter/material.dart';
import '../l10n/interface_locale.dart';
import 'learning_activity_view.dart';
import 'library_view_model.dart';
import 'product_theme.dart';

/// Manages the local learning projection without planning or settling learning.
class StudyScreen extends StatelessWidget {
  const StudyScreen({
    super.key,
    required this.model,
    required this.onStart,
    required this.onScope,
    required this.onPreparation,
    required this.onHistory,
    required this.onQuantity,
    required this.onPolicy,
  });
  final LibraryViewModel model;
  final Future<void> Function(String) onStart;
  final VoidCallback onScope, onPreparation, onHistory, onQuantity, onPolicy;
  @override
  Widget build(BuildContext context) {
    final s = model.snapshot!;
    final board = s.learning;
    final counts = board['counts'] as Map? ?? {};
    int count(String key) => counts[key] as int? ?? 0;
    final scope = s.value['curriculum']?['scope']?['members'] as List? ?? [];
    final active = s.activity != null && s.activity!['status'] != 'ended';
    final enabled = !model.busy && model.error == null;
    final work = count('distinctExecutableTargets') > 0;
    final pending = model.preparations
        .where((t) => !['ready', 'cancelled'].contains(t['status']))
        .toList();
    final checked = (board['checkins'] as List? ?? []).any(
      (c) => c['date'] == board['date'],
    );
    final text = Theme.of(context).textTheme;
    final scopePanel = ProductPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(context.l10n.uiCurrentLearningScope, style: text.titleMedium),
          const SizedBox(height: 12),
          Text(
            context.l10n.uiCurrentScopeItemsIncludingThoseBeing(
              '${scope.length}',
            ),
            style: text.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(context.l10n.studyScopeHint),
          const SizedBox(height: 16),
          Wrap(
            spacing: 24,
            runSpacing: 16,
            children: [
              _Count(label: context.l10n.uiNew, count: count('newAvailable')),
              _Count(
                label: context.l10n.uiDueReviews,
                count: count('dueReviews'),
              ),
              _Count(
                label: context.l10n.uiToContinue,
                count: count('initialContinuations'),
              ),
            ],
          ),
          if (count('relearningReady') > 0 ||
              count('relearningWaiting') > 0) ...[
            const SizedBox(height: 12),
            Text(
              context.l10n.uiToRecallIncludingWaiting(
                '${count('relearningReady') + count('relearningWaiting')}',
                '${count('relearningWaiting')}',
              ),
            ),
          ],
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                key: const ValueKey('study-scope'),
                onPressed: enabled ? onScope : null,
                icon: const Icon(Icons.playlist_add_check),
                label: Text(context.l10n.uiLearningSources),
              ),
              if (active || work)
                OutlinedButton(
                  key: const ValueKey('study-start'),
                  onPressed: enabled
                      ? () => onStart(
                          active ? s.activity!['mode'] as String : 'mixed',
                        )
                      : null,
                  child: Text(
                    active
                        ? context.l10n.uiContinueToday
                        : context.l10n.uiStartToday,
                  ),
                ),
              if (count('dueReviews') > 0)
                TextButton(
                  onPressed: enabled ? () => onStart('review_only') : null,
                  child: Text(context.l10n.uiReviewOnly),
                ),
            ],
          ),
        ],
      ),
    );
    final planPanel = ProductPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(context.l10n.studyPlan, style: text.titleMedium),
          const SizedBox(height: 12),
          ListTile(
            key: const ValueKey('study-quantity'),
            contentPadding: EdgeInsets.zero,
            title: Text(context.l10n.uiDailyNewQuantity),
            subtitle: Text(context.l10n.uiNewConnections(s.quantity!)),
            trailing: const Icon(Icons.chevron_right),
            onTap: enabled ? onQuantity : null,
          ),
          Text(
            context.l10n.uiIntroducedToday(
              '${board['newStartedToday'] ?? 0}',
              '${s.quantity}',
            ),
          ),
          const Divider(height: 24),
          ListTile(
            key: const ValueKey('study-policy'),
            contentPadding: EdgeInsets.zero,
            title: Text(context.l10n.uiDefaultLearningMode),
            subtitle: Text(s.defaultPolicyLabel),
            trailing: const Icon(Icons.chevron_right),
            onTap: enabled ? onPolicy : null,
          ),
        ],
      ),
    );
    return ProductPage(
      pageId: 'learning',
      title: context.l10n.uiMyLearning,
      children: [
        LayoutBuilder(
          builder: (context, constraints) => constraints.maxWidth >= 800
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 3, child: scopePanel),
                    const SizedBox(width: 16),
                    Expanded(flex: 2, child: planPanel),
                  ],
                )
              : Column(
                  children: [scopePanel, const SizedBox(height: 16), planPanel],
                ),
        ),
        ProductPanel(
          child: ListTile(
            key: const ValueKey('study-preparation'),
            contentPadding: EdgeInsets.zero,
            title: Text(
              context.l10n.uiLearningPreparation,
              style: text.titleMedium,
            ),
            subtitle: Text(
              pending.isEmpty
                  ? context.l10n.studyNoPreparation
                  : context.l10n.uiTargets(pending.length),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: enabled ? onPreparation : null,
          ),
        ),
        ProductPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.tonalIcon(
                    key: const ValueKey('study-check-in'),
                    onPressed: enabled && !checked
                        ? () => model.checkIn()
                        : null,
                    icon: Icon(
                      checked
                          ? Icons.check_circle_outline
                          : Icons.calendar_today_outlined,
                    ),
                    label: Text(
                      checked
                          ? context.l10n.uiCheckedInToday
                          : context.l10n.uiManualCheckIn,
                    ),
                  ),
                  TextButton(
                    key: const ValueKey('study-history'),
                    onPressed: enabled ? onHistory : null,
                    child: Text(context.l10n.uiAllLearningHistory),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              LearningRecords(board: board, embedded: true),
            ],
          ),
        ),
      ],
    );
  }
}

class _Count extends StatelessWidget {
  const _Count({required this.label, required this.count});
  final String label;
  final int count;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label),
      Text('$count', style: Theme.of(context).textTheme.headlineSmall),
    ],
  );
}
