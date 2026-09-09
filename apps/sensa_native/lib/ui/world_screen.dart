import 'product_theme.dart';
import 'agent_screen.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uuid/uuid.dart';
import '../data/world_repository.dart';
import 'library_view_model.dart';
import 'world_model.dart';
import 'preparation_screen.dart';

class WorldScreen extends StatefulWidget {
  const WorldScreen({super.key, required this.library, this.repository});
  final LibraryViewModel library;
  final WorldRepository? repository;
  @override
  State<WorldScreen> createState() => _WorldScreenState();
}

class _WorldScreenState extends State<WorldScreen> {
  late final WorldModel model;
  String view = '列表', search = '';
  int section = 0;
  String? region;
  @override
  void initState() {
    super.initState();
    model = WorldModel(
      widget.repository ?? WorldRepository(widget.library.repository),
      agents: widget.library.agents,
    );
    model.addListener(changed);
    model.load();
  }

  void changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    model.removeListener(changed);
    model.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get meanings =>
      ((model.data?['meanings'] as List?) ?? []).cast<Map<String, dynamic>>();
  Future<void> edit([
    Map<String, dynamic>? draft,
    Map<String, dynamic>? copy,
  ]) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WorldEditor(model: model, record: draft, copy: copy),
      ),
    );
    await model.load();
    if (mounted) setState(() => section = 1);
  }

  Future<void> detail(Map<String, dynamic> m) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WorldDetail(
          model: model,
          library: widget.library,
          meaningId: m['id'],
        ),
      ),
    );
    await model.load();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = meanings
        .where(
          (m) =>
              (section == 2
                  ? m['status'] == 'removed'
                  : m['status'] == 'confirmed') &&
              '${m['sense']} ${m['expression']} ${m['snapshot']['sentence']}'
                  .toLowerCase()
                  .contains(search.toLowerCase()),
        )
        .toList();
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final m in filtered) {
      groups.putIfAbsent(m['contextAnchorId'], () => []).add(m);
    }
    final selected = groups.containsKey(region)
        ? region
        : groups.keys.firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('图文与语义关系'),
        actions: [
          IconButton(
            tooltip: '对话与资源准备',
            icon: const Icon(Icons.chat_outlined),
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) =>
                      AgentHistoryScreen(controller: widget.library.agents),
                ),
              );
              await model.load();
            },
          ),
        ],
      ),
      body: model.data == null
          ? Center(
              child: TextButton(
                onPressed: model.load,
                child: Text(model.error ?? '正在读取本机资料…'),
              ),
            )
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Wrap(
                        spacing: 8,
                        children: [
                          FilledButton(
                            onPressed: model.busy ? null : () => edit(),
                            child: const Text('新建图文材料'),
                          ),
                          for (final (i, label) in [
                            '已保存',
                            '草稿与材料',
                            '已移除',
                          ].indexed)
                            ChoiceChip(
                              label: Text(label),
                              selected: section == i,
                              onSelected: (_) => setState(() => section = i),
                            ),
                        ],
                      ),
                      TextField(
                        key: const ValueKey('world-search'),
                        decoration: const InputDecoration(
                          labelText: '搜索上下文、意思或表达',
                        ),
                        onChanged: (v) => setState(() => search = v),
                      ),
                      if (section == 0)
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final v in ['列表', '展开', '图谱'])
                              ChoiceChip(
                                label: Text(v),
                                selected: view == v,
                                onSelected: (_) => setState(() => view = v),
                              ),
                          ],
                        ),
                      if (model.error != null) Text(model.error!),
                    ],
                  ),
                ),
                Expanded(
                  child: section == 1
                      ? ListView(
                          key: const ValueKey('world-list'),
                          children: [
                            for (final d in model.data!['drafts'])
                              if (d['status'] != 'removed' &&
                                  jsonEncode(d['draft']).toLowerCase().contains(
                                    search.toLowerCase(),
                                  ))
                                ListTile(
                                  title: Text(
                                    d['draft']['familiarExpression']
                                            .toString()
                                            .isNotEmpty
                                        ? d['draft']['familiarExpression']
                                        : '图文材料 · v${d['revision']}',
                                  ),
                                  subtitle: Text(
                                    '${d['status'] == 'accepted'
                                        ? '已确认，可继续补充意思'
                                        : d['status'] == 'inbox'
                                        ? '待确认'
                                        : '编辑草稿'} · ${(d['draft']['blocks'] as List).length} 个材料块',
                                  ),
                                  onTap: () => edit(d),
                                ),
                            if ((model.data!['drafts'] as List).isEmpty)
                              const ListTile(title: Text('还没有图文草稿。')),
                          ],
                        )
                      : section == 0 && view == '图谱'
                      ? Column(
                          children: [
                            if (selected != null)
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                ),
                                child: DropdownButtonFormField<String>(
                                  key: ValueKey(selected),
                                  initialValue: selected,
                                  isExpanded: true,
                                  items: [
                                    for (final key in groups.keys)
                                      DropdownMenuItem(
                                        value: key,
                                        child: Text(
                                          '${groups[key]!.first['snapshot']['sentence']}'
                                                  .isEmpty
                                              ? '图片上下文'
                                              : groups[key]!
                                                    .first['snapshot']['sentence'],
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                  ],
                                  onChanged: (v) => setState(() => region = v),
                                ),
                              ),
                            const Text('上下文 → 意思 → 表达；拖动或双指缩放，点节点查看。'),
                            Expanded(
                              child: selected == null
                                  ? const Center(child: Text('完整确认的内容会出现在图谱中。'))
                                  : WorldGraph(
                                      items: groups[selected]!,
                                      onOpen: detail,
                                    ),
                            ),
                          ],
                        )
                      : ListView(
                          key: const ValueKey('world-list'),
                          padding: const EdgeInsets.all(16),
                          children: [
                            for (final m in filtered)
                              Card(
                                child: ListTile(
                                  title: Text(m['expression']),
                                  subtitle: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(m['sense']),
                                      if (view == '展开') ...[
                                        Text(m['snapshot']['sentence']),
                                        if (m['focus'] != null)
                                          Text('关注点：${m['focus']}'),
                                        Text(
                                          m['bindingMetadata'] == null
                                              ? '来自已确认绑定'
                                              : '${m['bindingMetadata']['relation']} · ${m['bindingMetadata']['semanticCoverage']}',
                                        ),
                                      ],
                                    ],
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () => detail(m),
                                ),
                              ),
                            if (section == 2)
                              for (final d in model.data!['drafts'])
                                if (d['status'] == 'removed')
                                  ListTile(
                                    title: const Text('已移除图文草稿'),
                                    trailing: TextButton(
                                      onPressed: () => model.act(
                                        () => {
                                          'kind': 'membership',
                                          'id': d['id'],
                                          'expected_revision': d['revision'],
                                          'active': true,
                                        },
                                      ),
                                      child: const Text('恢复草稿'),
                                    ),
                                  ),
                            if (filtered.isEmpty)
                              const ListTile(title: Text('这里还没有完整确认的内容。')),
                          ],
                        ),
                ),
              ],
            ),
    );
  }
}

