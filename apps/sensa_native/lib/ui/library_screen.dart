import '../l10n/interface_locale.dart';
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
  const LibraryScreen({
    super.key,
    required this.model,
    this.acceptanceTools = false,
    this.onHome,
  });
  final LibraryViewModel model;
  final bool acceptanceTools;
  final VoidCallback? onHome;
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
                    Expanded(child: Text(context.l10n.uiChooseLearningContent)),
                    IconButton(
                      tooltip: context.l10n.uiClose,
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
                            ? context.l10n.uiInitialLearningComplete127
                            : entry['enrolled'] == true
                            ? context.l10n.uiAddedToLearning
                            : context.l10n.uiNotAddedToLearning,
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

  Future<void> choosePolicy(String scope) => showLearningPolicy(
    context,
    widget.model,
    scope,
    includeUnavailable: widget.acceptanceTools,
  );

  Future<void> returnHome() async {
    await widget.model.showHome();
    if (mounted) widget.onHome?.call();
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
        body = [
          Text(context.l10n.uiOpeningYourLibrary617, style: t.headlineSmall),
        ];
      } else if (s.quantity == null) {
        body = [
          Text(context.l10n.uiStartAtYourOwnPace, style: t.headlineLarge),
          Text(context.l10n.uiHowManyNewConnectionsWouldYou),
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
            context.l10n.uiSetDailyQuantity,
            () => vm.act({'kind': 'confirm_quantity', 'quantity': quantity}),
          ),
        ];
      } else if (s.activity != null &&
          !vm.home &&
          (s.activity!['status'] != 'active' ||
              s.activity!['canAnswer'] != true)) {
        body = [LearningActivityView(model: vm, onHome: returnHome)];
      } else if (s.assurance != null && !vm.home) {
        final a = s.assurance!;
        final action = a['queue']?['session']?['action'];
        body = [
          AssuranceView(
            key: ValueKey(
              '${a['id']}:${action?['ordinal']}:${action?['actionKey']}',
            ),
            model: vm,
            onHome: returnHome,
          ),
        ];
      } else if (s.nextEligibleAtMs != null &&
          (s.phase == 'waiting' || s.phase == 'completed') &&
          !vm.home) {
        final eligible = DateTime.fromMillisecondsSinceEpoch(
          s.nextEligibleAtMs!,
        ).toLocal();
        body = [
          Text(context.l10n.uiRecallAgainLater, style: t.headlineLarge),
          Text(context.l10n.uiTakeSomeTimeThenTryRecalling),
          Text(
            context.l10n.uiReadyAt(
              (eligible.hour.toString().padLeft(2, '0')).toString(),
              (eligible.minute.toString().padLeft(2, '0')).toString(),
            ),
          ),
          button(
            context.l10n.uiContinueWhenReady,
            () => vm.act({'kind': 'start_retention', 'early': false}),
          ),
          button(
            context.l10n.uiRecallEarly623,
            () => vm.act({'kind': 'start_retention', 'early': true}),
            primary: false,
          ),
          button(context.l10n.uiLearnSomethingElse, returnHome, primary: false),
          button(context.l10n.uiEndSession, returnHome, primary: false),
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
                ? context.l10n.uiInitialLearningComplete626
                : s.protocol == 'consumer-review-v1'
                ? context.l10n.uiReviewComplete
                : context.l10n.uiRelearningComplete,
            style: t.headlineLarge,
          ),
          Text(s.material!['expression'] as String, style: t.headlineSmall),
          Text(
            s.protocol == 'consumer-relearning-v1'
                ? context.l10n.uiConnectionRestored
                : context.l10n.uiLearningProgressAndNextReviewSaved,
          ),
          Text(
            context.l10n.nextReviewDate(context.localDate(due)),
            style: t.bodyLarge,
          ),

          if (s.protocol != 'consumer-initial-v1')
            button(
              context.l10n.uiReviewOtherContent,
              () => vm.act({'kind': 'next_retention'}),
            ),
          button(context.l10n.uiBackToHome, returnHome),
        ];
      } else if (s.run != null &&
          s.phase != 'completed' &&
          !s.paused &&
          !vm.home) {
        final recall = s.phase == 'recall';
        body = [
          Text(
            s.protocol == 'consumer-review-v1'
                ? context.l10n.uiDueReviews
                : s.protocol == 'consumer-relearning-v1'
                ? context.l10n.uiLearnAgain
                : context.l10n.uiInitialLearning,
            style: t.labelLarge,
          ),
          Text(
            recall
                ? context.l10n.uiRecallThisContext
                : context.l10n.uiConnectThisExpression,
            style: t.headlineSmall,
          ),
          Text(s.material!['scene'] as String, style: t.bodyLarge),
          if (recall) ...[
            Text(s.material!['sense'] as String, style: t.bodyMedium),
            OptionalResourcesView(material: s.material!, revealed: false),
            Text(context.l10n.uiTryExpressingItInYourMind),
            button(context.l10n.uiRevealExpression, () => vm.answer('reveal')),
          ] else if (s.material != null) ...[
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
                button(
                  context.l10n.uiAgain,
                  () => vm.answer('again'),
                  primary: false,
                ),
                button(
                  context.l10n.uiHard,
                  () => vm.answer('hard'),
                  primary: false,
                ),
                button(context.l10n.uiGood, () => vm.answer('good')),
              ],
            ),
          ],
          TextButton(
            onPressed: available
                ? () => (s.activity?['status']) == 'active'
                      ? vm.stopActivity()
                      : vm.act({'kind': 'pause'})
                : null,
            child: Text(context.l10n.uiPauseLearning),
          ),
        ];
      } else {
        body = [
          if (widget.acceptanceTools) ...[
            Text(context.l10n.uiMyLocalLibrary, style: t.headlineLarge),
            Text(context.l10n.uiNewPerDay((s.quantity).toString())),
            Text(
              context.l10n.uiReviewsRelearningCompletionsToRestore(
                (s.retention['reviewCount'] ?? 0).toString(),
                (s.retention['relearningCount'] ?? 0).toString(),
                (s.retention['pendingCount'] ?? 0).toString(),
              ),
            ),
            Text(context.l10n.uiDefaultMode((s.defaultPolicyLabel).toString())),
            button(
              context.l10n.uiDefaultLearningMode,
              () => choosePolicy('learner'),
              primary: false,
            ),
            LearningActivityView(model: vm, overview: true),
            button(
              context.l10n.uiImportLearningPackage,
              vm.importPack,
              primary: false,
            ),
            if (vm.notice != null)
              Semantics(liveRegion: true, child: Text(vm.notice!)),
            if (s.catalog.isNotEmpty) ...[
              Text(context.l10n.uiDownloadedContent, style: t.headlineSmall),
              Text(context.l10n.uiItemsSaved(s.catalog.length)),
              button(
                context.l10n.uiChooseOtherContent,
                chooseMaterial,
                primary: false,
              ),
              const Divider(),
            ],
          ],
          if (s.material == null && widget.acceptanceTools) ...[
            Text(context.l10n.uiLoadSyntheticAcceptanceMaterialToTest),
            button(
              context.l10n.uiLoadAcceptanceMaterial,
              () => vm.act({'kind': 'import_acceptance_material'}),
            ),
          ] else if (s.material != null) ...[
            Text(s.material!['expression'] as String, style: t.headlineSmall),
            Text(s.material!['sense'] as String, style: t.bodyLarge),
            Text(s.material!['source'] as String),
            if (s.policyPlan != null) ...[
              Text(
                context.l10n.uiLearningMode((s.selectedPolicyLabel).toString()),
              ),
              Text(context.l10n.uiSource((s.policySourceLabel).toString())),
              if (s.policyCommitted)
                Text(context.l10n.uiThisModeIsFixedForLearning)
              else
                button(
                  context.l10n.uiChangeModeForThisItem,
                  () => choosePolicy('target'),
                  primary: false,
                ),
              if (s.policyState['sourceKey'] != null)
                button(
                  context.l10n.uiPackageDefaultMode,
                  () => choosePolicy('curriculum'),
                  primary: false,
                ),
            ],
            if (!s.enrolled)
              button(
                context.l10n.uiAddToLearning,
                () => vm.act({'kind': 'add_to_learning'}),
              )
            else if (!s.inStudyScope) ...[
              Text(context.l10n.uiThisItemIsOutsideYourCurrent),
              button(
                context.l10n.uiAdjustLearningSources,
                () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CurriculumScreen(model: vm),
                  ),
                ),
                primary: false,
              ),
            ] else if (s.run == null &&
                s.initialReadiness?['status'] != 'ready') ...[
              Text(context.l10n.learningNotReady),
              button(
                context.l10n.uiRefreshPreparation,
                () => vm.act({'kind': 'refresh_plans'}),
                primary: false,
              ),
            ] else if (s.nextEligibleAtMs != null &&
                (s.phase == 'completed' || s.phase == 'waiting')) ...[
              Text(context.l10n.uiThisItemNeedsAnotherRecallAttempt),
              button(
                context.l10n.uiContinueRelearning,
                () => vm.act({'kind': 'start_retention', 'early': false}),
              ),
              button(
                context.l10n.uiRecallEarly623,
                () => vm.act({'kind': 'start_retention', 'early': true}),
                primary: false,
              ),
            ] else if (s.phase != 'completed')
              button(
                s.run == null
                    ? context.l10n.uiStartLearning
                    : context.l10n.uiContinueLearning662,
                () => vm.act({'kind': 'start_or_resume'}),
              )
            else ...[
              Text(
                context.l10n.uiReviewDate(
                  (DateTime.fromMillisecondsSinceEpoch(
                    s.dueAtMs!,
                  ).toLocal().toString().substring(0, 16)).toString(),
                ),
              ),
              button(
                context.l10n.uiStartDueReview,
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
            child: Text(context.l10n.uiPauseAndGoBack),
          ),
        );
      }
      if (vm.checkInPending && !vm.busy) {
        body.addAll([
          Semantics(
            liveRegion: true,
            child: Text(context.l10n.uiCheckInWasNotSavedYou),
          ),
          TextButton(
            onPressed: () => vm.checkIn(),
            child: Text(context.l10n.uiRetryCheckIn),
          ),
        ]);
      }
      return Scaffold(
        appBar: AppBar(
          title: Text(
            widget.acceptanceTools
                ? 'Sensa'
                : vm.home
                ? context.l10n.uiLearningContent
                : context.l10n.uiLearn,
          ),
          actions: [
            if (widget.acceptanceTools) ...[
              IconButton(
                tooltip: context.l10n.uiFreePractice,
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
                tooltip: context.l10n.uiLearningSources,
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
                tooltip: context.l10n.uiMySemanticWorld,
                icon: const Icon(Icons.hub_outlined),
                onPressed: vm.busy || s == null
                    ? null
                    : () => Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) => PersonalWorldScreen(model: vm),
                        ),
                      ),
              ),
            ],
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
                              child: Text(context.l10n.uiRetry),
                            ),
                            TextButton(
                              onPressed: vm.busy ? null : vm.load,
                              child: Text(context.l10n.uiReload),
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
                      Expanded(
                        child: Text(
                          vm.busy
                              ? context.l10n.uiSavingLocally
                              : context.l10n.uiLocalLearning,
                        ),
                      ),
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

Future<void> showLearningPolicy(
  BuildContext context,
  LibraryViewModel model,
  String scope, {
  bool includeUnavailable = false,
}) async {
  final snapshot = model.snapshot;
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
                          ? context.l10n.uiChooseThisLearningMode
                          : scope == 'curriculum'
                          ? context.l10n.uiSetPackageDefaultMode
                          : context.l10n.uiSetDefaultLearningMode,
                    ),
                  ),
                  IconButton(
                    tooltip: context.l10n.uiClose,
                    onPressed: () => Navigator.pop(sheetContext),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Text(context.l10n.uiDefaultChangesApplyToLearningThat),
            ),
            Expanded(
              child: ListView(
                children: [
                  for (final choice in snapshot.policyChoices.where(
                    (c) => includeUnavailable || c['executable'] == true,
                  ))
                    ListTile(
                      title: Text(
                        model.snapshot!.policyLabel(
                          choice['policy']['profileId'] as String,
                        ),
                      ),
                      subtitle: Text(
                        choice['executable'] == true
                            ? context.l10n.uiAvailableOnThisDevice
                            : context.l10n.uiNotYetSupportedOnThisDevice,
                      ),
                      onTap: () => Navigator.pop(sheetContext, choice),
                    ),
                  ListTile(
                    title: Text(
                      scope == 'learner'
                          ? context.l10n.uiRestoreSystemDefault
                          : context.l10n.uiUseInheritedSetting,
                    ),
                    onTap: () => Navigator.pop(sheetContext, {'inherit': true}),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
  if (selected != null && context.mounted) {
    await model.setPolicy(scope, selected['policy'] as Map<String, dynamic>?);
  }
}
