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
    bool saving = false;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('模型服务'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  '连接配置保存在本机，凭据保存在系统安全存储。更改服务地址或类型需重新填写凭据。材料只发送给你选择的服务。',
                ),
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
                    labelText: kind == 'sensa'
                        ? 'Sensa 访问令牌'
                        : '模型 API Key（留空保留已有凭据）',
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
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: saving
                  ? null
                  : () async {
                      set(() => saving = true);
                      try {
                        await widget.controller.providers.save({
                          'id': old?['id'] ?? const Uuid().v4(),
                          'name': name.text.trim(),
                          'endpoint': endpoint.text.trim(),
                          'model': model.text.trim(),
                          'kind': kind,
                          'vision': vision,
                        }, key.text);
                        widget.controller.error = null;
                        widget.controller.changed();
                        if (ctx.mounted) Navigator.pop(ctx);
                      } catch (e) {
                        if (ctx.mounted) {
                          set(() {
                            saving = false;
                            failure = widget.controller.describe(e);
                          });
                        }
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
              '${p['model']} · ${p['vision'] ? '可发送图片' : '文字'} · ${widget.controller.providers.status(p['id'])}',
            ),
            onTap: () => edit(p),
            trailing: PopupMenuButton<String>(
              tooltip: '管理模型服务',
              onSelected: (value) async {
                try {
                  if (value == 'forget') {
                    await widget.controller.providers.forget(p['id']);
                  } else {
                    await widget.controller.providers.remove(p['id']);
                  }
                  widget.controller.error = null;
                  widget.controller.changed();
                  if (mounted) setState(() {});
                } catch (e) {
                  widget.controller.error = widget.controller.describe(e);
                  widget.controller.changed();
                  if (mounted) setState(() {});
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'forget', child: Text('删除已保存凭据')),
                PopupMenuItem(value: 'remove', child: Text('删除此服务')),
              ],
            ),
          ),
        if (widget.controller.error != null) Text(widget.controller.error!),
        TextButton(
          onPressed: () async {
            await widget.controller.providers.unlock();
            widget.controller.changed();
            if (mounted) setState(() {});
          },
          child: const Text('重新读取安全凭据'),
        ),
        for (final role in const {
          'teacher': '澄清与解释',
          'content': '学习材料生成',
          'review': '独立审核',
          'service': 'Sensa 在线资源',
        }.entries)
          DropdownButtonFormField<String>(
            key: ValueKey(
              'provider-role-${role.key}-${(widget.controller.providers.forPurpose(role.key)?['id'])}',
            ),
            initialValue:
                widget.controller.providers.profiles.any(
                  (p) =>
                      p['id'] ==
                          (widget.controller.providers.forPurpose(
                            role.key,
                          )?['id']) &&
                      (role.key != 'service' || p['kind'] == 'sensa'),
                )
                ? (widget.controller.providers.forPurpose(role.key)?['id'])
                : '',
            decoration: InputDecoration(labelText: role.value),
            items: [
              const DropdownMenuItem(value: '', child: Text('暂不配置')),
              for (final p in widget.controller.providers.profiles)
                if (role.key != 'service' || p['kind'] == 'sensa')
                  DropdownMenuItem(
                    value: p['id'] as String,
                    child: Text(p['name']),
                  ),
            ],
            onChanged: (id) async {
              try {
                await widget.controller.providers.assign(
                  role.key,
                  id == '' ? null : id,
                );
                widget.controller.changed();
                if (mounted) setState(() {});
              } catch (e) {
                widget.controller.error = widget.controller.describe(e);
                if (mounted) setState(() {});
              }
            },
          ),
        const Text(
          '各用途可选择同一服务，也可分别选择。审核使用独立请求。未配置或失效时会停止，不会改用其他服务。Sensa 在线资源用于兼容解析、资源下载等已有服务。',
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
    this.initialMessage,
  });
  final AgentController controller;
  final String? id;
  final Map<String, dynamic>? source;
  final String? initialMessage;
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
    input.text = widget.initialMessage ?? '';
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
        if (!c.providers.ready(
          widget.source!['kind'] == 'content' ? 'content' : 'teacher',
        )) {
          c.error = '请先选择模型服务并保存有效凭据。';
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
          s?['kind'] == 'teacher' ||
          widget.source?['kind'] == 'world' ||
          widget.source?['kind'] == 'capture';
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
                c.providers.forPurpose(teacher ? 'teacher' : 'content') == null
                    ? '尚未选择模型服务'
                    : '当前服务：${c.providers.forPurpose(teacher ? 'teacher' : 'content')!['name']}',
              ),
              if (!teacher)
                Text(
                  '独立审核服务：${c.providers.forPurpose('review')?['name'] ?? '尚未配置'}',
                ),
              if (id == null && widget.source?['kind'] == 'world') ...[
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
                const Text('离开页面会保留记录。重启后不会自动发送请求，凭据保存在系统安全存储。'),
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