class WorldImage extends StatefulWidget {
  const WorldImage({super.key, required this.repository, required this.digest});
  final WorldRepository repository;
  final String digest;
  @override
  State<WorldImage> createState() => _WorldImageState();
}

class _WorldImageState extends State<WorldImage> {
  late Future<Uint8List> bytes;
  @override
  void initState() {
    super.initState();
    bytes = widget.repository.image(widget.digest);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List>(
    future: bytes,
    builder: (c, s) => s.hasData
        ? Image.memory(
            s.data!,
            height: 180,
            fit: BoxFit.contain,
            errorBuilder: (_, e, st) => const Text('图片无法显示'),
          )
        : Text(s.hasError ? '本机图片不可用，原引用仍保留。' : '正在读取图片…'),
  );
}

class WorldEditor extends StatefulWidget {
  const WorldEditor({super.key, required this.model, this.record, this.copy});
  final WorldModel model;
  final Map<String, dynamic>? record, copy;
  @override
  State<WorldEditor> createState() => _WorldEditorState();
}

class _WorldEditorState extends State<WorldEditor> with WidgetsBindingObserver {
  late String id;
  int revision = 0;
  late TextEditingController familiar;
  List<Map<String, dynamic>> blocks = [];
  final controllers = <String, TextEditingController>{};
  String? start;
  Timer? timer;
  bool closing = false, dirty = false, saving = false;
  String? localError;
  int generation = 0;
  WorldModel get model => widget.model;
  bool get frozen => widget.record?['status'] == 'accepted';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    id = widget.record?['id'] ?? const Uuid().v4();
    revision = widget.record?['revision'] ?? 0;
    final body =
        widget.record?['draft'] ??
        widget.copy ??
        {
          'familiarExpression': '',
          'blocks': [
            {'kind': 'text', 'id': const Uuid().v4(), 'text': ''},
          ],
          'startingPoint': null,
        };
    familiar = TextEditingController(text: body['familiarExpression']);
    start = body['startingPoint'];
    blocks = (jsonDecode(jsonEncode(body['blocks'])) as List)
        .cast<Map<String, dynamic>>();
    for (final b in blocks) {
      if (b['kind'] == 'text') {
        controllers[b['id']] = TextEditingController(text: b['text']);
      }
    }
  }

