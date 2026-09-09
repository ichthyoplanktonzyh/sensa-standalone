import '../l10n/interface_locale.dart';
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
  List<String> get labels => [
    context.l10n.uiHome,
    context.l10n.uiMyContent,
    context.l10n.uiLearn,
    context.l10n.uiPractice,
    context.l10n.uiSettings,
  ];
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
        LinearProgressIndicator(
          minHeight: 2,
          semanticsLabel: context.l10n.uiReadingOrSavingYourLibrary,
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
                      child: Text(context.l10n.uiRetry),
                    ),
                    TextButton(
                      onPressed: model.busy ? null : model.load,
                      child: Text(context.l10n.uiReload),
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
    pageId: 'welcome',
    title: context.l10n.uiStartAtYourOwnPace,
    subtitle: context.l10n.uiLearnOfflineWithoutAnAccount,
    children: [
      languagePicker(),
      ProductPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              context.l10n.uiHowManyNewConnectionsEachDay,
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
              child: Text(context.l10n.uiSetDailyQuantity),
            ),
            const SizedBox(height: 12),
            Text(context.l10n.uiYouCanChangeThisInSettings),
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
      pageId: 'home',
      title: context.l10n.uiConnectWithNewMeanings,
      subtitle: context.l10n.uiMessage(
        context.localDate(DateTime.parse(s.learning['date'] as String)),
      ),
      children: [
        ProductPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                context.l10n.uiToday,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 28),
              Wrap(
                spacing: 48,
                runSpacing: 20,
                children: [
                  _Count(label: context.l10n.uiNew, value: '$fresh'),
                  _Count(label: context.l10n.uiDueReviews, value: '$due'),
                  _Count(
                    label: context.l10n.uiToContinue,
                    value: '${counts['initialContinuations'] ?? 0}',
                  ),
                ],
              ),
              const SizedBox(height: 28),
              Text(
                resumable
                    ? context.l10n.uiPickUpWhereYouLeftOff
                    : s.catalog.isEmpty
                    ? context.l10n.uiAddLearningContentOrCaptureA
                    : context.l10n.uiLearnAtYourOwnPace,
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
                      ? context.l10n.uiContinueToday
                      : !hasWork
                      ? context.l10n.uiAddLearningContent
                      : context.l10n.uiStartToday,
                ),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: model.busy || due == 0
                    ? null
                    : () => study('review_only'),
                icon: const Icon(Icons.replay),
                label: Text(
                  due == 0
                      ? context.l10n.uiNoReviewsDue
                      : context.l10n.uiReviewOnly,
                ),
              ),
            ],
          ),
        ),
        link(
          context.l10n.uiBrowseLearningContent,
          context.l10n.uiImportALearningPackageAndChoose,
          Icons.library_books_outlined,
          () => setState(() => selected = 2),
        ),
        const Divider(),
        link(
          context.l10n.uiCaptureAContext,
          context.l10n.uiGetHelpFromYourLanguageTeacher,
          Icons.chat_bubble_outline,
          () => open(PersonalWorldScreen(model: model)),
        ),
      ],
    );
  }

  Widget content() => ProductPage(
    pageId: 'content',
    title: context.l10n.uiMyContent,
    children: [
      ProductPanel(
        child: Column(
          children: [
            link(
              context.l10n.uiMySemanticWorld,
              context.l10n.uiSavedMeaningsAndInbox,
              Icons.book_outlined,
              () => open(PersonalWorldScreen(model: model)),
            ),
            const Divider(),
            link(
              context.l10n.uiImagesAndConnections,
              context.l10n.uiExploreDraftsAndRelatedExpressions,
              Icons.hub_outlined,
              () => open(WorldScreen(library: model)),
            ),
          ],
        ),
      ),
      link(
        context.l10n.uiLearningPreparation,
        context.l10n.uiCheckMaterialPreparationAndPendingTasks,
        Icons.auto_stories_outlined,
        () => open(PreparationListScreen(model: model)),
      ),
      link(
        context.l10n.uiCaptureConnections,
        context.l10n.uiReceiveContextsFromYourBrowserAnd,
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
      pageId: 'learning',
      title: context.l10n.uiMyLearning,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            FilledButton.icon(
              onPressed: model.busy ? null : model.importPack,
              icon: const Icon(Icons.download_outlined),
              label: Text(context.l10n.uiImportLearningPackage),
            ),
            OutlinedButton(
              onPressed: model.busy
                  ? null
                  : () => open(CurriculumScreen(model: model)),
              child: Text(context.l10n.uiLearningSources),
            ),
            OutlinedButton(
              onPressed: () => open(HistoryScreen(model: model)),
              child: Text(context.l10n.uiAllLearningHistory),
            ),
          ],
        ),
        TextField(
          key: const ValueKey('library-search'),
          controller: search,
          decoration: InputDecoration(
            labelText: context.l10n.uiSearchExpressionsOrMeanings,
            prefixIcon: Icon(Icons.search),
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (s.catalog.isEmpty)
          ProductPanel(child: Text(context.l10n.uiImportALearningPackageOrAdd))
        else if (entries.isEmpty)
          Text(context.l10n.uiNoMatchesTryAnotherExpression)
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
                      ? context.l10n.uiInitialLearningComplete127
                      : e['enrolled'] == true
                      ? context.l10n.uiAddedToLearning
                      : context.l10n.uiNotAddedToLearning}',
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
          title: Text(context.l10n.uiDailyNewQuantity),
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
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, next),
              child: Text(context.l10n.uiSaveQuantity),
            ),
          ],
        ),
      ),
    );
    if (value != null) {
      await model.act({'kind': 'confirm_quantity', 'quantity': value});
    }
  }

  Widget languagePicker() => ProductPanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          key: ValueKey(
            'interface-language-${interfaceLocale.locale.languageCode}',
          ),
          initialValue: interfaceLocale.locale.languageCode,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: context.l10n.interfaceLanguage,
          ),
          items: [
            DropdownMenuItem(
              value: 'zh',
              child: Text(context.l10n.simplifiedChinese),
            ),
            DropdownMenuItem(value: 'en', child: Text(context.l10n.english)),
          ],
          onChanged: interfaceLocale.saving
              ? null
              : (value) {
                  if (value != null) interfaceLocale.select(value);
                },
        ),
        if (interfaceLocale.saveFailed) Text(context.l10n.languageSaveFailed),
      ],
    ),
  );

  Widget settings() => ProductPage(
    pageId: 'settings',
    title: context.l10n.uiSettings,
    children: [
      languagePicker(),
      ProductPanel(
        child: Column(
          children: [
            link(
              context.l10n.uiDailyNewQuantity,
              context.l10n.uiNewConnections(model.snapshot!.quantity!),
              Icons.today_outlined,
              changeQuantity,
            ),
            const Divider(),
            link(
              context.l10n.uiDefaultLearningMode,
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
              context.l10n.uiModelServices,
              context.l10n.uiUseYourOwnApiKeyOr,
              Icons.cloud_outlined,
              () => open(AgentSettingsScreen(controller: model.agents)),
            ),
            const Divider(),
            link(
              context.l10n.uiCaptureConnections,
              context.l10n.uiBrowserAgentsAndFileImport,
              Icons.input,
              () => open(IntakeConnectionScreen(model: model)),
            ),
          ],
        ),
      ),
      Text(context.l10n.uiYourContentIsOnThisDevice),
      ExpansionTile(
        key: const PageStorageKey('native_shell-detail-1'),
        title: Text(context.l10n.uiLocalLibrary),
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
          ? Center(child: Text(context.l10n.uiOpeningYourLibrary))
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
                          tooltip: context.l10n.uiSettings,
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
                            Expanded(
                              child: ListView(
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
                                      selectedTileColor: const Color(
                                        0xffe6e9f2,
                                      ),
                                      onTap: ready
                                          ? () => setState(() => selected = i)
                                          : null,
                                    ),
                                ],
                              ),
                            ),
                            const Divider(),
                            ListTile(
                              key: const ValueKey('nav-4'),
                              leading: const Icon(Icons.tune),
                              title: Text(context.l10n.uiSettings),
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
