import 'package:intl/intl.dart';
import '../l10n/interface_locale.dart';
import 'history_screen.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

/// Activity presentation consumes committed sets; it does not total attempts as targets.
class LearningActivityView extends StatelessWidget {
  const LearningActivityView({
    super.key,
    required this.model,
    this.overview = false,
    this.onStart,
    this.onHome,
  });
  final LibraryViewModel model;
  final bool overview;
  final Future<void> Function(String)? onStart;
  final VoidCallback? onHome;
  @override
  Widget build(BuildContext context) {
    final s = model.snapshot!;
    final board = s.learning;
    final a = s.activity;
    final enabled = !model.busy && model.error == null;
    final counts = board['counts'] as Map<String, dynamic>? ?? {};
    final date = board['date'] as String? ?? '';
    final checkins = (board['checkins'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    final checked = checkins.any((c) => c['date'] == date);
    final children = <Widget>[];
    Widget heading(String value) =>
        Text(value, style: Theme.of(context).textTheme.headlineSmall);
    Widget button(String label, VoidCallback action) =>
        FilledButton(onPressed: enabled ? action : null, child: Text(label));
    if (overview) {
      children.addAll([
        heading(context.l10n.uiToday),
        Text(date),
        Text(
          context.l10n.uiIntroducedToday(
            (board['newStartedToday'] ?? 0).toString(),
            (s.quantity).toString(),
          ),
        ),
        Text(
          context.l10n.uiContinueReviewsRelearn(
            (counts['initialContinuations'] ?? 0).toString(),
            (counts['dueReviews'] ?? 0).toString(),
            (counts['relearningReady'] ?? 0).toString(),
          ),
        ),
        button(
          context.l10n.uiStartToday,
          () => (onStart ?? model.startActivity)('mixed'),
        ),
        OutlinedButton(
          onPressed: enabled
              ? () => (onStart ?? model.startActivity)('review_only')
              : null,
          child: Text(context.l10n.uiReviewOnly),
        ),
        if (a != null && a['status'] == 'paused')
          Text(
            context.l10n.uiYourIsPausedResumeTheSame(
              (a['mode'] == 'mixed'
                      ? context.l10n.uiMixedLearning
                      : context.l10n.uiReview)
                  .toString(),
            ),
          ),
        button(
          checked
              ? context.l10n.uiCheckedInToday
              : context.l10n.uiManualCheckIn,
          () => model.checkIn(),
        ),
        if (onStart == null)
          TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => HistoryScreen(model: model)),
            ),
            child: Text(context.l10n.uiAllLearningHistory),
          ),
        TextButton(
          onPressed: () => showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            builder: (context) => _Records(board: board),
          ),
          child: Text(context.l10n.uiHistoryAndCheckInCalendar),
        ),
      ]);
    } else if (a != null) {
      final summary = a['summary'] as Map<String, dynamic>;
      final ended = a['status'] == 'ended';
      int count(String field) => (summary[field] as List? ?? []).length;
      children.addAll([
        heading(
          ended
              ? context.l10n.uiLearningEnded
              : a['status'] == 'paused'
              ? context.l10n.uiLearningPaused278
              : context.l10n.uiProgressSaved,
        ),
        Text(
          a['mode'] == 'review_only'
              ? context.l10n.uiReviewOnly280
              : context.l10n.uiNewLearningAndReviews,
        ),
        Text(
          context.l10n.uiLearningTargets(
            (summary['distinctTargetCount']).toString(),
          ),
        ),
        Text(
          context.l10n.uiInitialReviewsRelearningCompleted(
            (count('initialTargetIds')).toString(),
            (count('reviewTargetIds')).toString(),
            (count('restoredTargetIds')).toString(),
          ),
        ),
        Text(context.l10n.uiTargetsMayAppearInMoreThan),
        if (!ended && a['immediateAvailable'] != true)
          Text(
            a['emptyReason'] == 'daily_limit'
                ? context.l10n.uiDailyNewLimitReachedContinueTomorrow
                : a['emptyReason'] == 'waiting'
                ? context.l10n.uiNothingIsReadyYetReturnWhen
                : context.l10n.uiNothingElseInThisScopeStart,
          ),
        if (count('needsRecallTargetIds') > 0)
          Text(
            context.l10n.uiToRecallIncludingWaiting(
              (count('needsRecallTargetIds')).toString(),
              (count('waitingTargetIds')).toString(),
            ),
          ),
        if (!ended &&
            a['status'] == 'active' &&
            a['immediateAvailable'] == true)
          button(context.l10n.uiContinuePlanning, () => model.nextActivity()),
        if (!ended && a['status'] == 'active' && count('waitingTargetIds') > 0)
          OutlinedButton(
            onPressed: enabled ? () => model.nextActivity(early: true) : null,
            child: Text(context.l10n.uiRecallEarly),
          ),
        if (!ended && a['status'] == 'paused')
          button(
            context.l10n.uiResumeLearning,
            () => model.startActivity(a['mode'] as String),
          ),
        if (!ended && a['status'] == 'active')
          OutlinedButton(
            onPressed: enabled ? () => model.stopActivity(end: true) : null,
            child: Text(context.l10n.uiEndLearning),
          ),
        if (!ended &&
            a['status'] == 'active' &&
            a['executionId'] == s.assurance?['id'])
          for (final target
              in (s.assurance?['queue']?['states'] as List? ?? []))
            if (target['declaredMastery'] == true)
              OutlinedButton(
                onPressed: enabled
                    ? () => model.assuranceIntent({
                        'kind': 'return_target',
                        'target_id': target['retentionTargetId'],
                      })
                    : null,
                child: Text(
                  context.l10n.uiRelearn((target['packageId']).toString()),
                ),
              ),
        TextButton(
          onPressed: onHome ?? model.showHome,
          child: Text(context.l10n.uiBackToHome),
        ),
      ]);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children
          .expand((w) => [w, const SizedBox(height: 14)])
          .toList(),
    );
  }
}