  Map<String, dynamic> body() => {
    'familiarExpression': familiar.text,
    'startingPoint': start,
    'blocks': [
      for (final b in blocks)
        {...b, if (b['kind'] == 'text') 'text': controllers[b['id']]!.text},
    ],
  };
  void change() {
    if (frozen) return;
    dirty = true;
    generation++;
    timer?.cancel();
    timer = Timer(const Duration(milliseconds: 450), () => save());
    if (mounted) setState(() {});
  }

  Future<void> save({bool submit = false}) async {
    timer?.cancel();
    if (frozen || (!dirty && revision > 0 && !submit)) return;
    if (saving) {
      await model.pending;
      await Future<void>.delayed(const Duration(milliseconds: 30));
      return save(submit: submit);
    }
    saving = true;
    final version = generation;
    final value = body();
    final expected = revision;
    await model.act(
      () => {
        'kind': 'save',
        'id': id,
        'expected_revision': expected,
        'draft': value,
        'submit': submit,
      },
    );
    if (model.error == null) {
      // Advance only our committed revision; never adopt another writer's later revision.
      revision = expected + 1;
      if (version == generation) dirty = false;
    }
    saving = false;
    if (mounted) setState(() => localError = model.error);
    if (dirty && version != generation && model.error == null) await save();
  }

  Future<void> exit() async {
    if (closing) return;
    closing = true;
    await save();
    closing = false;
    if (mounted && localError == null) Navigator.pop(context);
  }

