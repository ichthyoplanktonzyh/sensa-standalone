import 'optional_resources_view.dart';
import 'curriculum_screen.dart';
import 'practice_screen.dart';
import 'pronunciation_view.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';
import 'assurance_view.dart';
import 'learning_activity_view.dart';
import 'personal_world_screen.dart';

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

  Future<void> choosePolicy(String scope) async {
    final snapshot = widget.model.snapshot;
    if (snapshot == null) return;
    final selected = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * 0.7,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        scope == 'target'
                            ? '选择此项学习方式'
                            : scope == 'curriculum'
                            ? '设置学习包默认方式'
                            : '设置默认学习方式',
                      ),
                    ),
                    IconButton(
                      tooltip: '关闭',
                      onPressed: () => Navigator.pop(sheetContext),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: Text('首次开始学习后，此项方式固定。更改默认设置只影响尚未固定的项目。'),
              ),
              Expanded(
                child: ListView(
                  children: [
                    for (final choice in snapshot.policyChoices)
                      ListTile(
                        title: Text(choice['label'] as String),
                        subtitle: Text(
                          choice['executable'] == true
                              ? '当前设备可使用'
                              : '当前设备尚未支持，选择后会保留为待准备项目',
                        ),
                        onTap: () => Navigator.pop(sheetContext, choice),
                      ),
                    ListTile(
                      title: Text(scope == 'learner' ? '恢复系统默认' : '使用继承设置'),
                      onTap: () =>
                          Navigator.pop(sheetContext, {'inherit': true}),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (selected != null && mounted) {
      await widget.model.setPolicy(
        scope,
        selected['policy'] as Map<String, dynamic>?,
      );
    }
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
      } else if (s.activity != null &&
          !vm.home &&
          (s.activity!['status'] != 'active' ||
              s.activity!['canAnswer'] != true)) {
        body = [LearningActivityView(model: vm)];
      } else if (s.assurance != null && !vm.home) {
        final a = s.assurance!;
        final action = a['queue']?['session']?['action'];
        body = [
          AssuranceView(
            key: ValueKey(
              '${a['id']}:${action?['ordinal']}:${action?['actionKey']}',
            ),
            model: vm,
          ),
        ];
      } else if (s.nextEligibleAtMs != null &&
          (s.phase == 'waiting' || s.phase == 'completed') &&
          !vm.home) {
        final eligible = DateTime.fromMillisecondsSinceEpoch(
          s.nextEligibleAtMs!,
        ).toLocal();
        body = [
          Text('稍后再回想', style: t.headlineLarge),
          const Text('遗忘记录已保存。再学习会帮助恢复连接，不会改写刚才的复习评分。'),
          Text(
            '可继续时间：${eligible.hour.toString().padLeft(2, '0')}:${eligible.minute.toString().padLeft(2, '0')}',
          ),
          button(
            '到时继续',
            () => vm.act({'kind': 'start_retention', 'early': false}),
          ),
          button(
            '提前回想',
            () => vm.act({'kind': 'start_retention', 'early': true}),
            primary: false,
          ),
          button('先学习其他内容', vm.showHome, primary: false),
          button('结束本次', vm.showHome, primary: false),
        ];
      } else if (s.phase == 'completed' && !vm.home) {
        final due = DateTime.fromMillisecondsSinceEpoch(s.dueAtMs!).toLocal();
        body = [
          const Icon(
            Icons.check_circle_outline_rounded,
            size: 48,
            color: Color(0xff147663),
          ),
          Text(
            s.protocol == 'consumer-initial-v1'
                ? '本次首学已完成'
                : s.protocol == 'consumer-review-v1'
                ? '本次复习已完成'
                : '本次再学习已完成',
            style: t.headlineLarge,
          ),
          Text(s.material!['expression'] as String, style: t.headlineSmall),
          Text(
            s.protocol == 'consumer-relearning-v1'
                ? '连接已恢复，原复习评分与复习时间保持不变。'
                : '学习记录和复习时间已保存到本机。完成学习不代表已经掌握。',
          ),
          Text('下次复习：${due.year}/${due.month}/${due.day}', style: t.bodyLarge),

          if (s.protocol != 'consumer-initial-v1')
            button('继续复习其他内容', () => vm.act({'kind': 'next_retention'})),
          button('回到首页', vm.showHome),
        ];
      } else if (s.run != null &&
          s.phase != 'completed' &&
          !s.paused &&
          !vm.home) {
        final recall = s.phase == 'recall';
        body = [
          Text(
            s.protocol == 'consumer-review-v1'
                ? '到期复习'
                : s.protocol == 'consumer-relearning-v1'
                ? '再次学习'
                : '首次学习',
            style: t.labelLarge,
          ),
          Text(recall ? '回想这个情境' : '连接这个表达', style: t.headlineSmall),
          Text(s.material!['scene'] as String, style: t.bodyLarge),
          if (recall) ...[
            Text(s.material!['sense'] as String, style: t.bodyMedium),
            OptionalResourcesView(material: s.material!, revealed: false),
            const Text('先在心里试着表达，再揭示答案。'),
            button('揭示表达', () => vm.answer('reveal')),
          ] else ...[
            Text(s.material!['expression'] as String, style: t.headlineLarge),
            PronunciationView(
              key: ValueKey(
                'pronunciation-${s.run!["id"]}-${s.material!["id"]}',
              ),
              model: vm,
              material: s.material!,
            ),
            Text(s.material!['sense'] as String, style: t.bodyLarge),
            OptionalResourcesView(material: s.material!, revealed: true),
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
            onPressed: available
                ? () => (s.activity?['status']) == 'active'
                      ? vm.stopActivity()
                      : vm.act({'kind': 'pause'})
                : null,
            child: const Text('暂停学习'),
          ),
        ];
      } else {
        body = [
          Text('我的本地学习库', style: t.headlineLarge),
          Text('每日新学 ${s.quantity} 个 · 无需登录'),
          Text(
            '累计复习 ${s.retention['reviewCount'] ?? 0} 次 · 再学习完成 ${s.retention['relearningCount'] ?? 0} 次 · 待恢复 ${s.retention['pendingCount'] ?? 0} 项',
          ),
          Text('默认方式：${s.defaultPolicyLabel}'),
          button('默认学习方式', () => choosePolicy('learner'), primary: false),
          LearningActivityView(model: vm, overview: true),
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
            if (s.policyPlan != null) ...[
              Text('学习方式：${s.selectedPolicyLabel}'),
              Text('来源：${s.policySourceLabel}'),
              if (s.policyCommitted)
                const Text('此项方式已固定，默认设置的变化不会改写已有学习。')
              else
                button('更换此项方式', () => choosePolicy('target'), primary: false),
              if (s.policyState['sourceKey'] != null)
                button(
                  '学习包默认方式',
                  () => choosePolicy('curriculum'),
                  primary: false,
                ),
            ],
            if (!s.enrolled)
              button('加入学习', () => vm.act({'kind': 'add_to_learning'}))
            else if (!s.inStudyScope) ...[
              const Text('此项不在当前学习来源中，已有进度与历史仍保留。'),
              button(
                '调整学习来源',
                () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CurriculumScreen(model: vm),
                  ),
                ),
                primary: false,
              ),
            ] else if (s.run == null &&
                s.initialReadiness?['status'] != 'ready') ...[
              Text(s.initialReadiness?['label'] as String? ?? '学习材料正在准备'),
              Text(s.initialReadiness?['detail'] as String? ?? ''),
              button(
                '刷新准备状态',
                () => vm.act({'kind': 'refresh_plans'}),
                primary: false,
              ),
            ] else if (s.nextEligibleAtMs != null &&
                (s.phase == 'completed' || s.phase == 'waiting')) ...[
              const Text('这项内容还需要再回想，等待进度已保存在本机。'),
              button(
                '继续再学习',
                () => vm.act({'kind': 'start_retention', 'early': false}),
              ),
              button(
                '提前回想',
                () => vm.act({'kind': 'start_retention', 'early': true}),
                primary: false,
              ),
            ] else if (s.phase != 'completed')
              button(
                s.run == null ? '开始学习' : '继续学习',
                () => vm.act({'kind': 'start_or_resume'}),
              )
            else ...[
              Text(
                '复习日期：${DateTime.fromMillisecondsSinceEpoch(s.dueAtMs!).toLocal().toString().substring(0, 16)}',
              ),
              button(
                '开始到期复习',
                () => vm.act({'kind': 'start_retention', 'early': false}),
              ),
            ],
          ],
        ];
      }
      if (s?.activity?['status'] == 'active' &&
          s?.activity?['canAnswer'] == true &&
          !vm.home) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && (ModalRoute.of(context)?.isCurrent ?? false)) {
            vm.enteredActivity();
          }
        });
        body.add(
          OutlinedButton(
            onPressed: available ? () => vm.stopActivity() : null,
            child: const Text('暂停本次学习并返回'),
          ),
        );
      }
      if (vm.checkInPending && !vm.busy) {
        body.addAll([
          Semantics(liveRegion: true, child: const Text('签到尚未保存，学习可以继续。')),
          TextButton(onPressed: () => vm.checkIn(), child: const Text('重试签到')),
        ]);
      }
      return Scaffold(
        appBar: AppBar(
          title: const Text('Sensa'),
          actions: [
            IconButton(
              tooltip: '自由练习',
              icon: const Icon(Icons.headphones),
              onPressed: vm.busy || s == null
                  ? null
                  : () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => PracticeScreen(library: vm),
                      ),
                    ),
            ),
            IconButton(
              tooltip: '学习来源',
              icon: const Icon(Icons.library_books_outlined),
              onPressed: vm.busy || s == null
                  ? null
                  : () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CurriculumScreen(model: vm),
                      ),
                    ),
            ),
            IconButton(
              tooltip: '我的词义世界',
              icon: const Icon(Icons.hub_outlined),
              onPressed: vm.busy || s == null
                  ? null
                  : () => Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) => PersonalWorldScreen(model: vm),
                      ),
                    ),
            ),
            const Padding(padding: EdgeInsets.all(16), child: Text('本地验收版')),
          ],
        ),
        bottomNavigationBar: vm.error == null
            ? null
            : SafeArea(
                child: Material(
                  color: Theme.of(context).colorScheme.errorContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
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
                    ),
                  ),
                ),
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
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
