import '../l10n/interface_locale.dart';
import 'product_theme.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  String period = 'all', kind = 'all', search = '';
  final searchController = TextEditingController();
  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  void submitSearch() {
    search = searchController.text;
    FocusManager.instance.primaryFocus?.unfocus();
    load();
  }

  DateTime? start, end;
  Map<String, dynamic>? data;
  List<Map<String, dynamic>> records = [];
  bool loading = false;
  String? error;
  int request = 0;
  String day(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  String label(String k) => switch (k) {
    'initial_learning' => context.l10n.uiInitialLearning,
    'retention_review' => context.l10n.uiRetentionReview,
    'relearning' => context.l10n.uiRelearning,
    _ => context.l10n.uiAllTypes,
  };
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load({bool more = false}) async {
    final generation = ++request;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final now = DateTime.now();
      final from = switch (period) {
        'today' => now,
        'week' => now.subtract(const Duration(days: 6)),
        'month' => now.subtract(const Duration(days: 29)),
        'custom' => start,
        _ => null,
      };
      final until = period == 'custom' ? end : now;
      final result = await widget.model.repository.history({
        'start': from == null ? null : day(from),
        'end': until == null ? null : day(until),
        'kind': kind == 'all' ? null : kind,
        'search': search,
        'cursor': more ? (data?['nextCursor']) : null,
        'offsetMinutes': now.timeZoneOffset.inMinutes,
      });
      if (mounted && generation == request) {
        setState(() {
          data = result;
          records = [
            if (more) ...records,
            ...(result['records'] as List).cast<Map<String, dynamic>>(),
          ];
        });
      }
    } catch (e) {
      if (mounted && generation == request) {
        setState(
          () => error = e.toString().contains('history_changed')
              ? context.l10n.uiHistoryChangedRefreshToContinue
              : e.toString().contains('invalid_history_range')
              ? context.l10n.uiCheckTheStartAndEndDates
              : context.l10n.uiCouldNotReadLearningHistoryRetry,
        );
      }
    } finally {
      if (mounted && generation == request) setState(() => loading = false);
    }
  }

  Future<void> dates() async {
    final now = DateTime.now();
    final result = await showDateRangePicker(
      context: context,
      firstDate: DateTime(1970),
      lastDate: now,
      initialDateRange: DateTimeRange(
        start: start ?? now.subtract(const Duration(days: 6)),
        end: end ?? now,
      ),
    );
    if (result != null) {
      setState(() {
        start = result.start;
        end = result.end;
        period = 'custom';
      });
      await load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final counts = (data?['counts'] as Map<String, dynamic>?) ?? {};
    final days = (data?['days'] as List?) ?? [];
    final checkins = (data?['checkins'] as List?) ?? [];
    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.uiLearningHistory)),
      body: Readable(
        child: ListView(
          key: const ValueKey('history-scroll'),
          padding: const EdgeInsets.all(20),
          children: [
            Text(context.l10n.uiYourCompletedLearningAndReviews),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final p in [
                  ('today', context.l10n.uiToday212),
                  ('week', context.l10n.uiLastDays),
                  ('month', context.l10n.uiLastDays214),
                  ('all', context.l10n.uiAll),
                ])
                  ChoiceChip(
                    label: Text(p.$2),
                    selected: period == p.$1,
                    onSelected: loading
                        ? null
                        : (_) {
                            setState(() => period = p.$1);
                            load();
                          },
                  ),
                ActionChip(
                  label: Text(
                    period == 'custom'
                        ? '${day(start!)} — ${day(end!)}'
                        : context.l10n.uiCustomDates,
                  ),
                  onPressed: loading ? null : dates,
                ),
              ],
            ),
            DropdownButtonFormField<String>(
              isExpanded: true,
              key: const ValueKey('history-kind'),
              initialValue: kind,
              items:
                  ['all', 'initial_learning', 'retention_review', 'relearning']
                      .map(
                        (k) =>
                            DropdownMenuItem(value: k, child: Text(label(k))),
                      )
                      .toList(),
              onChanged: loading
                  ? null
                  : (v) {
                      setState(() => kind = v!);
                      load();
                    },
            ),
            TextField(
              key: const ValueKey('history-search'),
              controller: searchController,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                labelText: context.l10n.uiSearchExpressionsOrMeanings217,
                hintText: context.l10n.uiEnterAQuery,
                suffixIcon: IconButton(
                  tooltip: context.l10n.uiSearchHistory,
                  onPressed: loading ? null : submitSearch,
                  icon: const Icon(Icons.search),
                ),
              ),
              onSubmitted: (_) => submitSearch(),
            ),
            if (error != null)
              Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            TextButton(
              onPressed: loading ? null : () => load(),
              child: Text(context.l10n.uiRefreshHistory),
            ),
            if (loading) const LinearProgressIndicator(),
            Text(
              context.l10n.uiInitialReviewsRelearning(
                (counts['initial_learning'] ?? 0).toString(),
                (counts['retention_review'] ?? 0).toString(),
                (counts['relearning'] ?? 0).toString(),
              ),
            ),
            ExpansionTile(
              key: const PageStorageKey('history_screen-detail-1'),
              title: Text(context.l10n.uiDailySummary),
              children: [
                for (final d in days)
                  ListTile(
                    title: Text('${d['date']} · ${label(d['kind'])}'),
                    trailing: Text(context.l10n.uiRecords(d['count'] as int)),
                  ),
              ],
            ),
            ExpansionTile(
              key: const PageStorageKey('history_screen-detail-2'),
              title: Text(
                context.l10n.uiCheckInCalendarDays(
                  (checkins.length).toString(),
                ),
              ),
              children: [
                for (final d in checkins)
                  ListTile(
                    title: Text(d['date'] as String),
                    trailing: Text(
                      d['source'] == 'manual'
                          ? context.l10n.uiManualCheckIn
                          : context.l10n.uiLearning,
                    ),
                  ),
              ],
            ),
            if (records.isEmpty && !loading)
              Padding(
                padding: EdgeInsets.all(20),
                child: Text(context.l10n.uiNoRecordsInThisRangeTry),
              ),
            for (final r in records)
              ListTile(
                key: ValueKey('history-${r['id']}'),
                title: Text('${r['expression']} · ${label(r['kind'])}'),
                subtitle: Text(
                  '${r['meaning']}\n${DateTime.fromMillisecondsSinceEpoch(r['occurredAtMs'] as int).toLocal()}',
                ),
              ),
            if (data?['nextCursor'] != null)
              TextButton(
                onPressed: loading ? null : () => load(more: true),
                child: Text(context.l10n.uiShowMoreRecords),
              ),
          ],
        ),
      ),
    );
  }
}
