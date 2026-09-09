import 'semantic_resolution_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'library_view_model.dart';

/// Personal content consumes Rust projections; no UI flag can confirm a Sense.
class PersonalWorldScreen extends StatefulWidget {
  const PersonalWorldScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<PersonalWorldScreen> createState() => _PersonalWorldScreenState();
}

class _PersonalWorldScreenState extends State<PersonalWorldScreen> {
  int section = 0;
  String search = '';
  LibraryViewModel get model => widget.model;
  Future<void> compose({
    Map<String, dynamic>? intake,
    Map<String, dynamic>? copy,
  }) async {
    final accepted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            _CaptureEditor(model: model, intake: intake, copy: copy),
      ),
    );
    if (mounted && accepted != null) {
      setState(() => section = accepted ? 0 : 1);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(accepted ? '词义已保存到本机。' : '材料已保存在收件箱。')),
      );
    }
  }

  Future<void> openLookup(Map<String, dynamic> lookup) async {
    final accepted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => SemanticResolutionScreen(
          model: model,
          capture: lookup['request']['snapshot'] as Map<String, dynamic>,
          intakeId: lookup['intakeId'] as String?,
        ),
      ),
    );
    if (mounted && accepted == true) setState(() => section = 0);
  }

  Future<void> membership(
    Map<String, dynamic> item,
    String entity,
    bool active,
  ) => model.personalAction({
    'kind': 'set_membership',
    'entity': entity,
    'id': item['id'],
    'expected_revision': item['revision'],
    'active': active,
  });
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final p = model.snapshot!.personal;
      final meanings = (p['meanings'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      final intakes = (p['intakes'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      final items =
          [
                if (section == 1)
                  for (final lookup in model.lookups.where(
                    (v) =>
                        v['status'] != 'accepted' &&
                        v['status'] != 'superseded',
                  ))
                    {
                      ...lookup,
                      'snapshot': lookup['request']['snapshot'],
                      'entity': 'lookup',
                    },
                for (final m in meanings)
                  if (section == 0 && m['status'] == 'confirmed' ||
                      section == 2 && m['status'] == 'removed')
                    {...m, 'entity': 'meaning'},
                for (final i in intakes)
                  if (section == 1 && i['status'] == 'inbox' ||
                      section == 2 && i['status'] == 'removed')
                    {...i, 'entity': 'intake'},
              ]
              .where(
                (i) =>
                    '${i['snapshot']['sentence']} ${i['sense'] ?? ''} ${i['expression'] ?? ''}'
                        .toLowerCase()
                        .contains(search.toLowerCase()),
              )
              .toList();
      return Scaffold(
        appBar: AppBar(title: const Text('我的词义世界')),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 800),
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text('保存身边的上下文，在确认词义后建立自己的表达连接。'),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: model.busy ? null : () => compose(),
                          child: const Text('保存材料'),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final (index, label) in [
                              '已保存',
                              '收件箱',
                              '已移除',
                            ].indexed)
                              ChoiceChip(
                                label: Text(label),
                                selected: section == index,
                                onSelected: (_) =>
                                    setState(() => section = index),
                              ),
                          ],
                        ),
                        TextField(
                          key: const ValueKey('personal-search'),
                          decoration: const InputDecoration(
                            labelText: '搜索上下文、表达或词义',
                          ),
                          onChanged: (value) => setState(() => search = value),
                        ),
                      ],
                    ),
                  ),
                  if (model.error != null) _ErrorNotice(model: model),
                  Expanded(
                    child: items.isEmpty
                        ? const Center(child: Text('这里还没有内容。'))
                        : ListView.builder(
                            key: const ValueKey('personal-items'),
                            itemCount: items.length,
                            itemBuilder: (context, index) {
                              final item = items[index];
                              if (item['entity'] == 'lookup') {
                                return ListTile(
                                  title: Text(
                                    '待确认：${item['request']['snapshot']['expression']['text']}',
                                  ),
                                  subtitle: const Text('查看解释、补充关注点或恢复请求'),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () => openLookup(item),
                                );
                              }
                              final meaning = item['entity'] == 'meaning';
                              final removed = item['status'] == 'removed';
                              return Card(
                                margin: const EdgeInsets.fromLTRB(
                                  16,
                                  4,
                                  16,
                                  12,
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      if (meaning)
                                        Text(
                                          item['expression'] as String,
                                          style: Theme.of(
                                            context,
                                          ).textTheme.titleLarge,
                                        ),
                                      SelectableText(
                                        item['snapshot']['sentence'] as String,
                                      ),
                                      if (meaning) ...[
                                        const SizedBox(height: 8),
                                        Text(item['sense'] as String),
                                        if (item['focus'] != null)
                                          Text('关注点：${item['focus']}'),
                                        Text('词义来源：${item['materialSource']}'),
                                        const Text('已确认保存；保存本身不会开始学习。'),
                                      ],
                                      if (item['snapshot']['source']['title'] !=
                                          '')
                                        Text(
                                          '来源：${item['snapshot']['source']['title']}',
                                        ),
                                      if (item['sourceLink'] != null)
                                        SelectableText(
                                          item['sourceLink'] as String,
                                        ),
                                      Wrap(
                                        spacing: 8,
                                        children: [
                                          if (item['sourceLink'] != null)
                                            TextButton(
                                              onPressed: () =>
                                                  Clipboard.setData(
                                                    ClipboardData(
                                                      text:
                                                          item['sourceLink']
                                                              as String,
                                                    ),
                                                  ),
                                              child: const Text('复制来源链接'),
                                            ),
                                          if (removed)
                                            OutlinedButton(
                                              onPressed: model.busy
                                                  ? null
                                                  : () => membership(
                                                      item,
                                                      item['entity'] as String,
                                                      true,
                                                    ),
                                              child: const Text('恢复'),
                                            )
                                          else ...[
                                            if (!meaning)
                                              FilledButton(
                                                onPressed: model.busy
                                                    ? null
                                                    : () =>
                                                          compose(intake: item),
                                                child: const Text('选择表达与词义'),
                                              ),
                                            if (meaning)
                                              FilledButton(
                                                onPressed:
                                                    model.busy ||
                                                        item['materialId'] ==
                                                            null ||
                                                        item['addedToLearning'] ==
                                                            true
                                                    ? null
                                                    : () => model.personalAction(
                                                        {
                                                          'kind':
                                                              'add_to_learning',
                                                          'meaning_id':
                                                              item['id'],
                                                          'expected_revision':
                                                              item['revision'],
                                                        },
                                                      ),
                                                child: Text(
                                                  item['addedToLearning'] ==
                                                          true
                                                      ? '已加入学习'
                                                      : item['materialId'] ==
                                                            null
                                                      ? '学习材料尚未准备'
                                                      : '加入学习',
                                                ),
                                              ),
                                            TextButton(
                                              onPressed: model.busy
                                                  ? null
                                                  : () => membership(
                                                      item,
                                                      item['entity'] as String,
                                                      false,
                                                    ),
                                              child: const Text('移除'),
                                            ),
                                            if (meaning)
                                              TextButton(
                                                onPressed: model.busy
                                                    ? null
                                                    : () => compose(
                                                        copy:
                                                            item['snapshot']
                                                                as Map<
                                                                  String,
                                                                  dynamic
                                                                >,
                                                      ),
                                                child: const Text('以此重新保存'),
                                              ),
                                          ],
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}

class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({required this.model});
  final LibraryViewModel model;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(12),
    child: Column(
      children: [
        Semantics(
          liveRegion: true,
          child: Text(
            model.error ?? '',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
        Wrap(
          spacing: 8,
          children: [
            TextButton(
              onPressed: model.busy ? null : model.retry,
              child: const Text('重试保存'),
            ),
            TextButton(
              onPressed: model.busy ? null : model.load,
              child: const Text('重新读取'),
            ),
          ],
        ),
      ],
    ),
  );
}

class _CaptureEditor extends StatefulWidget {
  const _CaptureEditor({required this.model, this.intake, this.copy});
  final LibraryViewModel model;
  final Map<String, dynamic>? intake;
  final Map<String, dynamic>? copy;
  @override
  State<_CaptureEditor> createState() => _CaptureEditorState();
}

class _CaptureEditorState extends State<_CaptureEditor> {
  late final TextEditingController contextText,
      expressionText,
      sourceUrl,
      sourceTitle;
  late final Map<String, dynamic> source;
  int? occurrence;
  String? materialId;
  LibraryViewModel get model => widget.model;
  @override
  void initState() {
    super.initState();
    final snapshot =
        widget.intake?['snapshot'] as Map<String, dynamic>? ?? widget.copy;
    contextText = TextEditingController(
      text: snapshot?['sentence'] as String? ?? '',
    );
    expressionText = TextEditingController(
      text: snapshot?['expression']?['text'] as String? ?? '',
    );
    source = Map<String, dynamic>.from(
      snapshot?['source'] as Map? ??
          {
            'url': null,
            'title': '',
            'capturedAt': DateTime.now().toUtc().toIso8601String(),
          },
    );
    if (widget.intake == null) {
      source['capturedAt'] = DateTime.now().toUtc().toIso8601String();
    }
    sourceUrl = TextEditingController(text: source['url'] as String? ?? '');
    sourceTitle = TextEditingController(text: source['title'] as String? ?? '');
    occurrence = snapshot?['expression']?['start'] as int?;
  }

  @override
  void dispose() {
    contextText.dispose();
    expressionText.dispose();
    sourceUrl.dispose();
    sourceTitle.dispose();
    super.dispose();
  }

  List<int> get positions {
    final text = contextText.text.runes.toList(),
        expression = expressionText.text.runes.toList();
    if (expression.isEmpty) return [];
    return [
      for (var i = 0; i + expression.length <= text.length; i++)
        if (String.fromCharCodes(text.sublist(i, i + expression.length)) ==
            expressionText.text)
          i,
    ];
  }

  Map<String, dynamic> get snapshot {
    final starts = positions;
    final start = starts.length == 1
        ? starts.first
        : starts.contains(occurrence)
        ? occurrence
        : null;
    return {
      'sentence': contextText.text,
      'language': 'en',
      'source': widget.intake != null
          ? source
          : {
              ...source,
              'url': sourceUrl.text.trim().isEmpty
                  ? null
                  : sourceUrl.text.trim(),
              'title': sourceTitle.text,
            },
      'expression': start == null
          ? null
          : {
              'text': expressionText.text,
              'start': start,
              'end': start + expressionText.text.runes.length,
            },
    };
  }

  Future<void> explain() async {
    final accepted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => SemanticResolutionScreen(
          model: model,
          capture: snapshot,
          intakeId: widget.intake?['id'] as String?,
        ),
      ),
    );
    if (mounted && accepted == true) Navigator.pop(context, true);
  }

  Future<void> save(bool accept) async {
    await model.personalAction(
      accept
          ? {
              'kind': 'accept',
              'snapshot': snapshot,
              'material_id': materialId,
              'intake_id': widget.intake?['id'],
              'focus': null,
              'consent': 'accept_context_expression_sense',
            }
          : {'kind': 'save_intake', 'snapshot': snapshot},
    );
    if (mounted && model.error == null) Navigator.pop(context, accept);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final starts = positions;
      final selected = snapshot['expression'] != null;
      final candidates = model.snapshot!.catalog
          .map((e) => e['material'] as Map<String, dynamic>)
          .where(
            (m) =>
                m['expression'].toString().trim().toLowerCase() ==
                expressionText.text.trim().toLowerCase(),
          )
          .toList();
      final available = !model.busy && model.error == null;
      return Scaffold(
        appBar: AppBar(title: Text(widget.intake == null ? '保存材料' : '确认这份材料')),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: ListView(
                key: const ValueKey('capture-scroll'),
                padding: const EdgeInsets.all(20),
                children: [
                  TextField(
                    key: const ValueKey('capture-context'),
                    controller: contextText,
                    readOnly: widget.intake != null,
                    decoration: const InputDecoration(labelText: '英文上下文（必填）'),
                    minLines: 4,
                    maxLines: 8,
                    onChanged: (_) => setState(() {
                      occurrence = null;
                      materialId = null;
                    }),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    key: const ValueKey('capture-expression'),
                    controller: expressionText,
                    readOnly: widget.intake?['snapshot']?['expression'] != null,
                    decoration: const InputDecoration(
                      labelText: '原文中的表达（可稍后选择）',
                    ),
                    onChanged: (_) => setState(() {
                      occurrence = null;
                      materialId = null;
                    }),
                  ),
                  if (expressionText.text.isNotEmpty && starts.isEmpty)
                    const Text('表达需要与原文中的文字一致；也可以先只保存上下文。'),
                  if (starts.length > 1) ...[
                    const Text('原文多次出现此表达，请选择你要保存的那一次：'),
                    RadioGroup<int>(
                      groupValue: occurrence,
                      onChanged: (v) {
                        if (available) setState(() => occurrence = v);
                      },
                      child: Column(
                        children: [
                          for (final (i, start) in starts.indexed)
                            RadioListTile<int>(
                              title: Text(
                                '第 ${i + 1} 处：${expressionText.text}',
                              ),
                              value: start,
                              enabled: available,
                            ),
                        ],
                      ),
                    ),
                  ],
                  if (widget.intake == null) ...[
                    TextField(
                      key: const ValueKey('capture-source-title'),
                      controller: sourceTitle,
                      decoration: const InputDecoration(labelText: '来源名称（可选）'),
                    ),
                    TextField(
                      key: const ValueKey('capture-source-url'),
                      controller: sourceUrl,
                      decoration: const InputDecoration(labelText: '来源链接（可选）'),
                    ),
                  ],
                  const SizedBox(height: 20),
                  if (widget.intake == null)
                    OutlinedButton(
                      onPressed: available && contextText.text.trim().isNotEmpty
                          ? () => save(false)
                          : null,
                      child: const Text('先保存到收件箱'),
                    ),
                  if (selected) ...[
                    OutlinedButton(
                      onPressed: available ? explain : null,
                      child: const Text('在线解释这个表达'),
                    ),
                    Text(
                      '选择这段上下文中的词义',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (candidates.isEmpty)
                      const Text('本机暂时没有匹配的词义。可以在线解释，也可以先保留在收件箱。'),
                    RadioGroup<String>(
                      groupValue: materialId,
                      onChanged: (v) {
                        if (available) setState(() => materialId = v);
                      },
                      child: Column(
                        children: [
                          for (final m in candidates)
                            RadioListTile<String>(
                              key: ValueKey('sense-${m['id']}'),
                              title: Text(m['sense'] as String),
                              subtitle: Text(
                                '参考场景：${m['scene']}\n来源：${m['source']}',
                              ),
                              value: m['id'] as String,
                              enabled: available,
                            ),
                        ],
                      ),
                    ),
                    if (candidates.isNotEmpty)
                      const Text('请确认所选词义与原文相符。保存只建立词义连接，加入学习需要另外选择。'),
                    if (candidates.any((m) => m['id'] == materialId))
                      FilledButton(
                        onPressed: available ? () => save(true) : null,
                        child: const Text('确认词义并保存'),
                      ),
                  ],
                  if (model.error != null) _ErrorNotice(model: model),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
