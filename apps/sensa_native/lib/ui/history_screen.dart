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
    'initial_learning' => '首次学习',
    'retention_review' => '保持复习',
    'relearning' => '再学习',
    _ => '全部类型',
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
              ? '记录已有更新，请刷新后继续。'
              : e.toString().contains('invalid_history_range')
              ? '日期范围无效，请检查起止日期。'
              : '学习记录暂时无法读取，请重试。',
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
      appBar: AppBar(title: const Text('学习记录')),
      body: Readable(
        child: ListView(
          key: const ValueKey('history-scroll'),
          padding: const EdgeInsets.all(20),
          children: [
            const Text('记录来自本机实际完成的首学、复习与再学习。完成首学不等于已经掌握。'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final p in [
                  ('today', '今天'),
                  ('week', '最近7天'),
                  ('month', '最近30天'),
                  ('all', '全部'),
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
                        : '自选日期',
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
                labelText: '搜索表达或意思',
                hintText: '输入后查询',
                suffixIcon: IconButton(
                  tooltip: '搜索记录',
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
              child: const Text('刷新记录'),
            ),
            if (loading) const LinearProgressIndicator(),
            Text(
              '首次学习 ${counts['initial_learning'] ?? 0} · 保持复习 ${counts['retention_review'] ?? 0} · 再学习 ${counts['relearning'] ?? 0}',
            ),
            ExpansionTile(
              key: const PageStorageKey('history_screen-detail-1'),
              title: const Text('每日汇总'),
              children: [
                for (final d in days)
                  ListTile(
                    title: Text('${d['date']} · ${label(d['kind'])}'),
                    trailing: Text('${d['count']} 条'),
                  ),
              ],
            ),
            ExpansionTile(
              key: const PageStorageKey('history_screen-detail-2'),
              title: Text('签到日历 · ${checkins.length} 天'),
              children: [
                for (final d in checkins)
                  ListTile(
                    title: Text(d['date'] as String),
                    trailing: Text(d['source'] == 'manual' ? '手动签到' : '正式学习'),
                  ),
              ],
            ),
            if (records.isEmpty && !loading)
              const Padding(
                padding: EdgeInsets.all(20),
                child: Text('此范围内没有学习记录。可以调整日期或类型。'),
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
                child: const Text('显示更多记录'),
              ),
            const Text('不展示缺少可靠依据的时长、正确率或掌握率。'),
          ],
        ),
      ),
    );
  }
}