class _Records extends StatefulWidget {
  const _Records({required this.board});
  final Map<String, dynamic> board;
  @override
  State<_Records> createState() => _RecordsState();
}

class _RecordsState extends State<_Records> {
  late DateTime month;
  @override
  void initState() {
    super.initState();
    final today = DateTime.parse(widget.board['date'] as String);
    month = DateTime(today.year, today.month);
  }

  @override
  Widget build(BuildContext context) {
    final checked = (widget.board['checkins'] as List? ?? [])
        .map((c) => c['date'])
        .toSet();
    final history = (widget.board['history'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    final days = DateTime(month.year, month.month + 1, 0).day;
    String date(int day) =>
        '${month.year}-${month.month.toString().padLeft(2, '0')}-${day.toString().padLeft(2, '0')}';
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .85,
        child: ListView(
          key: const ValueKey('learning-records-scroll'),
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              context.l10n.uiLearningHistory,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                  onPressed: () => setState(
                    () => month = DateTime(month.year, month.month - 1),
                  ),
                  icon: const Icon(Icons.chevron_left),
                ),
                Text(
                  DateFormat.yMMMM(
                    Localizations.localeOf(context).toLanguageTag(),
                  ).format(month),
                ),
                IconButton(
                  onPressed: () => setState(
                    () => month = DateTime(month.year, month.month + 1),
                  ),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
            Text(context.l10n.uiCalendarMarksShowCheckIns),
            GridView.count(
              crossAxisCount: 7,
              mainAxisExtent: 44,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                for (final d in [
                  context.l10n.uiM,
                  context.l10n.uiT,
                  context.l10n.uiW,
                  context.l10n.uiT298,
                  context.l10n.uiF,
                  context.l10n.uiS,
                  context.l10n.uiS301,
                ])
                  Center(child: Text(d)),
                for (var i = 1; i < month.weekday; i++) const SizedBox.shrink(),
                for (var d = 1; d <= days; d++)
                  Semantics(
                    label:
                        '${date(d)} ${checked.contains(date(d)) ? context.l10n.uiCheckedIn : context.l10n.uiNotCheckedIn}',
                    child: Container(
                      margin: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color: checked.contains(date(d))
                            ? const Color(0xffd5eee5)
                            : null,
                        shape: BoxShape.circle,
                      ),
                      child: Center(child: Text('$d')),
                    ),
                  ),
              ],
            ),
            if (history.isEmpty) Text(context.l10n.uiNoLearningHistoryYet),
            for (final h in history)
              ListTile(
                title: Text(
                  context.l10n.uiTargets305(
                    (h['mode'] == 'mixed'
                            ? context.l10n.uiMixedLearning
                            : context.l10n.uiReviewOnly)
                        .toString(),
                    (h['summary']['distinctTargetCount']).toString(),
                  ),
                ),
                subtitle: Text(
                  '${DateTime.fromMillisecondsSinceEpoch(h['startedAtMs'] as int).toLocal()} · ${h['status'] == 'ended'
                      ? context.l10n.uiEnded
                      : h['status'] == 'paused'
                      ? context.l10n.uiPaused
                      : context.l10n.uiInProgress307}',
                ),
              ),
          ],
        ),
      ),
    );
  }
}
