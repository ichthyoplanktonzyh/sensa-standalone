import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import 'agent_controller.dart';

class AgentSettingsScreen extends StatefulWidget {
  const AgentSettingsScreen({super.key, required this.controller});
  final AgentController controller;
  @override
  State<AgentSettingsScreen> createState() => _AgentSettingsScreenState();
}

class _AgentSettingsScreenState extends State<AgentSettingsScreen> {
  Future<void> edit([Map<String, dynamic>? old]) async {
    final name = TextEditingController(text: old?['name'] ?? '我的模型');
    final endpoint = TextEditingController(
      text: old?['endpoint'] ?? 'https://api.deepseek.com',
    );
    final model = TextEditingController(
      text: old?['model'] ?? 'deepseek-v4-flash',
    );
    final key = TextEditingController();
    String kind = old?['kind'] ?? 'compatible';
    bool vision = old?['vision'] ?? false;
    String? failure;
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('模型服务'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('连接配置保存在此设备；凭据只用于本次应用会话，重启需重新填写。材料只发送给你选择的服务。'),
                DropdownButtonFormField<String>(
                  initialValue: kind,
                  items: const [
                    DropdownMenuItem(
                      value: 'compatible',
                      child: Text('自带 Key · OpenAI 兼容接口'),
                    ),
                    DropdownMenuItem(value: 'sensa', child: Text('Sensa 模型服务')),
                  ],
                  onChanged: (v) => set(() => kind = v!),
                ),
                TextField(
                  key: const ValueKey('agent-provider-name'),
                  controller: name,
                  decoration: const InputDecoration(labelText: '名称'),
                ),
                TextField(
                  key: const ValueKey('agent-provider-url'),
                  controller: endpoint,
                  decoration: InputDecoration(
                    labelText: kind == 'sensa'
                        ? 'Sensa 服务根地址'
                        : 'API 基础地址（例如 https://api.deepseek.com）',
                  ),
                ),
                TextField(
                  key: const ValueKey('agent-provider-model'),
                  controller: model,
                  decoration: InputDecoration(
                    labelText: kind == 'sensa' ? '模型备注（实际模型由服务设置决定）' : '模型 ID',
                  ),
                ),
                TextField(
                  key: const ValueKey('agent-provider-key'),
                  controller: key,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    labelText: kind == 'sensa' ? 'Sensa 访问令牌' : '模型 API Key',
                  ),
                ),
                CheckboxListTile(
                  value: vision,
                  onChanged: (v) => set(() => vision = v!),
                  title: const Text('此模型支持图片输入'),
                ),
                if (failure != null) Text(failure!),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () async {
                try {
                  await widget.controller.providers.save({
                    'id': old?['id'] ?? const Uuid().v4(),
                    'name': name.text.trim(),
                    'endpoint': endpoint.text.trim(),
                    'model': model.text.trim(),
                    'kind': kind,
                    'vision': vision,
                  }, key.text);
                  widget.controller.changed();
                  if (ctx.mounted) Navigator.pop(ctx);
                } catch (e) {
                  set(() => failure = widget.controller.describe(e));
                }
              },
              child: const Text('保存模型服务'),
            ),
          ],
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
    for (final c in [name, endpoint, model, key]) {
      c.dispose();
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('模型服务设置')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        for (final p in widget.controller.providers.profiles)
          ListTile(
            title: Text(p['name']),
            subtitle: Text(
              '${p['model']} · ${p['vision'] ? '可发送图片' : '文字'}${widget.controller.providers.credential(p['id']).isEmpty ? ' · 需填写凭据' : ''}',
            ),
            leading: IconButton(
              tooltip: '选择此服务',
              icon: Icon(
                widget.controller.providers.selected == p['id']
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
              ),
              onPressed: () async {
                widget.controller.providers.selected = p['id'];
                await widget.controller.providers.persist();
                widget.controller.changed();
                if (mounted) setState(() {});
              },
            ),
            onTap: () => edit(p),
            trailing: IconButton(
              tooltip: '删除此服务',
              onPressed: () async {
                await widget.controller.providers.remove(p['id']);
                widget.controller.changed();
                if (mounted) setState(() {});
              },
              icon: const Icon(Icons.delete_outline),
            ),
          ),
        FilledButton(onPressed: () => edit(), child: const Text('添加模型服务')),
      ],
    ),
  );
}

class AgentHistoryScreen extends StatefulWidget {
  const AgentHistoryScreen({super.key, required this.controller});
  final AgentController controller;
  @override
  State<AgentHistoryScreen> createState() => _AgentHistoryScreenState();
}