  Future<void> image() async {
    try {
      final bytes = await model.repository.pickImage();
      if (bytes == null) return;
      final digest = await model.repository.putImage(bytes);
      if (mounted) {
        setState(
          () => blocks.add({
            'kind': 'image',
            'id': const Uuid().v4(),
            'digest': digest,
          }),
        );
        change();
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => localError = '图片不可读取或超过限制。支持4MB以内、4096像素以内的PNG/JPEG/WebP。',
        );
      }
    }
  }

  Future<void> resolve() async {
    await save(submit: true);
    if (model.error != null || !mounted) return;
    final source = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('选择已确认的意思与表达'),
        content: SizedBox(
          width: 550,
          height: 400,
          child: ListView(
            children: [
              for (final item in model.data!['materials'])
                ListTile(
                  title: Text(item['material']['expression']),
                  subtitle: Text(
                    '${item['material']['sense']}\n参考：${item['material']['scene']}',
                  ),
                  onTap: () => Navigator.pop(ctx, {
                    'kind': 'material',
                    'id': item['material']['id'],
                  }),
                ),
              for (final m in model.data!['meanings'])
                if (m['status'] == 'confirmed')
                  ListTile(
                    title: Text(m['expression']),
                    subtitle: Text(m['sense']),
                    onTap: () => Navigator.pop(ctx, {
                      'kind': 'meaning',
                      'id': m['id'],
                      'revision': m['revision'],
                    }),
                  ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消'),
          ),
        ],
      ),
    );
    if (source == null || !mounted) return;
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('确认上下文中的这个意思？'),
        content: const Text('确认选择的意思和英语表达适用于这份完整图文材料。保存不会自动加入学习。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('确认并保存连接'),
          ),
        ],
      ),
    );
    if (yes != true) return;
    await model.act(
      () => {
        'kind': 'resolve',
        'id': id,
        'expected_revision': revision,
        'source': source,
        'consent': 'accept_context_expression_sense',
      },
    );
    if (mounted && model.error == null) {
      Navigator.pop(context);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && !frozen) unawaited(save());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    familiar.dispose();
    for (final c in controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (did, _) {
      if (!did) exit();
    },
    child: Scaffold(
      appBar: AppBar(
        title: Text(frozen ? '已确认的图文材料' : '图文材料草稿'),
        leading: BackButton(onPressed: exit),
      ),
      body: Readable(
        child: ListView(
          key: const ValueKey('world-editor-scroll'),
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              frozen
                  ? '原版本保持不变，可以再次选义，或复制后编辑。'
                  : saving
                  ? '正在保存…'
                  : dirty || revision == 0
                  ? '尚未保存'
                  : '已保存在本机',
            ),
            if (localError != null) Text(localError!),
            TextField(
              key: const ValueKey('world-familiar'),
              controller: familiar,
              enabled: !frozen,
              decoration: const InputDecoration(labelText: '熟悉表达或想表达的意思（可选）'),
              onChanged: (_) => change(),
            ),
            DropdownButtonFormField<String>(
              initialValue: start,
              decoration: const InputDecoration(labelText: '从哪里开始（可选）'),
              items: const [
                DropdownMenuItem(
                  value: 'from_experience',
                  child: Text('从上下文开始'),
                ),
                DropdownMenuItem(
                  value: 'from_expression',
                  child: Text('遇到了一个表达'),
                ),
                DropdownMenuItem(value: 'from_sense', child: Text('有意思，想找表达')),
              ],
              onChanged: frozen
                  ? null
                  : (v) {
                      start = v;
                      change();
                    },
            ),
            for (final (i, b) in blocks.indexed)
              Card(
                key: ValueKey(b['id']),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      if (b['kind'] == 'text')
                        TextField(
                          key: ValueKey('world-block-$i'),
                          controller: controllers[b['id']],
                          enabled: !frozen,
                          minLines: 3,
                          maxLines: 8,
                          decoration: const InputDecoration(labelText: '上下文文字'),
                          onChanged: (_) => change(),
                        )
                      else
                        WorldImage(
                          repository: model.repository,
                          digest: b['digest'],
                        ),
                      if (!frozen)
                        Wrap(
                          children: [
                            IconButton(
                              tooltip: '上移材料',
                              onPressed: i == 0
                                  ? null
                                  : () {
                                      final a = blocks.removeAt(i);
                                      blocks.insert(i - 1, a);
                                      change();
                                    },
                              icon: const Icon(Icons.arrow_upward),
                            ),
                            IconButton(
                              tooltip: '移除材料块',
                              onPressed: () {
                                blocks.removeAt(i);
                                change();
                              },
                              icon: const Icon(Icons.remove_circle_outline),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            if (!frozen)
              Wrap(
                children: [
                  TextButton(
                    onPressed: () {
                      final bid = const Uuid().v4();
                      controllers[bid] = TextEditingController();
                      blocks.add({'kind': 'text', 'id': bid, 'text': ''});
                      change();
                    },
                    child: const Text('添加文字'),
                  ),
                  TextButton(onPressed: image, child: const Text('添加图片')),
                ],
              ),
            const Text('保存材料不调用模型。需要帮助时，可以把材料发送给你选择的语言老师服务。'),
            OutlinedButton(
              onPressed: saving
                  ? null
                  : () async {
                      await save(submit: true);
                      if (!context.mounted || model.error != null) return;
                      await Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => AgentScreen(
                            controller: model.agents,
                            source: {
                              'kind': 'world',
                              'draft_id': id,
                              'revision': revision,
                            },
                          ),
                        ),
                      );
                      await model.load();
                      if (context.mounted &&
                          (model.data!['drafts'] as List).any(
                            (d) => d['id'] == id && d['status'] == 'accepted',
                          )) {
                        Navigator.pop(context);
                      }
                    },
              child: const Text('和语言老师聊一聊'),
            ),
            if (!frozen)
              FilledButton(
                onPressed: saving
                    ? null
                    : () async {
                        await save(submit: true);
                        if (context.mounted && model.error == null) {
                          Navigator.pop(context);
                        }
                      },
                child: const Text('保存到待确认材料'),
              ),
            FilledButton(
              onPressed: saving ? null : resolve,
              child: Text(frozen ? '再确认一个意思' : '选择已有意思并确认'),
            ),
            if (frozen || localError != null)
              TextButton(
                onPressed: () async {
                  await Navigator.of(context).pushReplacement(
                    MaterialPageRoute<void>(
                      builder: (_) => WorldEditor(model: model, copy: body()),
                    ),
                  );
                },
                child: const Text('复制为新草稿'),
              ),
            TextButton(
              onPressed: () async {
                await save();
                if (model.error != null) return;
                await model.act(
                  () => {
                    'kind': 'membership',
                    'id': id,
                    'expected_revision': revision,
                    'active': false,
                  },
                );
                if (context.mounted && model.error == null) {
                  Navigator.pop(context);
                }
              },
              child: Text(frozen ? '移除材料入口（保留已确认内容）' : '移除这份草稿'),
            ),
          ],
        ),
      ),
    ),
  );
}

