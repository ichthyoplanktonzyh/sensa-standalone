import 'dart:convert';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

/// Local source selection is explicit; this surface does not certify a publisher.
class ReferenceSourcePanel extends StatefulWidget {
  const ReferenceSourcePanel({
    super.key,
    required this.model,
    required this.task,
  });
  final LibraryViewModel model;
  final Map<String, dynamic> task;
  @override
  State<ReferenceSourcePanel> createState() => _ReferenceSourcePanelState();
}

class _ReferenceSourcePanelState extends State<ReferenceSourcePanel> {
  String? error;
  bool reading = false;
  Future<void> attach() async {
    setState(() {
      reading = true;
      error = null;
    });
    final task = widget.task;
    try {
      final raw = await widget.model.packReader.pick();
      if (raw == null || !mounted) return;
      if (raw.length > 32000) throw const FormatException();
      final source = Map<String, dynamic>.from(jsonDecode(raw));
      final preview = JsonEncoder.withIndent('  ').convert(source);
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('使用这份参考资料？'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '将它用于 ${task['target']['proposal']['expression']['surface']} 的当前词义。请确认来源、授权和例句适用；导入不代表平台认证。准备时这份摘录会发送给所选生成与复核服务。',
                ),
                SelectableText(preview),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              key: const ValueKey('reference-confirm'),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('确认资料适用'),
            ),
          ],
        ),
      );
      if (yes != true || !mounted) return;
      await widget.model.provisioningAction({
        'kind': 'set_reference',
        'task_id': task['id'],
        'expected_revision': task['revision'],
        'reference': {
          ...source,
          'senseVersionId': task['target']['senseVersionId'],
          'bindingVersionId': task['target']['bindingVersionId'],
        },
      });
    } catch (_) {
      if (mounted) setState(() => error = '无法读取参考资料，请选择有来源和摘要的 Sensa JSON 摘录。');
    } finally {
      if (mounted) setState(() => reading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.task['reference'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              r == null
                  ? '未附参考资料（不影响必需材料准备）'
                  : '参考资料：${r['attribution']} · ${r['edition']}',
            ),
            if (r != null) ...[
              Text(
                '来源：${r['sourceUrl']}\n授权：${r['license']}\n审核记录：${r['reviewer']}',
              ),
              for (final resource in r['resources'])
                Text(
                  resource['contentPayload'].values
                      .where((v) => v != null)
                      .join(' · '),
                ),
            ],
            const Text('替换或移除会重新准备后续材料，已开始的学习与历史保持原版本。'),
            OutlinedButton(
              key: const ValueKey('reference-import'),
              onPressed: reading || widget.model.busy ? null : attach,
              child: Text(r == null ? '导入参考资料' : '替换参考资料'),
            ),
            if (r != null)
              TextButton(
                key: const ValueKey('reference-remove'),
                onPressed: widget.model.busy
                    ? null
                    : () => widget.model.provisioningAction({
                        'kind': 'set_reference',
                        'task_id': widget.task['id'],
                        'expected_revision': widget.task['revision'],
                        'reference': null,
                      }),
                child: const Text('移除参考资料'),
              ),
            if (error != null) Text(error!),
          ],
        ),
      ),
    );
  }
}
