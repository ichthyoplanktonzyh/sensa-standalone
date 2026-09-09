import 'package:flutter/material.dart';
import 'library_view_model.dart';

class CurriculumScreen extends StatefulWidget {
  const CurriculumScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<CurriculumScreen> createState() => _CurriculumScreenState();
}

class _CurriculumScreenState extends State<CurriculumScreen> {
  String search = '';
  Map<String, dynamic> get data =>
      widget.model.snapshot!.value['curriculum'] as Map<String, dynamic>;
  List<Map<String, dynamic>> rows(String key) =>
      (data[key] as List).cast<Map<String, dynamic>>();
  Future<void> action(Map<String, dynamic> value) =>
      widget.model.act({'kind': 'curriculum', 'action': value});
  String label(String mode) => switch (mode) {
    'active' => '当前新学',
    'maintenance' => '只继续已学内容',
    _ => '已暂停',
  };
  Future<void> selectSources() async {
    final chosen =
        (data['scope']['selection'] as List?)?.cast<String>().toSet() ??
        {'supplemental', ...rows('enrollments').map((e) => e['id'] as String)};
    final result = await showDialog<List<String>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          title: const Text('选择学习来源'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final source in [
                  {'id': 'supplemental', 'title': '补充学习'},
                  ...rows('enrollments').map(
                    (e) => {
                      'id': e['id'],
                      'title':
                          '${rows('books').firstWhere((b) => b['id'] == e['bookId'] && b['version'] == e['version'])['title']} · ${label(e['mode'])}',
                    },
                  ),
                ])
                  CheckboxListTile(
                    title: Text(source['title'] as String),
                    value: chosen.contains(source['id']),
                    onChanged: (v) => set(() {
                      v == true
                          ? chosen.add(source['id'] as String)
                          : chosen.remove(source['id']);
                    }),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, chosen.toList()),
              child: const Text('应用来源'),
            ),
          ],
        ),
      ),
    );
    if (result != null) {
      await action({'kind': 'select_sources', 'source_ids': result});
    }
  }

  String expression(String id) =>
      widget.model.snapshot!.catalog
          .map((m) => m['material'] as Map<String, dynamic>)
          .where((m) => m['id'] == id)
          .map((m) => '${m['expression']} · ${m['sense']}')
          .firstOrNull ??
      id;
  Future<Map<String, dynamic>?> range(
    Map<String, dynamic> book, {
    Map<String, dynamic>? initial,
  }) async {
    String mode = initial?['kind'] as String? ?? 'all';
    final start = TextEditingController(text: '${initial?['start'] ?? 1}'),
        end = TextEditingController(
          text: '${initial?['end'] ?? (book['members'] as List).length}',
        );
    final members = (book['members'] as List).cast<Map<String, dynamic>>(),
        selected =
            (initial?['material_ids'] as List?)?.cast<String>().toSet() ??
            <String>{};
    final sections = members
        .map((m) => m['section'])
        .whereType<String>()
        .toSet()
        .toList();
    String? section = initial?['section'] as String? ?? sections.firstOrNull;
    String? error;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          title: const Text('调整未来新学范围'),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('只改变之后的新学范围，已开始的内容仍按词书状态继续。'),
                  DropdownButtonFormField<String>(
                    initialValue: mode,
                    items: const [
                      DropdownMenuItem(value: 'all', child: Text('整本')),
                      DropdownMenuItem(value: 'ordinals', child: Text('按序号')),
                      DropdownMenuItem(value: 'section', child: Text('按章节')),
                      DropdownMenuItem(value: 'selection', child: Text('指定意思')),
                    ],
                    onChanged: (v) => set(() {
                      mode = v!;
                      error = null;
                    }),
                  ),
                  if (mode == 'ordinals') ...[
                    TextField(
                      key: const ValueKey('range-start'),
                      controller: start,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: '起始序号'),
                    ),
                    TextField(
                      key: const ValueKey('range-end'),
                      controller: end,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: '结束序号'),
                    ),
                  ],
                  if (mode == 'section')
                    sections.isEmpty
                        ? const Text('此版本没有章节标记。')
                        : DropdownButton<String>(
                            value: section,
                            items: sections
                                .map(
                                  (s) => DropdownMenuItem(
                                    value: s,
                                    child: Text(s),
                                  ),
                                )
                                .toList(),
                            onChanged: (v) => set(() => section = v),
                          ),
                  if (mode == 'selection')
                    SizedBox(
                      height: 250,
                      child: ListView.builder(
                        itemCount: members.length,
                        itemBuilder: (context, i) {
                          final id = members[i]['materialId'] as String;
                          return CheckboxListTile(
                            title: Text(expression(id)),
                            value: selected.contains(id),
                            onChanged: (v) => set(() {
                              v == true
                                  ? selected.add(id)
                                  : selected.remove(id);
                            }),
                          );
                        },
                      ),
                    ),
                  if (error != null)
                    Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () {
                final a = int.tryParse(start.text), b = int.tryParse(end.text);
                if (mode == 'ordinals' &&
                        (a == null ||
                            b == null ||
                            a < 1 ||
                            a > b ||
                            b > members.length) ||
                    mode == 'section' && section == null ||
                    mode == 'selection' && selected.isEmpty) {
                  set(() => error = '请选择有效且非空的范围。');
                  return;
                }
                Navigator.pop(context, {
                  'kind': mode,
                  if (mode == 'ordinals') ...{'start': a, 'end': b},
                  if (mode == 'section') 'section': section,
                  if (mode == 'selection') 'material_ids': selected.toList(),
                });
              },
              child: const Text('保存范围'),
            ),
          ],
        ),
      ),
    );
    start.dispose();
    end.dispose();
    return result;
  }

  Future<void> inspect(Map<String, dynamic> book) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) =>
            BookMembersScreen(book: book, model: widget.model),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.model,
    builder: (context, _) {
      final model = widget.model;
      final active = model.snapshot!.activity?['status'] == 'active';
      final enabled = !model.busy && !active;
      final books = rows('books')
          .where(
            (b) => '${b['title']} ${b['id']}'.toLowerCase().contains(
              search.toLowerCase(),
            ),
          )
          .toList();
      return Scaffold(
        appBar: AppBar(title: const Text('学习来源')),
        body: ListView(
          key: const ValueKey('curriculum-scroll'),
          padding: const EdgeInsets.all(20),
          children: [
            const Text('词书与补充学习共用每日新学额度。暂停、换词书或移出补充学习都不会删除历史。'),
            if (model.error != null) Text(model.error!),
            if (active)
              FilledButton(
                onPressed: model.busy ? null : () => model.stopActivity(),
                child: const Text('暂停当前活动以调整'),
              ),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton(
                  onPressed: enabled ? model.importPack : null,
                  child: const Text('导入学习包或词书'),
                ),
                OutlinedButton(
                  onPressed: enabled ? selectSources : null,
                  child: const Text('选择学习来源'),
                ),
                TextButton(
                  onPressed: enabled
                      ? () => action({
                          'kind': 'select_sources',
                          'source_ids': null,
                        })
                      : null,
                  child: const Text('使用全部来源'),
                ),
              ],
            ),
            Text(
              '当前范围：${(data['scope']['members'] as List).length} 项（包含准备中的目标）',
            ),
            TextField(
              key: const ValueKey('book-search'),
              decoration: const InputDecoration(labelText: '搜索词书'),
              onChanged: (v) => setState(() => search = v),
            ),
            if (books.isEmpty)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('没有匹配的本机词书。导入学习包后可选择整本学习。'),
              ),
            for (final b in books)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${b['title']} · 版本 ${b['version']}',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text('${(b['members'] as List).length} 个意思'),
                      Wrap(
                        spacing: 8,
                        children: [
                          TextButton(
                            onPressed: () => inspect(b),
                            child: const Text('查看与搜索内容'),
                          ),
                          FilledButton(
                            onPressed: enabled
                                ? () async {
                                    final selected = await range(b);
                                    if (selected != null) {
                                      await action({
                                        'kind': 'enroll',
                                        'book_id': b['id'],
                                        'version': b['version'],
                                        'range': selected,
                                      });
                                    }
                                  }
                                : null,
                            child: const Text('设为当前新学词书'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            const Divider(),
            Text('已选择的词书', style: Theme.of(context).textTheme.titleLarge),
            for (final e in rows('enrollments')) ...[
              Text(
                '${rows('books').firstWhere((b) => b['id'] == e['bookId'] && b['version'] == e['version'])['title']} · ${e['version']}',
              ),
              DropdownButtonFormField<String>(
                key: ValueKey('enrollment-${e['id']}-${e['mode']}'),
                initialValue: e['mode'] as String,
                items: ['active', 'maintenance', 'paused']
                    .map(
                      (m) => DropdownMenuItem(value: m, child: Text(label(m))),
                    )
                    .toList(),
                onChanged: enabled
                    ? (v) => action({
                        'kind': 'set_mode',
                        'enrollment_id': e['id'],
                        'mode': v,
                      })
                    : null,
              ),
              TextButton(
                onPressed: enabled
                    ? () async {
                        final b = rows('books').firstWhere(
                          (b) =>
                              b['id'] == e['bookId'] &&
                              b['version'] == e['version'],
                        );
                        final r = await range(
                          b,
                          initial: e['range'] as Map<String, dynamic>,
                        );
                        if (r != null) {
                          await action({
                            'kind': 'set_range',
                            'enrollment_id': e['id'],
                            'range': r,
                          });
                        }
                      }
                    : null,
                child: const Text('调整未来新学范围'),
              ),
            ],
            const Divider(),
            Text('补充学习', style: Theme.of(context).textTheme.titleLarge),
            if (rows('supplemental').isEmpty) const Text('单独加入学习的意思会显示在这里。'),
            for (final (i, m) in rows('supplemental').indexed)
              ListTile(
                title: Text(m['expression'] as String),
                subtitle: Text(m['active'] == true ? '参与学习' : '已移出，历史保留'),
                trailing: Wrap(
                  children: [
                    if (i > 0)
                      IconButton(
                        tooltip: '上移',
                        onPressed: enabled
                            ? () => action({
                                'kind': 'move_supplemental',
                                'target_id': m['targetId'],
                                'before_target_id': rows(
                                  'supplemental',
                                )[i - 1]['targetId'],
                              })
                            : null,
                        icon: const Icon(Icons.arrow_upward),
                      ),
                    TextButton(
                      onPressed: enabled
                          ? () => action({
                              'kind': 'supplemental',
                              'target_id': m['targetId'],
                              'active': m['active'] != true,
                            })
                          : null,
                      child: Text(m['active'] == true ? '移出学习' : '恢复学习'),
                    ),
                  ],
                ),
              ),
            const Divider(),
            const Text('已暂停的活动保留原范围。开始新活动会结束同模式旧活动，并按当前来源继续尚未完成的学习。'),
            FilledButton(
              onPressed: enabled
                  ? () async {
                      await model.act({
                        'kind': 'activity_fresh',
                        'mode': 'mixed',
                      });
                      if (context.mounted && model.error == null) {
                        Navigator.pop(context);
                      }
                    }
                  : null,
              child: const Text('按当前来源开始新活动'),
            ),
          ],
        ),
      );
    },
  );
}

