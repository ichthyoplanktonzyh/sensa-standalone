import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'agent_screen.dart';
import 'curriculum_screen.dart';
import 'history_screen.dart';
import 'intake_connection_screen.dart';
import 'learning_activity_view.dart';
import 'library_screen.dart';
import 'library_view_model.dart';
import 'personal_world_screen.dart';
import 'practice_screen.dart';
import 'preparation_screen.dart';
import 'product_theme.dart';
import 'world_screen.dart';

class NativeShell extends StatefulWidget {
  const NativeShell({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<NativeShell> createState() => _NativeShellState();
}

class _NativeShellState extends State<NativeShell> with WidgetsBindingObserver {
  int selected = 0;
  final search = TextEditingController();
  int quantity = 5;
  bool opening = false;
  LibraryViewModel get model => widget.model;
  static const labels = ['首页', '我的内容', '学习', '练习', '设置'];
  static const icons = [
    Icons.home_outlined,
    Icons.book_outlined,
    Icons.layers_outlined,
    Icons.explore_outlined,
    Icons.tune,
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    search.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        !model.busy &&
        (ModalRoute.of(context)?.isCurrent ?? false)) {
      model.load();
    }
  }

  Future<void> open(Widget page) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (routeContext) => CallbackShortcuts(
          bindings: {
            const SingleActivator(LogicalKeyboardKey.escape): () =>
                Navigator.of(routeContext).maybePop(),
          },
          child: page,
        ),
      ),
    );
    if (mounted && !model.busy) await model.load();
  }

  Future<void> study([String mode = 'mixed']) async {
    if (opening || model.busy || model.error != null) return;
    setState(() => opening = true);
    await model.startActivity(mode);
    if (mounted && model.error == null) {
      await open(
        LibraryScreen(
          model: model,
          onHome: () {
            setState(() => selected = 0);
            Navigator.of(context).popUntil((r) => r.isFirst);
          },
        ),
      );
    }
    if (mounted) setState(() => opening = false);
  }

  Future<void> material(String id) async {
    if (model.busy) return;
    await model.selectMaterial(id);
    if (mounted && model.error == null) {
      await open(
        LibraryScreen(
          model: model,
          onHome: () {
            setState(() => selected = 0);
            Navigator.of(context).popUntil((r) => r.isFirst);
          },
        ),
      );
    }
  }

  Widget link(
    String title,
    String detail,
    IconData icon,
    VoidCallback action,
  ) => ListTile(
    leading: Icon(icon),
    title: Text(title),
    subtitle: Text(detail),
    trailing: const Icon(Icons.chevron_right),
    onTap: model.busy ? null : action,
  );

  Widget feedback() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (model.busy)
        const LinearProgressIndicator(
          minHeight: 2,
          semanticsLabel: '正在读取或保存本机资料',
        ),
      if (model.error != null)
        Material(
          color: Theme.of(context).colorScheme.errorContainer,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(liveRegion: true, child: Text(model.error!)),
                Wrap(
                  spacing: 8,
                  children: [
                    TextButton(
                      onPressed: model.busy ? null : model.retry,
                      child: const Text('重试本次操作'),
                    ),
                    TextButton(
                      onPressed: model.busy ? null : model.load,
                      child: const Text('重新读取'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      if (model.notice != null && model.error == null)
        Padding(
          padding: const EdgeInsets.all(12),
          child: Semantics(liveRegion: true, child: Text(model.notice!)),
        ),
    ],
  );

  Widget welcome() => ProductPage(
    title: '从自己的节奏开始',
    subtitle: '资料和学习记录保存在本机，无需登录就能开始。',
    children: [
      ProductPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '每天学习多少个新的意义连接？',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [5, 10, 15, 20, 30]
                  .map(
                    (n) => ChoiceChip(
                      label: Text('$n'),
                      selected: quantity == n,
                      onSelected: model.busy
                          ? null
                          : (_) => setState(() => quantity = n),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: model.busy
                  ? null
                  : () => model.act({
                      'kind': 'confirm_quantity',
                      'quantity': quantity,
                    }),
              child: const Text('确认每日数量'),
            ),
            const SizedBox(height: 12),
            const Text('之后可以在设置中调整。复习按已有学习安排，不占用新学数量。'),
          ],
        ),
      ),
    ],
  );

  Widget home() {
    final s = model.snapshot!;
    final counts = s.learning['counts'] as Map? ?? {};
    final due = counts['dueReviews'] as int? ?? 0;
    final resumable = s.activity != null && s.activity!['status'] != 'ended';
    final fresh = counts['newAvailable'] ?? 0;
    final hasWork = (counts['distinctExecutableTargets'] as int? ?? 0) > 0;
    return ProductPage(
      title: '今天，连接新的意义',
      subtitle: '${s.learning['date'] ?? ''} · 本地学习',
      children: [
        ProductPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('今天的学习', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 28),
              Wrap(
                spacing: 48,
                runSpacing: 20,
                children: [
                  _Count(label: '可新学', value: '$fresh'),
                  _Count(label: '到期复习', value: '$due'),
                  _Count(
                    label: '待继续',
                    value: '${counts['initialContinuations'] ?? 0}',
                  ),
                ],
              ),
              const SizedBox(height: 28),
              Text(
                resumable
                    ? '上次的学习进度已保存在本机，可以继续。'
                    : s.catalog.isEmpty
                    ? '从已有内容开始，或记录一个你想表达的情境。'
                    : '从新学和复习中安排今天的学习，按自己的节奏继续。',
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                key: const ValueKey('home-start'),
                onPressed: model.busy || opening
                    ? null
                    : () => !hasWork && !resumable
                          ? setState(() => selected = 2)
                          : study(
                              resumable
                                  ? s.activity!['mode'] as String
                                  : 'mixed',
                            ),
                icon: const Icon(Icons.arrow_forward),
                label: Text(
                  resumable
                      ? '继续今天的学习'
                      : !hasWork
                      ? '添加学习内容'
                      : '开始今天的学习',
                ),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: model.busy || due == 0
                    ? null
                    : () => study('review_only'),
                icon: const Icon(Icons.replay),
                label: Text(due == 0 ? '暂无到期复习' : '只复习'),
              ),
            ],
          ),
        ),
        link(
          '浏览学习内容',
          '导入学习包，选择想学习的表达。',
          Icons.library_books_outlined,
          () => setState(() => selected = 2),
        ),
        const Divider(),
        link(
          '记录自己的情境',
          '保存上下文，在需要时与语言老师一起澄清。',
          Icons.chat_bubble_outline,
          () => open(PersonalWorldScreen(model: model)),
        ),
      ],
    );
  }

  Widget content() => ProductPage(
    title: '我的内容',
    subtitle: '从眼前的情境，建立自己的语义世界。保存和加入学习是两个独立步骤。',
    children: [
      ProductPanel(
        child: Column(
          children: [
            link(
              '我的词义世界',
              '已确认的意思、收件箱与移除的材料。',
              Icons.book_outlined,
              () => open(PersonalWorldScreen(model: model)),
            ),
            const Divider(),
            link(
              '图文与语义关系',
              '继续草稿，探索同一情境中的表达连接。',
              Icons.hub_outlined,
              () => open(WorldScreen(library: model)),
            ),
          ],
        ),
      ),
      link(
        '学习准备',
        '查看材料生成、审核结果与可恢复的任务。',
        Icons.auto_stories_outlined,
        () => open(PreparationListScreen(model: model)),
      ),
      link(
        '采集接入',
        '接收浏览器和本地 Agent 保存的上下文。',
        Icons.input,
        () => open(IntakeConnectionScreen(model: model)),
      ),
    ],
  );

  Widget learning() {
    final s = model.snapshot!;
    final entries = s.catalog
        .where(
          (e) => '${e['material']['expression']} ${e['material']['sense']}'
              .toLowerCase()
              .contains(search.text.toLowerCase()),
        )
        .toList();
    return ProductPage(
      title: '我的学习',
      subtitle: '内容决定学什么，学习方式决定怎样建立并保持连接。',
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            FilledButton.icon(
              onPressed: model.busy ? null : model.importPack,
              icon: const Icon(Icons.download_outlined),
              label: const Text('导入学习包'),
            ),
            OutlinedButton(
              onPressed: model.busy
                  ? null
                  : () => open(CurriculumScreen(model: model)),
              child: const Text('学习来源'),
            ),
            OutlinedButton(
              onPressed: () => open(HistoryScreen(model: model)),
              child: const Text('全部学习记录'),
            ),
          ],
        ),
        TextField(
          key: const ValueKey('library-search'),
          controller: search,
          decoration: const InputDecoration(
            labelText: '搜索表达或词义',
            prefixIcon: Icon(Icons.search),
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (s.catalog.isEmpty)
          const ProductPanel(child: Text('还没有下载的学习内容。导入学习包，或将语义世界中的意思明确加入学习。'))
        else if (entries.isEmpty)
          const Text('没有找到匹配的内容，试试其他表达。')
        else
          ...entries.map(
            (e) => ProductPanel(
              child: ListTile(
                key: ValueKey('material-${e['material']['id']}'),
                contentPadding: EdgeInsets.zero,
                title: Text(
                  e['material']['expression'],
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                subtitle: Text(
                  '${e['material']['sense']}\n${e['completed'] == true
                      ? '首学已完成'
                      : e['enrolled'] == true
                      ? '已加入学习'
                      : '尚未加入学习'}',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: model.busy ? null : () => material(e['material']['id']),
              ),
            ),
          ),
        const Divider(),
        LearningActivityView(model: model, overview: true, onStart: study),
      ],
    );
  }

  Future<void> changeQuantity() async {
    var next = model.snapshot!.quantity!;
    final value = await showDialog<int>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('每日新学数量'),
          content: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [5, 10, 15, 20, 30]
                .map(
                  (n) => ChoiceChip(
                    label: Text('$n'),
                    selected: next == n,
                    onSelected: (_) => set(() => next = n),
                  ),
                )
                .toList(),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, next),
              child: const Text('保存数量'),
            ),
          ],
        ),
      ),
    );
    if (value != null) {
      await model.act({'kind': 'confirm_quantity', 'quantity': value});
    }
  }

  Widget settings() => ProductPage(
    title: '设置',
    subtitle: '本地使用无需账号。在线服务由你选择，在需要时连接。',
    children: [
      ProductPanel(
        child: Column(
          children: [
            link(
              '每日新学数量',
              '${model.snapshot!.quantity} 个新的意义连接',
              Icons.today_outlined,
              changeQuantity,
            ),
            const Divider(),
            link(
              '默认学习方式',
              model.snapshot!.defaultPolicyLabel,
              Icons.tune,
              () => showLearningPolicy(context, model, 'learner'),
            ),
          ],
        ),
      ),
      ProductPanel(
        child: Column(
          children: [
            link(
              '模型服务',
              '设置自己的模型和 Key，或连接可选的 Sensa 在线服务。',
              Icons.cloud_outlined,
              () => open(AgentSettingsScreen(controller: model.agents)),
            ),
            const Divider(),
            link(
              '采集接入',
              '浏览器、本地 Agent 与文件导入。',
              Icons.input,
              () => open(IntakeConnectionScreen(model: model)),
            ),
          ],
        ),
      ),
      const Text('资料和学习记录保存在这台设备。跨设备同步尚未提供。'),
      ExpansionTile(
        key: const PageStorageKey('native_shell-detail-1'),
        title: const Text('本机资料库'),
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: SelectableText(model.repository.path),
          ),
        ],
      ),
    ],
  );

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) {
      final s = model.snapshot;
      final ready = s != null && s.quantity != null;
      final pages = [
        home,
        content,
        learning,
        () => PracticeScreen(
          library: model,
          onExit: () => setState(() => selected = 0),
        ),
        settings,
      ];
      Widget page = s == null
          ? const Center(child: Text('正在打开本地学习库…'))
          : !ready
          ? welcome()
          : pages[selected]();
      return LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 1000;
          return PopScope(
            canPop: selected == 0 || selected == 3,
            onPopInvokedWithResult: (didPop, _) {
              if (!didPop && selected != 3) setState(() => selected = 0);
            },
            child: Scaffold(
              appBar: wide
                  ? null
                  : AppBar(
                      title: const Text('sensa'),
                      actions: [
                        IconButton(
                          tooltip: '设置',
                          onPressed: ready
                              ? () => setState(() => selected = 4)
                              : null,
                          icon: const Icon(Icons.tune),
                        ),
                      ],
                    ),
              bottomNavigationBar: wide || !ready
                  ? null
                  : SafeArea(
                      child: Material(
                        color: const Color(0xfffbfbfa),
                        child: Row(
                          children: [
                            for (var i = 0; i < 4; i++)
                              Expanded(
                                child: Semantics(
                                  selected: selected == i,
                                  button: true,
                                  child: InkWell(
                                    key: ValueKey('nav-$i'),
                                    onTap: () => setState(() => selected = i),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 16,
                                      ),
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Icon(
                                            icons[i],
                                            color: selected == i
                                                ? const Color(0xff303e73)
                                                : const Color(0xff6d7380),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            labels[i],
                                            style: const TextStyle(
                                              fontSize: 12,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
              body: SafeArea(
                child: Row(
                  children: [
                    if (wide)
                      Container(
                        width: 224,

                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Padding(
                              padding: EdgeInsets.symmetric(
                                vertical: 24,
                                horizontal: 16,
                              ),
                              child: Text(
                                'sensa',
                                style: TextStyle(
                                  fontSize: 28,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(height: 24),
                            for (var i = 0; i < 4; i++)
                              ListTile(
                                key: ValueKey('nav-$i'),
                                leading: Icon(icons[i]),
                                title: Text(labels[i]),
                                selected: selected == i,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                selectedTileColor: const Color(0xffe6e9f2),
                                onTap: ready
                                    ? () => setState(() => selected = i)
                                    : null,
                              ),
                            const Spacer(),
                            const Divider(),
                            ListTile(
                              key: const ValueKey('nav-4'),
                              leading: const Icon(Icons.tune),
                              title: const Text('设置'),
                              selected: selected == 4,
                              onTap: ready
                                  ? () => setState(() => selected = 4)
                                  : null,
                            ),
                          ],
                        ),
                      ),
                    Expanded(
                      child: Column(
                        children: [
                          feedback(),
                          Expanded(child: page),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      );
    },
  );
}

class _Count extends StatelessWidget {
  const _Count({required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label),
      const SizedBox(height: 12),
      Text(
        value,
        style: const TextStyle(fontSize: 56, color: Color(0xff303e73)),
      ),
    ],
  );
}
