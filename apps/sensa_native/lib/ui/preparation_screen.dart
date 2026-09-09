import '../l10n/interface_locale.dart';
import 'product_theme.dart';
import 'agent_screen.dart';
import 'reference_source_panel.dart';
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
      appBar: AppBar(title: Text(context.l10n.uiLearningPreparation)),
      body: Readable(
        child: ListView(
          children: [
            if (model.preparations.isEmpty)
              ListTile(
                title: Text(context.l10n.uiNoLearningTargetsNeedPreparation),
              ),
            for (final task in model.preparations)
              ListTile(
                title: Text(
                  task['target']['proposal']['expression']['surface'] as String,
                ),
                subtitle: Text(preparationLabel(context, task)),
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
    ),
  );
}

String preparationLabel(BuildContext context, Map<String, dynamic> task) =>
    switch (task['status']) {
      'ready' => context.l10n.uiMaterialReady,
      'generating' => context.l10n.uiPreparingOrAwaitingReview,
      'blocked' => context.l10n.uiPreparationBlocked,
      'cancelled' => context.l10n.uiPreparationCanceled,
      _ => context.l10n.uiAddedToLearningAwaitingMaterial,
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

      final expression =
          current?['target']['proposal']['expression']['surface'] ??
          meaning?['expression'] ??
          '';
      return Scaffold(
        appBar: AppBar(title: Text(context.l10n.uiPrepareLearningMaterial)),
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
                    Text(
                      context.l10n.uiAuthorizedContext(
                        (current!['anchor']['sentence']).toString(),
                      ),
                    ),
                  if (current != null)
                    ReferenceSourcePanel(model: model, task: current),
                  if ((current?['target']['binding'] ??
                          meaning?['bindingMetadata'])
                      case final Map binding)
                    Text(
                      context.l10n.uiRelationCoverage(
                        (bindingRelationLabel(
                          context,
                          binding['relation'],
                        )).toString(),
                        (bindingCoverageLabel(
                          context,
                          binding['semanticCoverage'],
                        )).toString(),
                      ),
                    ),
                  if (model.notice != null) Text(model.notice!),
                  const SizedBox(height: 16),
                  if (!ready) ...[
                    Text(context.l10n.uiChooseALearningModeOnlyConfirmed),
                    if (current == null && existingTarget != null)
                      Text(context.l10n.uiThisMeaningIsAlreadyInLearning),
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      key: ValueKey(
                        'preparation-policy-${current?['revision'] ?? 0}',
                      ),
                      initialValue: policy['profileId'] as String,
                      decoration: InputDecoration(
                        labelText: context.l10n.uiLearningMode690,
                      ),
                      items: [
                        for (final choice in model.snapshot!.policyChoices)
                          DropdownMenuItem(
                            value: choice['policy']['profileId'] as String,
                            child: Text(
                              model.snapshot!.policyLabel(
                                choice['policy']['profileId'] as String,
                              ),
                            ),
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
                    Text(
                      context.l10n.uiTheCurrentOnlineServiceProvidesLightweight,
                    ),
                    if (current == null || selected != null)
                      FilledButton(
                        onPressed: model.busy ? null : choose,
                        child: Text(
                          current == null
                              ? context.l10n.uiConfirmAndAddToLearning
                              : context.l10n.uiApplyNewLearningMode,
                        ),
                      ),
                  ],
                  if (current != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      preparationLabel(context, current),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      context.l10n.uiPreparationAttemptsUsed(
                        (current['attemptCount']).toString(),
                      ),
                    ),
                    if (current['status'] == 'generating') ...[
                      if (model.provisioningBusy)
                        const LinearProgressIndicator(),
                      Text(
                        expired
                            ? context.l10n.uiTheRequestTimedOutYouCan
                            : model.provisioningBusy
                            ? context.l10n.uiGeneratingAndReviewingYouCanLeave
                            : context.l10n.uiTheRequestMayHaveBeenInterrupted,
                      ),
                    ],
                    if (current['reason'] != null)
                      Text(switch (current['reason']) {
                        'unsupported_content_policy' =>
                          context.l10n.uiTheServiceCannotProvideMaterialFor,
                        'material_rejected' =>
                          context.l10n.uiTheCandidateFailedIndependentReviewAnd,
                        'validation_unavailable' =>
                          context.l10n.uiTheReviewServiceIsUnavailableMaterial,
                        'generation_failed' =>
                          context.l10n.uiGenerationFailedYourTargetAndMeaning,
                        'cancelled' =>
                          context
                              .l10n
                              .uiPreparationCanceledRequestsAlreadySentMay,
                        'access_required' =>
                          context.l10n.uiValidServiceAccessIsRequiredCheck,
                        _ => context.l10n.uiPreparationDidNotFinishCheckThe,
                      }),
                    if (ready)
                      FilledButton(
                        onPressed: model.busy ? null : learn,
                        child: Text(context.l10n.uiBackToLearning),
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
                        child: Text(context.l10n.uiPrepareWithModelService),
                      ),
                      TextButton(
                        onPressed: model.provisioningBusy ? null : configure,
                        child: Text(context.l10n.uiModelServiceSettings),
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
                          child: Text(context.l10n.uiCancelPreparation),
                        ),
                      if ((current['attemptCount'] as int) >= 3)
                        Text(
                          context
                              .l10n
                              .uiPreparationAttemptLimitReachedYourTarget,
                        ),
                    ],
                    TextButton(
                      onPressed: model.busy ? null : model.load,
                      child: Text(context.l10n.uiCheckLocalTask),
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
                      child: Text(context.l10n.uiRetrySavingLocally),
                    ),
                    TextButton(
                      onPressed: model.busy ? null : model.load,
                      child: Text(context.l10n.uiReloadLocalState),
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

String bindingRelationLabel(BuildContext context, dynamic value) =>
    switch (value) {
      'approximates' => context.l10n.uiApproximatesThisMeaning,
      'evokes' => context.l10n.uiEvokesThisMeaning,
      _ => context.l10n.uiExpressesThisMeaning,
    };
String bindingCoverageLabel(BuildContext context, dynamic value) =>
    switch (value) {
      'broader' => context.l10n.uiBroader711,
      'narrower' => context.l10n.uiNarrower,
      'overlapping' => context.l10n.uiPartialOverlap,
      _ => context.l10n.uiSame,
    };
