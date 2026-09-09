import 'history_screen.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

/// Activity presentation consumes committed sets; it does not total attempts as targets.
class LearningActivityView extends StatelessWidget {
  const LearningActivityView({
    super.key,
    required this.model,
    this.overview = false,
  });
  final LibraryViewModel model;
  final bool overview;
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
        heading('今天的学习'),
        Text(date),
        Text('今日已引入 ${board['newStartedToday'] ?? 0} / ${s.quantity}'),
        Text(
          '待继续 ${counts['initialContinuations'] ?? 0} · 到期复习 ${counts['dueReviews'] ?? 0} · 可再学 ${counts['relearningReady'] ?? 0}',
        ),
        button('开始今天的学习', () => model.startActivity('mixed')),
        OutlinedButton(
          onPressed: enabled ? () => model.startActivity('review_only') : null,
          child: const Text('只复习'),
        ),
        if (a != null && a['status'] == 'paused')
          Text('有一段${a['mode'] == 'mixed' ? '混合学习' : '复习'}已暂停，开始相同模式会恢复原进度。'),
        button(checked ? '今天已签到' : '手动签到', () => model.checkIn()),
        TextButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => HistoryScreen(model: model)),
          ),
          child: const Text('全部学习记录'),
        ),
        TextButton(
          onPressed: () => showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            builder: (context) => _Records(board: board),
          ),
          child: const Text('学习记录与签到日历'),
        ),
      ]);
    } else if (a != null) {
      final summary = a['summary'] as Map<String, dynamic>;
      final ended = a['status'] == 'ended';
      int count(String field) => (summary[field] as List? ?? []).length;
      children.addAll([
        heading(
          ended
              ? '本次学习已结束'
              : a['status'] == 'paused'
              ? '本次学习已暂停'
              : '本段学习已保存',
        ),
        Text(a['mode'] == 'review_only' ? '只复习 · 不增加新学任务' : '今天的学习 · 新学与复习'),
        Text('本次涉及 ${summary['distinctTargetCount']} 个不同的学习目标'),
        Text(
          '完成首学 ${count('initialTargetIds')} · 完成复习 ${count('reviewTargetIds')} · 再学完成 ${count('restoredTargetIds')}',
        ),
        const Text('同一个目标可能出现在多个分类中，总数已经去重。'),
        if (!ended && a['immediateAvailable'] != true)
          Text(
            a['emptyReason'] == 'daily_limit'
                ? '今天的新学名额已用完，可明天继续。'
                : a['emptyReason'] == 'waiting'
                ? '目前没有可立即继续的任务，再回想时间尚未到。'
                : '本次范围内暂时没有可继续的任务。新加入的内容会在新活动中安排。',
          ),
        if (count('needsRecallTargetIds') > 0)
          Text(
            '仍需回想 ${count('needsRecallTargetIds')} 个，其中等待 ${count('waitingTargetIds')} 个。',
          ),
        if (!ended &&
            a['status'] == 'active' &&
            a['immediateAvailable'] == true)
          button('继续安排', () => model.nextActivity()),
        if (!ended && a['status'] == 'active' && count('waitingTargetIds') > 0)
          OutlinedButton(
            onPressed: enabled ? () => model.nextActivity(early: true) : null,
            child: const Text('提前再回想'),
          ),
        if (!ended && a['status'] == 'paused')
          button('恢复本次学习', () => model.startActivity(a['mode'] as String)),
        if (!ended && a['status'] == 'active')
          OutlinedButton(
            onPressed: enabled ? () => model.stopActivity(end: true) : null,
            child: const Text('结束本次学习'),
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
                child: Text('重新学习：${target['packageId']}'),
              ),
        TextButton(onPressed: model.showHome, child: const Text('回到首页')),
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
            Text('学习记录', style: Theme.of(context).textTheme.headlineSmall),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                  onPressed: () => setState(
                    () => month = DateTime(month.year, month.month - 1),
                  ),
                  icon: const Icon(Icons.chevron_left),
                ),
                Text('${month.year} 年 ${month.month} 月'),
                IconButton(
                  onPressed: () => setState(
                    () => month = DateTime(month.year, month.month + 1),
                  ),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
            const Text('日历标记只表示签到，不表示完成学习或掌握。'),
            GridView.count(
              crossAxisCount: 7,
              mainAxisExtent: 44,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                for (final d in ['一', '二', '三', '四', '五', '六', '日'])
                  Center(child: Text(d)),
                for (var i = 1; i < month.weekday; i++) const SizedBox.shrink(),
                for (var d = 1; d <= days; d++)
                  Semantics(
                    label:
                        '${date(d)} ${checked.contains(date(d)) ? '已签到' : '未签到'}',
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
            if (history.isEmpty) const Text('还没有正式学习记录。'),
            for (final h in history)
              ListTile(
                title: Text(
                  '${h['mode'] == 'mixed' ? '混合学习' : '只复习'} · ${h['summary']['distinctTargetCount']} 个目标',
                ),
                subtitle: Text(
                  '${DateTime.fromMillisecondsSinceEpoch(h['startedAtMs'] as int).toLocal()} · ${h['status'] == 'ended'
                      ? '已结束'
                      : h['status'] == 'paused'
                      ? '已暂停'
                      : '进行中'}',
                ),
              ),
          ],
        ),
      ),
    );
  }
}
