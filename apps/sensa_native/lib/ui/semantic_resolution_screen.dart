import 'dart:convert';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

class SemanticResolutionScreen extends StatefulWidget {
  const SemanticResolutionScreen({
    super.key,
    required this.model,
    required this.capture,
    this.intakeId,
  });
  final LibraryViewModel model;
  final Map<String, dynamic> capture;
  final String? intakeId;
  @override
  State<SemanticResolutionScreen> createState() =>
      _SemanticResolutionScreenState();
}

class _SemanticResolutionScreenState extends State<SemanticResolutionScreen> {
  final focus = TextEditingController();
  LibraryViewModel get model => widget.model;
  Map<String, dynamic>? get job {
    // A replacement retains the exact capture, including source time and occurrence.
    final candidates = model.lookups.where((v) {
      final s = v['request']['snapshot'];
      Object? ordered(Object? value) {
        if (value is Map) {
          final keys = value.keys.cast<String>().toList()..sort();
          return {for (final key in keys) key: ordered(value[key])};
        }
        if (value is List) return value.map(ordered).toList();
        return value;
      }

      return v['status'] != 'superseded' &&
          jsonEncode(ordered(s)) == jsonEncode(ordered(widget.capture)) &&
          v['intakeId'] == widget.intakeId;
    });
    return candidates.firstOrNull;
  }

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  Future<void> configure() async {
    final address = TextEditingController(text: model.semanticService.origin);
    final token = TextEditingController();
    String? error;
    await showDialog<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('在线解析服务'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('使用已配置模型的 Sensa 服务。地址和访问令牌仅用于本次应用会话；本地资料无需登录。'),
                TextField(
                  key: const ValueKey('semantic-origin'),
                  controller: address,
                  decoration: const InputDecoration(
                    labelText: '服务根地址（HTTPS 或本机回环）',
                  ),
                ),
                TextField(
                  key: const ValueKey('semantic-token'),
                  controller: token,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: const InputDecoration(
                    labelText: 'Sensa 访问令牌（不是模型 API Key）',
                  ),
                ),
                if (error != null) Text(error!),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () {
                try {
                  model.semanticService.configure(address.text, token.text);
                  Navigator.pop(context);
                } catch (_) {
                  setDialogState(() => error = '请填写有效的服务根地址和访问令牌。');
                }
              },
              child: const Text('使用此服务'),
            ),
          ],
        ),
      ),
    );
    // Dialog route disposal occurs after its exit animation.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    address.dispose();
    token.dispose();
    if (mounted) setState(() {});
  }

  Future<void> request({bool clarify = false}) async {
    final previous = job;
    await model.resolveSemantic(
      widget.capture,
      intakeId: widget.intakeId,
      previousId: previous?['id'] as String?,
      clarification: clarify ? focus.text.trim() : null,
    );
  }

  Future<void> accept() async {
    await model.semanticAction({
      'kind': 'accept',
      'id': job!['id'],
      'consent': 'accept_context_expression_sense',
    });
    if (mounted && model.error == null) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final current = job;
      final expired =
          current != null &&
          (current['expiresAtMs'] as int) <=
              DateTime.now().millisecondsSinceEpoch;
      final ready = current?['status'] == 'ready' && !expired;
      final accepted = current?['status'] == 'accepted';
      final available =
          !model.busy && !model.semanticBusy && model.error == null;
      final proposal = current?['proposal'] as Map<String, dynamic>?;
      final spec = proposal?['semanticSpec'] as Map<String, dynamic>?;
      return Scaffold(
        appBar: AppBar(title: const Text('理解这段表达')),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: ListView(
                key: const ValueKey('semantic-scroll'),
                padding: const EdgeInsets.all(20),
                children: [
                  SelectableText(widget.capture['sentence'] as String),
                  const SizedBox(height: 12),
                  Text(
                    '表达：${widget.capture['expression']['text']}',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Text('来源：${widget.capture['source']['title']}'),
                  const SizedBox(height: 16),
                  const Text('请求解释会将这段上下文、表达和你补充的关注点发送到在线模型服务。候选与确认记录保存在本机。'),
                  TextButton(
                    onPressed: model.semanticBusy ? null : configure,
                    child: Text(
                      model.semanticService.configured ? '更改在线服务' : '配置在线服务',
                    ),
                  ),
                  if (model.semanticBusy) ...[
                    const LinearProgressIndicator(),
                    const Text('正在解释，可以返回；任务已保存在本机。'),
                  ] else if (current?['status'] == 'running')
                    const Text('上次请求已中断。可明确重新请求，可能再次使用模型服务。'),
                  if (expired) const Text('候选已过期，请重新解释后再确认。'),
                  if (current?['status'] == 'failed')
                    Text(switch (current?['reason']) {
                      'access_required' => '在线服务需要有效的访问权限，请检查服务配置。',
                      'lookup_timeout' => '解释超时。输入已保留，可以稍后重新请求。',
                      'invalid_response' => '服务结果未通过校验，未保存为词义。',
                      _ => '暂时无法取得解释。输入已保留，可以恢复网络后重试。',
                    }),
                  if (current?['status'] == 'unresolved')
                    const Text('目前的上下文还不足以确定词义。可以补充关注点后重新解释。'),
                  if (current?['focus'] != null)
                    Text('关注点：${current!['focus']['text']}'),
                  if (proposal != null) ...[
                    const SizedBox(height: 16),
                    Text(proposal['explanation'] as String),
                    const SizedBox(height: 12),
                    Text(
                      spec!['coreMeaningFocus'] as String,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    for (final scene in spec['prototypeScenes'] as List)
                      Text('典型场景：${scene['summary']}'),
                    for (final value in spec['includedCases'] as List)
                      Text('涵盖：$value'),
                    for (final value in spec['excludedCases'] as List)
                      Text('不涵盖：$value'),
                    for (final value in spec['neighborContrasts'] as List)
                      Text('${value['label']}：${value['distinction']}'),
                    Text(
                      '解析来源：${current!['provenance']['provider']} / ${current['provenance']['model']}',
                    ),
                  ],
                  if (accepted)
                    const Text('这条词义已确认保存在本机。')
                  else ...[
                    if (ready)
                      FilledButton(
                        onPressed: available ? accept : null,
                        child: const Text('确认词义并保存到本机'),
                      ),
                    const Text('确认只建立上下文、表达与词义的连接；学习材料需另行准备。'),
                    if (current != null)
                      TextField(
                        key: const ValueKey('semantic-focus'),
                        controller: focus,
                        maxLength: 2000,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          labelText: '补充关注点（可选）',
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    if (current != null && focus.text.trim().isNotEmpty)
                      OutlinedButton(
                        onPressed: available && model.semanticService.configured
                            ? () => request(clarify: true)
                            : null,
                        child: const Text('按关注点重新解释'),
                      ),
                    OutlinedButton(
                      onPressed: available && model.semanticService.configured
                          ? request
                          : null,
                      child: Text(current == null ? '请求解释' : '重新请求解释'),
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
