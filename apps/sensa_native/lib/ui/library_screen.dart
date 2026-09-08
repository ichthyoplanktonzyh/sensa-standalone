import 'package:flutter/material.dart';
import 'library_view_model.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  int quantity = 5;
  Future<void> chooseMaterial() async {
    final snapshot = widget.model.snapshot;
    if (snapshot == null) return;
    final id = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * 0.65,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const Expanded(child: Text('选择学习内容')),
                    IconButton(
                      tooltip: '关闭',
                      onPressed: () => Navigator.pop(sheetContext),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: snapshot.catalog.length,
                  itemBuilder: (context, index) {
                    final entry = snapshot.catalog[index];
                    final item = entry['material'] as Map<String, dynamic>;
                    return ListTile(
                      title: Text(item['expression'] as String),
                      subtitle: Text(
                        entry['completed'] == true
                            ? '首学已完成'
                            : entry['enrolled'] == true
                            ? '已加入学习'
                            : '尚未加入学习',
                      ),
                      selected: item['id'] == snapshot.material?['id'],
                      onTap: () =>
                          Navigator.pop(sheetContext, item['id'] as String),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (id != null && mounted) await widget.model.selectMaterial(id);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.model,
    builder: (context, _) {
      final vm = widget.model;
      final s = vm.snapshot;
      final t = Theme.of(context).textTheme;
      final available = !vm.busy && vm.error == null;
      Widget button(String label, VoidCallback action, {bool primary = true}) =>
          primary
          ? FilledButton(
              onPressed: available ? action : null,
              child: Text(label),
            )
          : OutlinedButton(
              onPressed: available ? action : null,
              child: Text(label),
            );
      List<Widget> body;
      if (s == null) {
        body = [Text('正在打开本地学习库', style: t.headlineSmall)];
      } else if (s.quantity == null) {
        body = [
          Text('从自己的节奏开始', style: t.headlineLarge),
          const Text('每天想学习多少个新的意义连接？'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [5, 10, 15, 20, 30]
                .map(
                  (n) => ChoiceChip(
                    label: Text('$n'),
                    selected: quantity == n,
                    onSelected: available
                        ? (_) => setState(() => quantity = n)
                        : null,
                  ),
                )
                .toList(),
          ),
          button(
            '确认每日数量',
            () => vm.act({'kind': 'confirm_quantity', 'quantity': quantity}),
          ),
        ];
      } else if (s.phase == 'completed' && !vm.home) {
        final due = DateTime.fromMillisecondsSinceEpoch(s.dueAtMs!).toLocal();
        body = [
          const Icon(
            Icons.check_circle_outline_rounded,
            size: 48,
            color: Color(0xff147663),
          ),
          Text('本次首学已完成', style: t.headlineLarge),
          Text(s.material!['expression'] as String, style: t.headlineSmall),
          const Text('学习记录和复习时间已保存到本机。完成首学不代表已经掌握。'),
          Text('下次复习：${due.year}/${due.month}/${due.day}', style: t.bodyLarge),
          const Text('此验收版先验证首学与恢复，复习交互将在后续接入。'),
          button('回到首页', vm.showHome),
        ];
      } else if (s.run != null &&
          s.phase != 'completed' &&
          !s.paused &&
          !vm.home) {
        final recall = s.phase == 'recall';
        body = [
          Text(recall ? '回想这个情境' : '连接这个表达', style: t.headlineSmall),
          Text(s.material!['scene'] as String, style: t.bodyLarge),
          if (recall) ...[
            Text(s.material!['sense'] as String, style: t.bodyMedium),
            const Text('先在心里试着表达，再揭示答案。'),
            button('揭示表达', () => vm.answer('reveal')),
          ] else ...[
            Text(s.material!['expression'] as String, style: t.headlineLarge),
            Text(s.material!['sense'] as String, style: t.bodyLarge),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                button('再回想', () => vm.answer('again'), primary: false),
                button('有些费力', () => vm.answer('hard'), primary: false),
                button('可以继续', () => vm.answer('good')),
              ],
            ),
          ],
          TextButton(
            onPressed: available ? () => vm.act({'kind': 'pause'}) : null,
            child: const Text('暂停学习'),
          ),
        ];
      } else {
        body = [
          Text('我的本地学习库', style: t.headlineLarge),
          Text('每日新学 ${s.quantity} 个 · 无需登录'),
          button('导入学习包', vm.importPack, primary: false),
          if (vm.notice != null)
            Semantics(liveRegion: true, child: Text(vm.notice!)),
          if (s.catalog.isNotEmpty) ...[
            Text('已下载的内容', style: t.headlineSmall),
            Text('${s.catalog.length} 项内容已保存在本机'),
            button('选择其他内容', chooseMaterial, primary: false),
            const Divider(),
          ],
          if (s.material == null) ...[
            const Text('先载入一份合成验收材料，验证本机保存与学习。'),
            button(
              '载入验收材料',
              () => vm.act({'kind': 'import_acceptance_material'}),
            ),
          ] else ...[
            Text(s.material!['expression'] as String, style: t.headlineSmall),
            Text(s.material!['sense'] as String, style: t.bodyLarge),
            Text(s.material!['source'] as String),
            if (!s.enrolled)
              button('加入学习', () => vm.act({'kind': 'add_to_learning'}))
            else if (s.phase != 'completed')
              button(
                s.run == null ? '开始学习' : '继续学习',
                () => vm.act({'kind': 'start_or_resume'}),
              )
            else
              const Text('首学已完成，复习时间已保存在本机。'),
          ],
        ];
      }
      return Scaffold(
        appBar: AppBar(
          title: const Text('Sensa'),
          actions: const [
            Padding(padding: EdgeInsets.all(16), child: Text('本地验收版')),
          ],
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 600),
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Row(
                    children: [
                      const Icon(Icons.offline_pin_outlined, size: 18),
                      const SizedBox(width: 8),
                      Text(vm.busy ? '正在保存到本机…' : '本地学习 · 云同步未接入'),
                    ],
                  ),
                  const SizedBox(height: 32),
                  Material(
                    color: const Color(0xfffffefd),
                    borderRadius: BorderRadius.circular(24),
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: body
                            .expand((w) => [w, const SizedBox(height: 24)])
                            .toList(),
                      ),
                    ),
                  ),
                  if (vm.error != null) ...[
                    const SizedBox(height: 24),
                    Semantics(liveRegion: true, child: Text(vm.error!)),
                    Wrap(
                      spacing: 8,
                      children: [
                        TextButton(
                          onPressed: vm.busy ? null : vm.retry,
                          child: const Text('重试本次操作'),
                        ),
                        TextButton(
                          onPressed: vm.busy ? null : vm.load,
                          child: const Text('重新读取'),
                        ),
                      ],
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