class WorldDetail extends StatelessWidget {
  const WorldDetail({
    super.key,
    required this.model,
    required this.library,
    required this.meaningId,
  });
  final WorldModel model;
  final LibraryViewModel library;
  final String meaningId;
  Future<void> bind(BuildContext context, Map<String, dynamic> m) async {
    final surface = TextEditingController(text: m['expression']);
    String type = m['proposal']['expression']['type'];
    String? relation, coverage, failure;
    bool submitting = false;
    await showDialog<void>(
      barrierDismissible: false,
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('为这个意思补充表达'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(m['sense']),
                if (failure != null) Text(failure!),
                const Text('候选需要你确认。新连接不会改写原表达，也不会自动加入学习。'),
                TextField(
                  key: const ValueKey('binding-surface'),
                  controller: surface,
                  decoration: const InputDecoration(labelText: '英语表达'),
                ),
                DropdownButtonFormField<String>(
                  initialValue: type,
                  decoration: const InputDecoration(labelText: '表达类型'),
                  items: [
                    for (final entry in {
                      'word': '单词',
                      'phrase': '短语',
                      'construction': '构式',
                      'sentence': '句子',
                      'utterance_strategy': '表达策略',
                    }.entries)
                      DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                  ],
                  onChanged: (v) => set(() => type = v!),
                ),
                DropdownButtonFormField<String>(
                  key: const ValueKey('binding-relation'),
                  decoration: const InputDecoration(labelText: '和这个意思的关系'),
                  items: [
                    for (final entry in {
                      'realizes': '表达这个意思',
                      'approximates': '近似表达',
                      'evokes': '唤起联想',
                    }.entries)
                      DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                  ],
                  onChanged: (v) => set(() => relation = v),
                ),
                DropdownButtonFormField<String>(
                  key: const ValueKey('binding-coverage'),
                  decoration: const InputDecoration(labelText: '含义覆盖范围'),
                  items: [
                    for (final entry in {
                      'exact': '恰好覆盖',
                      'broader': '更宽',
                      'narrower': '更窄',
                      'overlapping': '部分重叠',
                    }.entries)
                      DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                  ],
                  onChanged: (v) => set(() => coverage = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: submitting ? null : () => Navigator.pop(ctx),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: submitting || relation == null || coverage == null
                  ? null
                  : () async {
                      set(() => submitting = true);
                      final action = {
                        'kind': 'bind',
                        'meaning_id': m['id'],
                        'expected_revision': m['revision'],
                        'surface': surface.text,
                        'expression_type': type,
                        'relation': relation,
                        'coverage': coverage,
                        'consent': 'confirm_expression_binding',
                      };
                      await model.act(() => action);
                      if (!ctx.mounted) return;
                      if (model.error == null) {
                        Navigator.pop(ctx);
                      } else {
                        set(() {
                          submitting = false;
                          failure = model.error;
                        });
                      }
                    },
              child: const Text('确认表达连接'),
            ),
          ],
        ),
      ),
    );
    // The dialog route may still render its reverse transition.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    surface.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final m = (model.data!['meanings'] as List)
          .cast<Map<String, dynamic>>()
          .where((m) => m['id'] == meaningId)
          .firstOrNull;
      if (m == null) {
        return Scaffold(appBar: AppBar(), body: const Text('内容暂不可用，请返回重试。'));
      }
      final draft = m['worldContext']?['draft'];
      final binding = m['bindingMetadata'];
      final supported =
          binding == null ||
          (binding['relation'] == 'realizes' &&
              binding['semanticCoverage'] == 'exact');
      final siblings = (model.data!['meanings'] as List).where(
        (v) =>
            v['status'] == 'confirmed' &&
            v['contextAnchorId'] == m['contextAnchorId'] &&
            v['id'] != m['id'],
      );
      return Scaffold(
        appBar: AppBar(title: const Text('上下文与表达')),
        body: Readable(
          child: ListView(
            key: const ValueKey('world-detail-scroll'),
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                m['expression'],
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              Text(m['sense'], style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              const Text('上下文'),
              if (draft != null) ...[
                for (final b in draft['blocks'])
                  if (b['kind'] == 'text')
                    SelectableText(b['text'])
                  else
                    WorldImage(
                      repository: model.repository,
                      digest: b['digest'],
                    ),
                if (draft['familiarExpression'] != '')
                  SelectableText(draft['familiarExpression']),
              ] else
                SelectableText(m['snapshot']['sentence']),
              if (m['focus'] != null) Text('关注点：${m['focus']}'),
              if (m['sourceLink'] != null)
                TextButton(
                  onPressed: () =>
                      Clipboard.setData(ClipboardData(text: m['sourceLink'])),
                  child: const Text('复制来源链接'),
                ),
              Text('来源：${m['materialSource'] ?? '本人确认'}'),
              Text(
                binding == null
                    ? '已确认表达连接'
                    : '${binding['type']} · ${binding['relation']} · ${binding['semanticCoverage']}',
              ),
              ExpansionTile(
                key: const PageStorageKey('world_screen-detail-1'),
                title: const Text('版本与确认来源'),
                children: [
                  SelectableText(
                    '上下文：${m['contextAnchorId']}\n意思版本：${m['senseVersionId']}\n表达版本：${m['bindingVersionId']}\n${jsonEncode(m['resolutionProvenance'])}',
                  ),
                ],
              ),
              if (model.error != null) Text(model.error!),
              if (m['status'] == 'removed')
                FilledButton(
                  onPressed: model.busy
                      ? null
                      : () => model.act(
                          () => {
                            'kind': 'meaning_membership',
                            'meaning_id': meaningId,
                            'expected_revision': m['revision'],
                            'active': true,
                          },
                        ),
                  child: const Text('恢复这个连接'),
                )
              else ...[
                if (!supported) const Text('这个关系已保存。目前学习资源仅支持恰好表达该意思的连接。'),
                FilledButton(
                  onPressed:
                      model.busy || !supported || m['addedToLearning'] == true
                      ? null
                      : () async {
                          await library.load();
                          if (!context.mounted) return;
                          if (m['materialId'] == null) {
                            await Navigator.push(
                              context,
                              MaterialPageRoute<void>(
                                builder: (_) => PreparationScreen(
                                  model: library,
                                  meaningId: meaningId,
                                ),
                              ),
                            );
                          } else {
                            await library.personalAction({
                              'kind': 'add_to_learning',
                              'meaning_id': meaningId,
                              'expected_revision': m['revision'],
                            });
                            if (context.mounted && library.error != null) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(library.error!)),
                              );
                            }
                          }
                          await model.load();
                        },
                  child: Text(
                    m['addedToLearning'] == true ? '已加入学习' : '显式加入学习',
                  ),
                ),
                if (m['proposal'] != null)
                  OutlinedButton(
                    onPressed: model.busy ? null : () => bind(context, m),
                    child: const Text('补充一个表达'),
                  )
                else
                  const Text('这份旧材料未携带完整词义定义，暂不能据此确认新的表达绑定。'),
                if (draft != null) ...[
                  OutlinedButton(
                    onPressed: model.busy
                        ? null
                        : () async {
                            await Navigator.push(
                              context,
                              MaterialPageRoute<void>(
                                builder: (_) => WorldEditor(
                                  model: model,
                                  copy: Map<String, dynamic>.from(draft),
                                ),
                              ),
                            );
                            await model.load();
                          },
                    child: const Text('复制上下文后编辑'),
                  ),
                  for (final d in model.data!['drafts'])
                    if (d['id'] == m['worldContext']['id'] &&
                        d['status'] == 'accepted')
                      OutlinedButton(
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                WorldEditor(model: model, record: d),
                          ),
                        ),
                        child: const Text('同一上下文补充意思'),
                      ),
                ],
                TextButton(
                  onPressed: model.busy
                      ? null
                      : () => model.act(
                          () => {
                            'kind': 'meaning_membership',
                            'meaning_id': meaningId,
                            'expected_revision': m['revision'],
                            'active': false,
                          },
                        ),
                  child: const Text('移除这个连接'),
                ),
              ],
              if (siblings.isNotEmpty) const Text('同一上下文的其他连接'),
              for (final other in siblings)
                ListTile(
                  title: Text(other['expression']),
                  subtitle: Text(other['sense']),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) => WorldDetail(
                        model: model,
                        library: library,
                        meaningId: other['id'],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    },
  );
}