class _AgentHistoryScreenState extends State<AgentHistoryScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.load();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) => Scaffold(
      appBar: AppBar(title: const Text('对话与资源准备')),
      body: ListView(
        children: [
          if (widget.controller.error != null) Text(widget.controller.error!),
          if (widget.controller.sessions.isEmpty)
            const ListTile(title: Text('还没有保存的对话。')),
          for (final s in widget.controller.sessions)
            ListTile(
              title: Text(s['kind'] == 'teacher' ? '与语言老师的对话' : '学习资源准备'),
              subtitle: Text(agentStatus(s['status'])),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) =>
                      AgentScreen(controller: widget.controller, id: s['id']),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

String agentStatus(dynamic status) => switch (status) {
  'waiting' => '等你补充一句话',
  'proposal' => '建议已整理，等待你确认',
  'accepted' => '已保存到语义世界',
  'review' => '正在等待独立审核',
  'ready' => '审核通过，待保存材料',
  'committed' => '学习材料已就绪',
  'inflight' => '正在处理；若上次已中断，可以明确继续',
  'failed' => '上次未完成，记录已保留',
  'paused' => '已暂停，记录已保留',
  _ => '可以开始或继续',
};

class AgentScreen extends StatefulWidget {
  const AgentScreen({
    super.key,
    required this.controller,
    this.id,
    this.source,
  });
  final AgentController controller;
  final String? id;
  final Map<String, dynamic>? source;
  @override
  State<AgentScreen> createState() => _AgentScreenState();
}

class _AgentScreenState extends State<AgentScreen> {
  late String? id;
  final input = TextEditingController();
  bool submitting = false, images = true;
  AgentController get c => widget.controller;
  @override
  void initState() {
    super.initState();
    id = widget.id;
    c.load();
  }

  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (submitting || c.busy) return;
    setState(() => submitting = true);
    try {
      if (id == null) {
        if (!c.providers.configured) {
          c.error = '请先选择模型服务，并填写本次会话使用的凭据。';
          c.changed();
          return;
        }
        id = await c.create({
          ...widget.source!,
          if (widget.source!['kind'] == 'world') 'share_images': images,
        });
        if (id == null) return;
      }
      if (input.text.trim().isNotEmpty) {
        await c.say(id!, input.text.trim());
        if (c.error == null) input.clear();
      } else if (['waiting', 'proposal'].contains(c.session(id!)['status'])) {
        c.error = '请补充一句话，或确认已经整理好的建议。';
        c.changed();
      } else {
        await c.run(id!);
      }
    } finally {
      if (mounted) setState(() => submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: c,
    builder: (context, _) {
      final s = id == null
          ? null
          : c.sessions.where((s) => s['id'] == id).firstOrNull;
      final teacher =
          s?['kind'] == 'teacher' || widget.source?['kind'] == 'world';
      final done = ['accepted', 'committed'].contains(s?['status']);
      return Scaffold(
        appBar: AppBar(
          title: Text(teacher ? '和语言老师聊一聊' : '准备学习资源'),
          actions: [
            IconButton(
              tooltip: '模型服务',
              onPressed: c.busy || submitting
                  ? null
                  : () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => AgentSettingsScreen(controller: c),
                        ),
                      );
                      if (mounted) setState(() {});
                    },
              icon: const Icon(Icons.settings_outlined),
            ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            key: const ValueKey('agent-scroll'),
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                teacher
                    ? '说说你想理解或表达的意思。老师会在需要时追问，足够清楚后给出建议。'
                    : '根据已确认的意思和学习方式准备材料，并单独审核；这不会替你完成学习。',
              ),
              Text(
                c.providers.current == null
                    ? '尚未选择模型服务'
                    : '当前服务：${c.providers.current!['name']}',
              ),
              if (id == null && teacher) ...[
                const Text('点击发送后，会把当前材料及本次对话发送给所选服务。其他私人上下文不会随查询发送。'),
                CheckboxListTile(
                  value: images,
                  onChanged: submitting
                      ? null
                      : (v) => setState(() => images = v!),
                  title: const Text('同时发送材料中的图片'),
                ),
                const Text('取消勾选表示只讨论文字，图片仍保存在本机。'),
              ],
              if (s != null) ...[
                Text(agentStatus(s['status'])),
                if (teacher)
                  for (final m in s['messages'])
                    if (['assistant', 'user'].contains(m['role']) &&
                        m['content'] is String &&
                        (m['content'] as String).isNotEmpty)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Text(
                            '${m['role'] == 'user' ? '你' : '老师'}：${m['content']}',
                          ),
                        ),
                      ),
                if (teacher &&
                    s['status'] == 'waiting' &&
                    s['question'] != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text('老师：${s['question']}'),
                    ),
                  ),
                if (s['candidate'] != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: teacher
                            ? [
                                Text(
                                  s['candidate']['expression']['surface'],
                                  style: Theme.of(
                                    context,
                                  ).textTheme.headlineSmall,
                                ),
                                Text(s['candidate']['explanation']),
                                Text(
                                  s['candidate']['semanticSpec']['coreMeaningFocus'],
                                ),
                              ]
                            : [
                                Text(s['candidate']['scene']),
                                Text(s['candidate']['senseFocus']),
                              ],
                      ),
                    ),
                  ),
                if (!teacher && s['review'] != null)
                  Text('独立审核：${s['review']['reason']}'),
                if (s['status'] == 'proposal')
                  FilledButton(
                    onPressed: c.busy || submitting
                        ? null
                        : () => c.accept(id!),
                    child: const Text('就是这个意思，保存'),
                  ),
                if (s['status'] == 'accepted')
                  const Text('上下文、意思和表达已保存。之后可以另行选择加入学习。'),
              ],
              if (c.error != null) Text(c.error!),
              if (c.busy) const LinearProgressIndicator(),
              if (!done && teacher)
                TextField(
                  key: const ValueKey('agent-reply'),
                  controller: input,
                  enabled: !c.busy && !submitting,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(labelText: '补充、回答或更正老师的建议'),
                ),
              if (!done) ...[
                if (c.busy && id != null)
                  OutlinedButton(
                    onPressed: () => c.stop(id!),
                    child: const Text('暂停这轮'),
                  )
                else
                  FilledButton(
                    onPressed: submitting ? null : submit,
                    child: Text(
                      id == null
                          ? teacher
                                ? '发送材料，开始交流'
                                : '开始准备'
                          : s?['status'] == 'waiting' ||
                                s?['status'] == 'proposal'
                          ? '发送补充'
                          : '明确继续',
                    ),
                  ),
                const Text('离开页面会保留记录。重启后不会自动发送请求，凭据也不会保留。'),
              ],
              if (done)
                FilledButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('返回'),
                ),
            ],
          ),
        ),
      );
    },
  );
}
