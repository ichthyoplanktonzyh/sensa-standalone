import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../l10n/interface_locale.dart';
import 'library_view_model.dart';
import 'product_theme.dart';

/// Presents the core's current availability; never plans a queue or a due date.
class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.model,
    required this.opening,
    required this.onStudy,
    required this.onManage,
    required this.onPrepare,
    required this.onBrowse,
    required this.onCapture,
  });
  final LibraryViewModel model;
  final bool opening;
  final Future<void> Function(String) onStudy;
  final VoidCallback onManage, onPrepare, onBrowse, onCapture;

  @override
  Widget build(BuildContext context) {
    final s = model.snapshot!;
    final board = s.learning;
    final counts = board['counts'] as Map? ?? {};
    int count(String key) => counts[key] as int? ?? 0;
    final fresh = count('newAvailable');
    final due = count('dueReviews');
    final hasWork = count('distinctExecutableTargets') > 0;
    final activity = s.activity;
    final ongoing = activity != null && activity['status'] != 'ended';
    final canResume =
        ongoing &&
        (activity['canAnswer'] == true ||
            activity['immediateAvailable'] == true);
    final waiting =
        count('relearningWaiting') > 0 ||
        ongoing && activity['emptyReason'] == 'waiting';
    final limit =
        (board['newStartedToday'] as int? ?? 0) +
            (board['newReservedToday'] as int? ?? 0) >=
        s.quantity!;
    final preparing = model.preparations.any(
      (task) => !['ready', 'cancelled'].contains(task['status']),
    );
    final enrolled =
        s.catalog.any((entry) => entry['enrolled'] == true) ||
        model.preparations.isNotEmpty;
    final enabled = !model.busy && !opening && model.error == null;
    late String hint, actionLabel;
    late VoidCallback action;
    if (canResume) {
      hint = context.l10n.homeContinueHint;
      actionLabel = context.l10n.uiContinueToday;
      action = () => onStudy(activity['mode'] as String);
    } else if (hasWork) {
      hint = count('initialContinuations') > 0 || count('relearningReady') > 0
          ? context.l10n.homeContinueHint
          : due > 0
          ? fresh > 0
                ? context.l10n.homeMixedHint
                : context.l10n.homeReviewHint
          : context.l10n.homeNewHint;
      actionLabel = context.l10n.uiStartToday;
      action = () => onStudy('mixed');
    } else if (waiting || ongoing) {
      hint = waiting
          ? context.l10n.homeWaitingHint
          : activity?['emptyReason'] == 'daily_limit'
          ? context.l10n.homeLimitHint
          : context.l10n.homeQuietHint;
      actionLabel = context.l10n.homeProgress;
      // Reopen the existing activity's honest waiting/summary surface.
      action = ongoing ? () => onStudy(activity['mode'] as String) : onManage;
    } else if (preparing) {
      hint = context.l10n.homePreparingHint;
      actionLabel = context.l10n.uiViewPreparation;
      action = onPrepare;
    } else if (limit || enrolled) {
      hint = limit ? context.l10n.homeLimitHint : context.l10n.homeQuietHint;
      actionLabel = context.l10n.homeManage;
      action = onManage;
    } else {
      hint = context.l10n.uiAddLearningContentOrCaptureA;
      actionLabel = context.l10n.uiAddLearningContent;
      action = onBrowse;
    }
    final text = Theme.of(context).textTheme;
    final date = DateTime.parse(board['date'] as String);
    final dateLabel = DateFormat.MMMMEEEEd(
      Localizations.localeOf(context).toLanguageTag(),
    ).format(date);
    return LayoutBuilder(
      builder: (context, constraints) {
        // Account for larger text when deciding whether controls fit side by side.
        final spacious =
            constraints.maxWidth >= 720 &&
            MediaQuery.textScalerOf(context).scale(16) <= 24;
        final title = Text(
          context.l10n.uiConnectWithNewMeanings,
          style: text.headlineLarge?.copyWith(fontSize: spacious ? 40 : 30),
        );
        final dateText = Text(dateLabel, style: text.bodyMedium);
        final start = FilledButton(
          key: const ValueKey('home-start'),
          onPressed: enabled ? action : null,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(child: Text(actionLabel)),
              const SizedBox(width: 20),
              const Icon(Icons.arrow_forward, size: 20),
            ],
          ),
        );
        final review = TextButton.icon(
          key: const ValueKey('home-review'),
          onPressed: enabled && due > 0 ? () => onStudy('review_only') : null,
          icon: const Icon(Icons.replay, size: 20),
          label: Text(
            due > 0 ? context.l10n.uiReviewOnly : context.l10n.uiNoReviewsDue,
          ),
        );
        final sources = [
          _Entry(
            key: const ValueKey('home-browse'),
            title: context.l10n.uiBrowseLearningContent,
            hint: context.l10n.uiImportALearningPackageAndChoose,
            icon: Icons.library_books_outlined,
            onTap: model.busy ? null : onBrowse,
          ),
          _Entry(
            key: const ValueKey('home-capture'),
            title: context.l10n.uiCaptureAContext,
            hint: context.l10n.homeCaptureHint,
            icon: Icons.edit_note_outlined,
            onTap: model.busy ? null : onCapture,
          ),
        ];
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1120),
            child: ListView(
              // A fresh home visit starts at the primary action; an overlaid
              // capture route keeps this mounted scroll position on cancel.
              key: const ValueKey('home-scroll'),
              padding: EdgeInsets.all(spacious ? 32 : 16),
              children: [
                if (spacious)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(child: title),
                      const SizedBox(width: 24),
                      dateText,
                    ],
                  )
                else ...[
                  title,
                  const SizedBox(height: 8),
                  dateText,
                ],
                const SizedBox(height: 24),
                ProductPanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              context.l10n.uiToday,
                              style: text.titleMedium,
                            ),
                          ),
                          IconButton(
                            key: const ValueKey('home-manage'),
                            tooltip: context.l10n.homeManage,
                            onPressed: model.busy ? null : onManage,
                            icon: const Icon(Icons.tune),
                          ),
                        ],
                      ),
                      const Divider(height: 24),
                      IntrinsicHeight(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Expanded(
                              child: _Metric(
                                label: context.l10n.uiNew,
                                value: fresh,
                                spacious: spacious,
                              ),
                            ),
                            const VerticalDivider(width: 32),
                            Expanded(
                              child: _Metric(
                                label: context.l10n.uiDueReviews,
                                value: due,
                                spacious: spacious,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      if (spacious) ...[
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            hint,
                            key: const ValueKey('home-hint'),
                            style: text.bodyLarge,
                          ),
                        ),
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            Flexible(child: start),
                            const SizedBox(width: 16),
                            Flexible(child: review),
                          ],
                        ),
                      ] else ...[
                        start,
                        const SizedBox(height: 12),
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            hint,
                            key: const ValueKey('home-hint'),
                            style: text.bodyMedium,
                          ),
                        ),
                        const SizedBox(height: 4),
                        review,
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 28),
                Text(context.l10n.homeAddHeading, style: text.titleMedium),
                const SizedBox(height: 12),
                if (spacious)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: sources[0]),
                      const SizedBox(width: 16),
                      Expanded(child: sources[1]),
                    ],
                  )
                else ...[
                  sources[0],
                  const SizedBox(height: 12),
                  sources[1],
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    required this.spacious,
  });
  final String label;
  final int value;
  final bool spacious;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label),
      const SizedBox(height: 8),
      FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Text(
          NumberFormat.decimalPattern(
            Localizations.localeOf(context).toLanguageTag(),
          ).format(value),
          style: Theme.of(context).textTheme.headlineLarge?.copyWith(
            fontSize: spacious ? 72 : 56,
            fontWeight: FontWeight.w400,
          ),
        ),
      ),
    ],
  );
}

class _Entry extends StatelessWidget {
  const _Entry({
    super.key,
    required this.title,
    required this.hint,
    required this.icon,
    required this.onTap,
  });
  final String title, hint;
  final IconData icon;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16),
      side: const BorderSide(color: Color(0xffe3e5ea)),
    ),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Icon(icon, color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 8),
                  Text(hint),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.arrow_outward, size: 18),
          ],
        ),
      ),
    ),
  );
}
