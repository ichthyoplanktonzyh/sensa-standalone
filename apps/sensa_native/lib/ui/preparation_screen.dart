import 'agent_screen.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';
import 'online_service_dialog.dart';
import 'anchor_use_panel.dart';

class PreparationListScreen extends StatelessWidget {
  const PreparationListScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) => Scaffold(
      appBar: AppBar(title: const Text('学习准备')),
      body: ListView(
        children: [
          if (model.preparations.isEmpty)
            const ListTile(title: Text('还没有需要准备材料的学习目标。')),
          for (final task in model.preparations)
            ListTile(
              title: Text(
                task['target']['proposal']['expression']['surface'] as String,
              ),
              subtitle: Text(preparationLabel(task)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => PreparationScreen(
                    model: model,
                    taskId: task['id'] as String,
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

String preparationLabel(Map<String, dynamic> task) => switch (task['status']) {
  'ready' => '材料已就绪',
  'generating' => '正在准备／等待检查',
  'blocked' => '准备受阻，学习目标已保留',
  'cancelled' => '已取消准备，学习目标已保留',
  _ => '已加入学习，等待准备材料',
};

class PreparationScreen extends StatefulWidget {
  const PreparationScreen({
    super.key,
    required this.model,
    this.meaningId,
    this.taskId,
  });
  final LibraryViewModel model;
  final String? meaningId, taskId;
  @override
  State<PreparationScreen> createState() => _PreparationScreenState();
}

class _PreparationScreenState extends State<PreparationScreen> {
  LibraryViewModel get model => widget.model;
  Map<String, dynamic>? selected;
  Map<String, dynamic>? get meaning {
    final meanings = (model.snapshot!.personal['meanings'] as List)
        .cast<Map<String, dynamic>>();
    if (widget.meaningId != null) {
      return meanings.where((m) => m['id'] == widget.meaningId).firstOrNull;
    }
    final slot = model.preparations
        .where((t) => t['id'] == widget.taskId)
        .firstOrNull;
    final source = slot?['anchor']?['meaningId'];
    return meanings
        .where(
          (m) =>
              m['status'] == 'confirmed' &&
              (source != null
                  ? m['id'] == source
                  : m['preparation']?['id'] == widget.taskId),
        )
        .firstOrNull;
  }

  Map<String, dynamic>? get task => model.preparations
      .where(
        (v) => v['id'] == (widget.taskId ?? meaning?['preparation']?['id']),
      )
      .firstOrNull;
  Map<String, dynamic>? get existingTarget => model.preparations
      .where(
        (v) =>
            v['target']['senseVersionId'] == meaning?['senseVersionId'] &&
            v['target']['bindingVersionId'] == meaning?['bindingVersionId'],
      )
      .firstOrNull;
  Map<String, dynamic> get policy =>
      selected ??
      task?['policy'] as Map<String, dynamic>? ??
      existingTarget?['policy'] as Map<String, dynamic>? ??
      model.snapshot!.policyState['defaultPolicy'] as Map<String, dynamic>? ??
      {'profileId': 'lightweight', 'profileVersion': 'v1'};
  Future<void> configure() async {
    await configureOnlineService(context, model);
    if (mounted) setState(() {});
  }

  Future<void> choose() async {
    final current = task;
    if (current == null) {
      await model.provisioningAction({
        'kind': 'add',
        'meaning_id': widget.meaningId,
        'expected_revision': meaning!['revision'],
        'policy': policy,
      });
    } else {
      await model.provisioningAction({
        'kind': 'set_policy',
        'task_id': current['id'],
        'expected_revision': current['revision'],
        'policy': policy,
      });
    }
    if (mounted && model.error == null) setState(() => selected = null);
  }

  Future<void> learn() async {
    await model.selectMaterial(task!['materialId'] as String);
    if (model.error != null || !mounted) return;
    await model.showHome();
    if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final current = task;
      final ready = current?['status'] == 'ready';
      final expired =
          current?['status'] == 'generating' &&
          (current?['leaseUntilMs'] as int? ?? 0) <=
              DateTime.now().millisecondsSinceEpoch;
      final canRetry =
          current != null &&
          !ready &&
          (current['attemptCount'] as int) < 3 &&
          current['reason'] != 'unsupported_content_policy';
      final expression =
          current?['target']['proposal']['expression']['surface'] ??
          meaning?['expression'] ??
          '';
      return Scaffold(
        appBar: AppBar(title: const Text('准备学习材料')),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: ListView(
                key: const ValueKey('preparation-scroll'),
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    expression as String,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text(
                    (current?['target']['proposal']['semanticSpec']['coreMeaningFocus'] ??
                            meaning?['sense'] ??
                            '')
                        as String,
                  ),
                  if (meaning != null && meaning!['status'] == 'confirmed')
                    AnchorUsePanel(model: model, meaning: meaning!),
                  if (current?['anchor'] != null)
                    Text('当前目标使用的已授权原文：${current!['anchor']['sentence']}'),
                  if (model.notice != null) Text(model.notice!),
                  const SizedBox(height: 16),
                  if (!ready) ...[
                    const Text('选择此目标的学习方式。准备服务只接收已确认的词义、表达和通用场景，不默认使用你的原始材料。'),
                    if (current == null && existingTarget != null)
                      const Text('这个语义目标已经加入学习。本次会关联已有目标，保留原学习方式和进度。'),
                    DropdownButtonFormField<String>(
                      key: ValueKey(
                        'preparation-policy-${current?['revision'] ?? 0}',
                      ),
                      initialValue: policy['profileId'] as String,
                      decoration: const InputDecoration(labelText: '学习方式'),
                      items: [
                        for (final choice in model.snapshot!.policyChoices)
                          DropdownMenuItem(
                            value: choice['policy']['profileId'] as String,
                            child: Text(choice['label'] as String),
                          ),
                      ],
                      onChanged:
                          model.busy ||
                              current?['policyCommitted'] == true ||
                              current == null && existingTarget != null
                          ? null
                          : (value) => setState(
                              () => selected = Map<String, dynamic>.from(
                                model.snapshot!.policyChoices.firstWhere(
                                      (c) => c['policy']['profileId'] == value,
                                    )['policy']
                                    as Map,
                              ),
                            ),
                    ),
                    const Text('当前在线供给支持轻量文本；其他方式保留原需求，缺少相应资源时会显示受阻。'),
                    if (current == null || selected != null)
                      FilledButton(
                        onPressed: model.busy ? null : choose,
                        child: Text(current == null ? '确认加入学习' : '应用新的学习方式'),
                      ),
                  ],
                  if (current != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      preparationLabel(current),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text('已使用 ${current['attemptCount']} / 3 次准备机会'),
                    if (current['status'] == 'generating') ...[
                      if (model.provisioningBusy)
                        const LinearProgressIndicator(),
                      Text(
                        expired
                            ? '上次请求已超时，可明确重试。'
                            : model.provisioningBusy
                            ? '正在生成并独立校验。可以离开此页，或取消准备。'
                            : '上次请求可能已中断。不会自动调用模型；可以等待有效期结束，或取消后重试。',
                      ),
                    ],
                    if (current['reason'] != null)
                      Text(switch (current['reason']) {
                        'unsupported_content_policy' =>
                          '在线供给不满足此学习方式的内容需求，请明确选择其他方式或等待匹配资源。',
                        'material_rejected' => '候选未通过独立校验，没有进入学习。',
                        'validation_unavailable' => '独立校验服务暂时不可用，材料没有进入学习。',
                        'generation_failed' => '生成失败，目标与词义已保存在本机。',
                        'cancelled' => '本次准备已取消。已发出的在线调用可能仍计入预算。',
                        'access_required' => '在线服务需要有效访问权限，请检查服务配置。',
                        _ => '准备未完成，可以检查服务或网络后明确重试。',
                      }),
                    if (ready)
                      FilledButton(
                        onPressed: model.busy ? null : learn,
                        child: const Text('回到学习入口'),
                      )
                    else ...[
                      OutlinedButton(
                        onPressed: model.busy || model.provisioningBusy
                            ? null
                            : () async {
                                await model.agents.load();
                                final active = model.agents.sessions
                                    .where(
                                      (s) =>
                                          current['status'] == 'generating' &&
                                          !expired &&
                                          s['kind'] == 'content' &&
                                          s['input']['id'] ==
                                              current['activeAttemptId'],
                                    )
                                    .firstOrNull;
                                if (!context.mounted) return;
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute<void>(
                                    builder: (_) => AgentScreen(
                                      controller: model.agents,
                                      id: active?['id'],
                                      source: {
                                        'kind': 'content',
                                        'task_id': current['id'],
                                        'revision': current['revision'],
                                      },
                                    ),
                                  ),
                                );
                                await model.load();
                              },
                        child: const Text('使用模型服务准备'),
                      ),
                      TextButton(
                        onPressed: model.provisioningBusy ? null : configure,
                        child: Text(
                          model.semanticService.configured
                              ? '更改在线服务'
                              : '配置在线服务',
                        ),
                      ),
                      if (canRetry)
                        FilledButton(
                          onPressed:
                              !model.busy &&
                                  !model.provisioningBusy &&
                                  model.semanticService.configured &&
                                  (current['status'] != 'generating' || expired)
                              ? () => model.prepareContent(
                                  current['id'] as String,
                                )
                              : null,
                          child: Text(
                            current['attemptCount'] == 0 ? '开始准备材料' : '明确重试准备',
                          ),
                        ),
                      if (current['status'] != 'cancelled')
                        OutlinedButton(
                          onPressed: model.busy
                              ? null
                              : () => model.provisioningAction({
                                  'kind': 'cancel',
                                  'task_id': current['id'],
                                  'expected_revision': current['revision'],
                                }),
                          child: const Text('取消准备'),
                        ),
                      if ((current['attemptCount'] as int) >= 3)
                        const Text('该任务的准备次数已用完；目标与尝试记录仍保留在本机。'),
                    ],
                    TextButton(
                      onPressed: model.busy ? null : model.load,
                      child: const Text('检查本地任务'),
                    ),
                  ],
                  if (model.error != null) ...[
                    Text(
                      model.error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                    TextButton(
                      onPressed: model.busy ? null : model.retry,
                      child: const Text('重试本地保存'),
                    ),
                    TextButton(
                      onPressed: model.busy ? null : model.load,
                      child: const Text('重新读取本地状态'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