class BookMembersScreen extends StatefulWidget {
  const BookMembersScreen({super.key, required this.book, required this.model});
  final Map<String, dynamic> book;
  final LibraryViewModel model;
  @override
  State<BookMembersScreen> createState() => _BookMembersScreenState();
}

class _BookMembersScreenState extends State<BookMembersScreen> {
  String search = '';
  int visible = 40;
  @override
  Widget build(BuildContext context) {
    final materials = widget.model.snapshot!.catalog
        .map((m) => m['material'] as Map<String, dynamic>)
        .toList();
    final members = (widget.book['members'] as List)
        .map(
          (m) => materials.where((v) => v['id'] == m['materialId']).firstOrNull,
        )
        .whereType<Map<String, dynamic>>()
        .where(
          (m) => '${m['expression']} ${m['sense']}'.toLowerCase().contains(
            search.toLowerCase(),
          ),
        )
        .toList();
    return Scaffold(
      appBar: AppBar(title: Text(widget.book['title'] as String)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            key: const ValueKey('book-member-search'),
            decoration: const InputDecoration(labelText: '搜索表达或意思'),
            onChanged: (v) => setState(() {
              search = v;
              visible = 40;
            }),
          ),
          Text('找到 ${members.length} 项'),
          for (final m in members.take(visible))
            ListTile(
              onTap: widget.model.busy
                  ? null
                  : () async {
                      await widget.model.selectMaterial(m['id'] as String);
                      if (context.mounted && widget.model.error == null) {
                        Navigator.of(
                          context,
                        ).popUntil((route) => route.isFirst);
                      }
                    },
              title: Text(m['expression'] as String),
              subtitle: Text(m['sense'] as String),
              trailing: Text(
                widget.model.snapshot!.catalog.firstWhere(
                          (c) => c['material']['id'] == m['id'],
                        )['completed'] ==
                        true
                    ? '已完成首学'
                    : '尚未完成首学',
              ),
            ),
          if (members.length > visible)
            TextButton(
              onPressed: () => setState(() => visible += 40),
              child: const Text('显示更多'),
            ),
        ],
      ),
    );
  }
}