class WorldGraph extends StatelessWidget {
  const WorldGraph({super.key, required this.items, required this.onOpen});
  final List<Map<String, dynamic>> items;
  final void Function(Map<String, dynamic>) onOpen;
  @override
  Widget build(BuildContext context) {
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final m in items) {
      groups.putIfAbsent(m['senseVersionId'], () => []).add(m);
    }
    final height = items.length * 160.0 + 40;
    final nodes = <Widget>[];
    final lines = <({Offset start, Offset end})>[];
    final center = Offset(140, height / 2);
    double row = 20;
    Widget node(
      String label,
      String text,
      double x,
      double y,
      double width,
      Map<String, dynamic> m,
    ) => Positioned(
      left: x,
      top: y,
      width: width,
      height: 130,
      child: Card(
        child: InkWell(
          onTap: () => onOpen(m),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 8),
                Expanded(
                  child: Text(
                    text,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    nodes.add(
      node(
        '上下文',
        items.first['snapshot']['sentence'].toString().isEmpty
            ? '图片上下文'
            : items.first['snapshot']['sentence'],
        20,
        center.dy - 65,
        240,
        items.first,
      ),
    );
    for (final group in groups.values) {
      final y = row + (group.length - 1) * 80;
      lines.add((start: Offset(260, center.dy), end: Offset(340, y + 65)));
      nodes.add(
        node(
          group.first['focus'] == null ? '意思' : '意思 · ${group.first['focus']}',
          group.first['sense'],
          340,
          y,
          240,
          group.first,
        ),
      );
      for (final m in group) {
        lines.add((start: Offset(580, y + 65), end: Offset(660, row + 65)));
        nodes.add(node('表达', m['expression'], 660, row, 220, m));
        row += 160;
      }
    }
    return InteractiveViewer(
      constrained: false,
      boundaryMargin: const EdgeInsets.all(60),
      minScale: 0.25,
      maxScale: 2,
      child: SizedBox(
        width: 910,
        height: height,
        child: CustomPaint(
          painter: _WorldEdges(lines, Theme.of(context).colorScheme.outline),
          child: Stack(children: nodes),
        ),
      ),
    );
  }
}

class _WorldEdges extends CustomPainter {
  _WorldEdges(this.lines, this.color);
  final List<({Offset start, Offset end})> lines;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color
      ..strokeWidth = 2;
    for (final line in lines) {
      canvas.drawLine(line.start, line.end, p);
    }
  }

  @override
  bool shouldRepaint(covariant _WorldEdges old) =>
      old.lines != lines || old.color != color;
}
