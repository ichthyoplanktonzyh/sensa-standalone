import 'package:flutter/material.dart';
import '../data/practice_repository.dart';
import 'library_view_model.dart';
import 'practice_model.dart';
import 'youglish_view.dart';
import 'product_theme.dart';

class PracticeScreen extends StatefulWidget {
  const PracticeScreen({
    super.key,
    required this.library,
    this.fixtureScript,
    this.onExit,
  });
  final LibraryViewModel library;
  final String? fixtureScript;
  final VoidCallback? onExit;
  @override
  State<PracticeScreen> createState() => _PracticeScreenState();
}

class _PracticeScreenState extends State<PracticeScreen> {
  late final PracticeModel model;
  final brief = TextEditingController(text: '听一听同一表达在不同说话者中的用法');
  bool playerOpen = false, closing = false;
  int generation = 0;
  String status = 'loading';
  Map<String, dynamic> observation = {};
  Future<void> Function(String)? player;
  Future<void> events = Future.value();
  @override
  void initState() {
    super.initState();
    model = PracticeModel(PracticeRepository(widget.library.repository.path));
    model.addListener(changed);
    model.load();
  }

  void changed() {
    final savedBrief = model.session?['snapshot']['brief'] as String?;
    if (savedBrief != null && brief.text != savedBrief) brief.text = savedBrief;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    player?.call('pause');
    model.removeListener(changed);
    model.dispose();
    brief.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get targets =>
      ((model.session?['snapshot']['expressions'] ??
                      model.data?['catalog']['targets'])
                  as List? ??
              [])
          .cast<Map<String, dynamic>>();
  Map<String, dynamic> get state =>
      model.session?['state'] as Map<String, dynamic>? ??
      {'index': 0, 'accent': 'all', 'rate': 1.0};
  Future<void> provider(Map<String, dynamic> e, int token) {
    events = events
        .then((_) async {
          if (!mounted || !playerOpen || closing || token != generation) return;
          final total = (e['total'] as num?)?.toInt() ?? 0;
          final value = {
            'kind': 'provider',
            'playing': e['playing'],
            'status': e['status'],
            'total': total.clamp(0, 10000000),
            'caption': (e['caption'] as String?)?.substring(
              0,
              ((e['caption'] as String?)?.length ?? 0).clamp(0, 4000),
            ),
            'video': e['video']?.toString(),
            'occurrence': (e['occurrence'] as num?)?.toInt(),
          };
          if (model.session == null && e['status'] == 'ready' && total > 0) {
            await model.act(
              () => {
                'kind': 'start',
                'brief': brief.text,
                'provider_available': true,
              },
            );
          }
          if (model.session != null) await model.turn(value);
          if (mounted && playerOpen && token == generation) {
            setState(() {
              status = e['status'] as String;
              observation = e;
            });
          }
        })
        .catchError((_) {
          if (mounted) setState(() => status = 'error');
        });
    return events;
  }

  Future<void> controls(String kind) async {
    await model.turn({'kind': kind});
    if (model.error == null) await player?.call(kind);
  }

  Future<void> changeQuery(Map<String, dynamic> event) async {
    closing = true;
    await player?.call('pause');
    await events;
    await model.turn(event);
    if (mounted) {
      setState(() {
        generation++;
        closing = false;
        status = 'loading';
        observation = {};
      });
    }
  }

  Future<void> closePlayer() async {
    closing = true;
    await player?.call('pause');
    await events;
    if (model.session != null) await model.turn({'kind': 'pause'});
    if (mounted) {
      setState(() {
        playerOpen = false;
        generation++;
      });
    }
  }

  Future<void> select() async {
    final data = model.data!['catalog'];
    final sources = (data['sources'] as List).cast<Map<String, dynamic>>();
    String source = data['selection']['sourceId'];
    final chosen = ((data['selection']['targetIds'] as List?) ?? [])
        .cast<String>()
        .toSet();
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('练习范围'),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: source,
                    items: const [
                      DropdownMenuItem(
                        value: 'current_study',
                        child: Text('当前学习范围'),
                      ),
                      DropdownMenuItem(
                        value: 'personal_semantic_world',
                        child: Text('我的词义世界'),
                      ),
                    ],
                    onChanged: (v) => set(() => source = v!),
                  ),
                  if (source == 'current_study')
                    Text('${(sources[0]['targets'] as List).length} 个目标'),
                  if (source == 'personal_semantic_world') ...[
                    const Text('已确认的意思与表达，无需先加入学习。'),
                    TextButton(
                      onPressed: () => set(() {
                        final all = (sources[1]['targets'] as List)
                            .map((t) => t['targetId'] as String)
                            .toSet();
                        chosen.length == all.length
                            ? chosen.clear()
                            : chosen.addAll(all);
                      }),
                      child: const Text('全选 / 清空'),
                    ),
                    for (final t in sources[1]['targets'])
                      CheckboxListTile(
                        value: chosen.contains(t['targetId']),
                        title: Text(t['expression']),
                        subtitle: Text('${t['sense']}\n${t['context']}'),
                        onChanged: (v) => set(
                          () => v == true
                              ? chosen.add(t['targetId'])
                              : chosen.remove(t['targetId']),
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: source == 'personal_semantic_world' && chosen.isEmpty
                  ? null
                  : () => Navigator.pop(ctx, {
                      'sourceId': source,
                      if (source == 'personal_semantic_world')
                        'targetIds': chosen.toList(),
                    }),
              child: const Text('使用此范围'),
            ),
          ],
        ),
      ),
    );
    if (result != null) {
      await model.act(() => {'kind': 'select', 'selection': result});
    }
  }

  void open() {
    setState(() {
      closing = false;
      playerOpen = true;
      generation++;
      status = 'loading';
      observation = {};
    });
  }

  @override
  Widget build(BuildContext context) {
    final ready = status == 'ready' && !model.busy && model.error == null;
    final current = targets.isEmpty
        ? null
        : targets[(state['index'] as int).clamp(0, targets.length - 1)];
    final token = generation;
    return PopScope(
      canPop: !playerOpen && widget.onExit == null,
      onPopInvokedWithResult: (p, _) async {
        if (!p) {
          if (playerOpen) {
            await closePlayer();
          } else {
            widget.onExit?.call();
          }
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(playerOpen ? '真实语流泛化' : '自由练习'),
          leading: BackButton(
            onPressed: () async {
              if (playerOpen) {
                await closePlayer();
              } else if (widget.onExit != null) {
                widget.onExit!();
              } else if (context.mounted) {
                Navigator.pop(context);
              }
            },
          ),
        ),
        body: model.data == null
            ? Center(
                child: model.error == null
                    ? const CircularProgressIndicator()
                    : TextButton(
                        onPressed: model.load,
                        child: Text('${model.error} 点击重试'),
                      ),
              )
            : Readable(
                child: ListView(
                  key: const ValueKey('practice-scroll'),
                  padding: const EdgeInsets.all(20),
                  children: [
                    const Text('自由练习不改变正式学习、复习进度、每日额度或到期时间。'),
                    if (model.error != null) ...[
                      Text(model.error!),
                      TextButton(
                        onPressed: model.load,
                        child: const Text('重新读取练习'),
                      ),
                    ],
                    if (!playerOpen) ...[
                      TextButton(
                        onPressed: model.busy ? null : select,
                        child: const Text('选择练习范围'),
                      ),
                      Text(
                        '${(model.data!['catalog']['targets'] as List).length} 个目标 · ${(model.data!['catalog']['targets'] as List).map((t) => t['expression']).toSet().length} 个表达',
                      ),
                      for (final t
                          in (model.data!['catalog']['targets'] as List))
                        ListTile(
                          title: Text(t['expression']),
                          subtitle: Text(t['sense']),
                        ),
                      if ((model.data!['catalog']['blockedTargets'] as List)
                          .isNotEmpty)
                        const Text('部分表达可能同形异音，当前来源无法约束发音，已排除。'),
                      TextField(
                        key: const ValueKey('practice-brief'),
                        controller: brief,
                        enabled: model.session == null,
                        maxLength: 500,
                        decoration: const InputDecoration(labelText: '这次想练习什么'),
                      ),
                      const Text('听 · 真实语流泛化'),
                      const Text('YouGlish 需要联网。说、读、写的执行与资源尚未交付。'),
                      FilledButton(
                        onPressed: model.busy || targets.isEmpty ? null : open,
                        child: Text(
                          model.session == null ? '进入真实语流' : '继续真实语流',
                        ),
                      ),
                      if (model.session != null) ...[
                        Text(
                          '继续原练习：${model.session!['snapshot']['brief']}（范围保持不变）',
                        ),
                        TextButton(
                          onPressed: model.busy
                              ? null
                              : () => model.act(
                                  () => {
                                    'kind': 'end',
                                    'session_id': model.session!['id'],
                                    'abandoned': true,
                                  },
                                ),
                          child: const Text('放弃这次练习'),
                        ),
                      ],
                      const Divider(),
                      const Text('练习记录'),
                      for (final h in model.data!['history'])
                        ListTile(
                          title: Text(h['snapshot']['brief']),
                          subtitle: Text(
                            '${h['status'] == 'active'
                                ? '未结束'
                                : h['status'] == 'completed'
                                ? '已结束'
                                : '已放弃'} · ${h['turnCount']} 次练习交互',
                          ),
                        ),
                    ] else if (current != null) ...[
                      const Text('按表达形式检索，片段可能包含其他词义。来源：YouGlish。'),
                      Text('原范围中 ${targets.length} 个表达'),
                      DropdownButtonFormField<int>(
                        isExpanded: true,
                        key: ValueKey('expression-${state['index']}'),
                        initialValue: state['index'] as int,
                        items: [
                          for (var i = 0; i < targets.length; i++)
                            DropdownMenuItem(
                              value: i,
                              child: Text(targets[i]['expression']),
                            ),
                        ],
                        onChanged: model.busy || model.session == null
                            ? null
                            : (i) async {
                                await changeQuery({
                                  'kind': 'navigate',
                                  'index': i,
                                });
                                if (mounted) setState(() => status = 'loading');
                              },
                      ),
                      Wrap(
                        spacing: 4,
                        children: [
                          for (final accent in [
                            'all',
                            'us',
                            'uk',
                            'aus',
                            'ca',
                            'ie',
                          ])
                            ChoiceChip(
                              label: Text(
                                {
                                  'all': '全部口音',
                                  'us': '美国',
                                  'uk': '英国',
                                  'aus': '澳洲',
                                  'ca': '加拿大',
                                  'ie': '爱尔兰',
                                }[accent]!,
                              ),
                              selected: state['accent'] == accent,
                              onSelected: model.busy || model.session == null
                                  ? null
                                  : (_) async {
                                      await changeQuery({
                                        'kind': 'accent',
                                        'accent': accent,
                                      });
                                      if (mounted) {
                                        setState(() => status = 'loading');
                                      }
                                    },
                            ),
                        ],
                      ),
                      SizedBox(
                        height: 240,
                        child: YouglishView(
                          key: ValueKey(
                            '$generation-${state['index']}-${state['accent']}',
                          ),
                          expression: current['expression'],
                          accent: state['accent'],
                          rate: (state['rate'] as num).toDouble(),
                          fixtureScript: widget.fixtureScript,
                          onEvent: (e) {
                            if (current['expression'] ==
                                targets[(state['index']
                                    as int)]['expression']) {
                              provider(e, token);
                            }
                          },
                          onController: (c) => player = c,
                        ),
                      ),
                      Text(
                        status == 'ready'
                            ? '找到 ${observation['total'] ?? 0} 段真实语流'
                            : status == 'error'
                            ? '暂时无法连接 YouGlish，请检查网络后重试。'
                            : status == 'empty'
                            ? '当前表达没有找到片段。'
                            : '正在连接 YouGlish…',
                      ),
                      if (status == 'error' || status == 'empty')
                        TextButton(onPressed: open, child: const Text('重试连接')),
                      if (observation['playing'] == true) const Text('播放器正在播放'),
                      if (observation['video'] != null)
                        Text('YouGlish 片段：${observation['video']}'),
                      if (observation['occurrence'] != null)
                        Text('当前第 ${observation['occurrence']} 段'),
                      Text(
                        (observation['caption'] as String? ?? '暂无字幕')
                            .replaceAll('[[[', '')
                            .replaceAll(']]]', ''),
                      ),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final pair in [
                            ('previous', '上一段'),
                            ('play', '播放'),
                            ('pause', '暂停'),
                            ('replay', '重听'),
                            ('next', '下一段'),
                          ])
                            OutlinedButton(
                              onPressed: ready ? () => controls(pair.$1) : null,
                              child: Text(pair.$2),
                            ),
                        ],
                      ),
                      Wrap(
                        spacing: 4,
                        children: [
                          for (final rate in [0.5, 0.75, 1.0, 1.25])
                            ChoiceChip(
                              label: Text('$rate×'),
                              selected: state['rate'] == rate,
                              onSelected: ready
                                  ? (_) => model.turn({
                                      'kind': 'speed',
                                      'rate': rate,
                                    })
                                  : null,
                            ),
                        ],
                      ),
                      TextButton(
                        onPressed: closePlayer,
                        child: const Text('保存并返回自由练习'),
                      ),
                      FilledButton(
                        onPressed: model.busy || model.session == null
                            ? null
                            : () async {
                                closing = true;
                                await player?.call('pause');
                                await events;
                                await model.act(
                                  () => {
                                    'kind': 'end',
                                    'session_id': model.session!['id'],
                                    'abandoned': false,
                                  },
                                );
                                if (mounted) {
                                  setState(() {
                                    playerOpen = false;
                                    generation++;
                                  });
                                }
                              },
                        child: const Text('结束本次练习'),
                      ),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}
