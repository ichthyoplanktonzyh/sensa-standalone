import 'package:flutter/material.dart';
import 'library_view_model.dart';
import 'online_service_dialog.dart';
import 'world_screen.dart';
import '../data/world_repository.dart';

class AnchorUsePanel extends StatelessWidget {
  const AnchorUsePanel({super.key, required this.model, required this.meaning});
  final LibraryViewModel model;
  final Map<String, dynamic> meaning;
  Future<void> enable(BuildContext context) async {
    if (!model.contentServiceConfigured) {
      await configureOnlineService(context, model);
      if (!context.mounted || !model.contentServiceConfigured) return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('允许使用这段原文？'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (meaning['worldContext'] != null)
                for (final block in meaning['worldContext']['draft']['blocks'])
                  if (block['kind'] == 'text')
                    SelectableText(block['text'] as String)
                  else if (block['kind'] == 'image')
                    WorldImage(
                      repository: WorldRepository(model.repository),
                      digest: block['digest'],
                    )
                  else
                    SelectableText(meaning['snapshot']['sentence'] as String),
              const SizedBox(height: 12),
              Text('接收服务：${model.contentServiceOrigin}'),
              const Text(
                '用于所选模型服务的学习材料生成与独立复核。仅发送上述固定文字、图片和已确认词义、表达，不发送来源网址、标题或关注点。图片要求生成与复核服务都支持视觉。原文中的真实人物和事件可保留在私人提示中。',
              ),
              const Text('撤销后本机拒绝旧结果，并准备后续通用材料；已发送的内容无法收回，已经开始的学习与历史仍保留。'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('暂不授权'),
          ),
          FilledButton(
            key: const ValueKey('anchor-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('授权这段原文'),
          ),
        ],
      ),
    );
    if (confirmed == true) await model.setAnchorUse(meaning, true);
  }

  @override
  Widget build(BuildContext context) {
    final grant = meaning['anchorGrant'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              grant == null ? '原文未授权给材料服务' : '原文已授权给材料服务',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            if (grant != null) Text('接收服务：${grant['recipient']}'),
            const Text('此设置影响同一学习目标的后续材料；语义世界中的原始经历和已发生学习不会被覆盖。'),
            OutlinedButton(
              key: const ValueKey('anchor-toggle'),
              onPressed: model.busy
                  ? null
                  : () async {
                      if (grant == null) {
                        await enable(context);
                      } else {
                        await model.setAnchorUse(meaning, false);
                      }
                    },
              child: Text(grant == null ? '允许使用原文' : '撤销原文授权'),
            ),
          ],
        ),
      ),
    );
  }
}
