import '../l10n/interface_locale.dart';
import 'product_theme.dart';
import 'provider_login_screen.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import 'agent_controller.dart';

class AgentSettingsScreen extends StatefulWidget {
  const AgentSettingsScreen({super.key, required this.controller});
  final AgentController controller;
  @override
  State<AgentSettingsScreen> createState() => _AgentSettingsScreenState();
}

class _AgentSettingsScreenState extends State<AgentSettingsScreen> {
  Future<void> edit([Map<String, dynamic>? old]) async {
    final name = TextEditingController(
      text: old?['name'] ?? context.l10n.uiMyModels,
    );
    final endpoint = TextEditingController(
      text: old?['endpoint'] ?? 'https://api.deepseek.com',
    );
    final model = TextEditingController(
      text: old?['model'] ?? 'deepseek-v4-flash',
    );
    final key = TextEditingController();
    String kind = old?['kind'] ?? 'compatible';
    bool vision = old?['vision'] ?? false;
    String? failure;
    bool saving = false;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(context.l10n.uiModelServices),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(context.l10n.uiCredentialsAreKeptInSecureStorage),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  initialValue: kind,
                  items: [
                    DropdownMenuItem(
                      value: 'compatible',
                      child: Text(context.l10n.uiOwnKeyOpenaiCompatibleApi),
                    ),
                    DropdownMenuItem(
                      value: 'sensa',
                      child: Text(context.l10n.uiSensaModelService),
                    ),
                  ],
                  onChanged: (v) => set(() => kind = v!),
                ),
                TextField(
                  key: const ValueKey('agent-provider-name'),
                  controller: name,
                  decoration: InputDecoration(labelText: context.l10n.uiName),
                ),
                TextField(
                  key: const ValueKey('agent-provider-url'),
                  controller: endpoint,
                  decoration: InputDecoration(
                    labelText: kind == 'sensa'
                        ? context.l10n.uiSensaServiceUrl
                        : context.l10n.uiApiBaseUrlEGHttps,
                  ),
                ),
                TextField(
                  key: const ValueKey('agent-provider-model'),
                  controller: model,
                  decoration: InputDecoration(
                    labelText: kind == 'sensa'
                        ? context.l10n.uiModelNoteActualModelIsSet
                        : context.l10n.uiModelId,
                  ),
                ),
                TextField(
                  key: const ValueKey('agent-provider-key'),
                  controller: key,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    labelText: kind == 'sensa'
                        ? context.l10n.uiSensaAccessToken
                        : context.l10n.uiApiKeyLeaveBlankToKeep,
                  ),
                ),
                CheckboxListTile(
                  value: vision,
                  onChanged: (v) => set(() => vision = v!),
                  title: Text(context.l10n.uiSupportsImageInput),
                ),
                if (failure != null) Text(failure!),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              onPressed: saving
                  ? null
                  : () async {
                      set(() => saving = true);
                      try {
                        await widget.controller.providers.save({
                          'id': old?['id'] ?? const Uuid().v4(),
                          'name': name.text.trim(),
                          'endpoint': endpoint.text.trim(),
                          'model': model.text.trim(),
                          'kind': kind,
                          'vision': vision,
                        }, key.text);
                        widget.controller.setError(null);
                        widget.controller.changed();
                        if (ctx.mounted) Navigator.pop(ctx);
                      } catch (e) {
                        if (ctx.mounted) {
                          set(() {
                            saving = false;
                            failure = widget.controller.describe(e);
                          });
                        }
                      }
                    },
              child: Text(context.l10n.uiSaveModelService),
            ),
          ],
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
    for (final c in [name, endpoint, model, key]) {
      c.dispose();
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(context.l10n.uiModelServiceSettings)),
    body: Readable(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          for (final p in widget.controller.providers.profiles)
            ListTile(
              title: Text(p['name']),
              subtitle: Text(
                '${p['model']} · ${p['vision'] ? context.l10n.uiImagesSupported : context.l10n.uiText} · ${widget.controller.providers.status(p['id'])}',
              ),
              onTap: () => edit(p),
              trailing: PopupMenuButton<String>(
                tooltip: context.l10n.uiManageModelServices,
                onSelected: (value) async {
                  try {
                    if (value == 'login') {
                      await Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => ProviderLoginScreen(
                            controller: widget.controller,
                            profile: p,
                          ),
                        ),
                      );
                    } else if (value == 'forget') {
                      await widget.controller.providers.forget(p['id']);
                    } else {
                      await widget.controller.providers.remove(p['id']);
                    }
                    widget.controller.setError(null);
                    widget.controller.changed();
                    if (mounted) setState(() {});
                  } catch (e) {
                    widget.controller.setError(
                      () => widget.controller.describe(e),
                    );
                    widget.controller.changed();
                    if (mounted) setState(() {});
                  }
                },
                itemBuilder: (_) => [
                  if (p['kind'] == 'sensa')
                    PopupMenuItem(
                      value: 'login',
                      child: Text(context.l10n.uiOnlineAccount),
                    ),
                  PopupMenuItem(
                    value: 'forget',
                    child: Text(context.l10n.uiDeleteSavedCredentials),
                  ),
                  PopupMenuItem(
                    value: 'remove',
                    child: Text(context.l10n.uiDeleteService),
                  ),
                ],
              ),
            ),
          if (widget.controller.error != null) Text(widget.controller.error!),
          TextButton(
            onPressed: () async {
              await widget.controller.providers.unlock();
              widget.controller.changed();
              if (mounted) setState(() {});
            },
            child: Text(context.l10n.uiReloadCredentials),
          ),
          for (final role in {
            'teacher': context.l10n.uiClarificationAndExplanation,
            'content': context.l10n.uiLearningMaterialGeneration,
            'review': context.l10n.uiIndependentReview,
            'service': context.l10n.uiSensaOnlineResources,
          }.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: DropdownButtonFormField<String>(
                isExpanded: true,
                key: ValueKey(
                  'provider-role-${role.key}-${(widget.controller.providers.forPurpose(role.key)?['id'])}',
                ),
                initialValue:
                    widget.controller.providers.profiles.any(
                      (p) =>
                          p['id'] ==
                              (widget.controller.providers.forPurpose(
                                role.key,
                              )?['id']) &&
                          (role.key != 'service' || p['kind'] == 'sensa'),
                    )
                    ? (widget.controller.providers.forPurpose(role.key)?['id'])
                    : '',
                decoration: InputDecoration(labelText: role.value),
                items: [
                  DropdownMenuItem(
                    value: '',
                    child: Text(context.l10n.uiNotConfigured),
                  ),
                  for (final p in widget.controller.providers.profiles)
                    if (role.key != 'service' || p['kind'] == 'sensa')
                      DropdownMenuItem(
                        value: p['id'] as String,
                        child: Text(p['name']),
                      ),
                ],
                onChanged: (id) async {
                  try {
                    await widget.controller.providers.assign(
                      role.key,
                      id == '' ? null : id,
                    );
                    widget.controller.changed();
                    if (mounted) setState(() {});
                  } catch (e) {
                    widget.controller.setError(
                      () => widget.controller.describe(e),
                    );
                    if (mounted) setState(() {});
                  }
                },
              ),
            ),
          Text(context.l10n.uiChooseAServiceForEachPurpose),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () => edit(),
            child: Text(context.l10n.uiAddModelService),
          ),
        ],
      ),
    ),
  );
}

class AgentHistoryScreen extends StatefulWidget {
  const AgentHistoryScreen({super.key, required this.controller});
  final AgentController controller;
  @override
  State<AgentHistoryScreen> createState() => _AgentHistoryScreenState();
}

class _AgentHistoryScreenState extends State<AgentHistoryScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.load();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) => Scaffold(
      appBar: AppBar(title: Text(context.l10n.uiConversationsAndResources)),
      body: Readable(
        child: ListView(
          children: [
            if (widget.controller.error != null) Text(widget.controller.error!),
            if (widget.controller.sessions.isEmpty)
              ListTile(title: Text(context.l10n.uiNoConversationsYet)),
            for (final s in widget.controller.sessions)
              ListTile(
                title: Text(
                  s['kind'] == 'teacher'
                      ? context.l10n.uiConversationWithYourTeacher
                      : context.l10n.uiLearningResourcePreparation,
                ),
                subtitle: Text(agentStatus(context, s['status'])),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        AgentScreen(controller: widget.controller, id: s['id']),
                  ),
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

String agentStatus(BuildContext context, dynamic status) => switch (status) {
  'waiting' => context.l10n.uiWaitingForYourReply,
  'proposal' => context.l10n.uiSuggestionReadyForConfirmation,
  'accepted' => context.l10n.uiSavedToYourSemanticWorld,
  'review' => context.l10n.uiWaitingForIndependentReview,
  'ready' => context.l10n.uiReviewPassedReadyToSave,
  'committed' => context.l10n.uiLearningMaterialReady,
  'inflight' => context.l10n.uiProcessingResumeIfInterrupted,
  'failed' => context.l10n.uiNotCompletedConversationKept,
  'paused' => context.l10n.uiPausedConversationKept,
  _ => context.l10n.uiReadyToStartOrContinue,
};

class AgentScreen extends StatefulWidget {
  const AgentScreen({
    super.key,
    required this.controller,
    this.id,
    this.source,
    this.initialMessage,
  });
  final AgentController controller;
  final String? id;
  final Map<String, dynamic>? source;
  final String? initialMessage;
  @override
  State<AgentScreen> createState() => _AgentScreenState();
}

class _AgentScreenState extends State<AgentScreen> {
  late String? id;
  final input = TextEditingController();
  bool submitting = false, images = true;
  AgentController get c => widget.controller;
  @override
  void initState() {
    super.initState();
    id = widget.id;
    input.text = widget.initialMessage ?? '';
    c.load();
  }

  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (submitting || c.busy) return;
    setState(() => submitting = true);
    try {
      if (id == null) {
        if (!c.providers.ready(
          widget.source!['kind'] == 'content' ? 'content' : 'teacher',
        )) {
          c.setError(() => l10n.uiChooseAModelServiceAndSave);
          c.changed();
          return;
        }
        id = await c.create({
          ...widget.source!,
          if (widget.source!['kind'] == 'world') 'share_images': images,
        });
        if (id == null) return;
      }
      if (input.text.trim().isNotEmpty) {
        await c.say(id!, input.text.trim());
        if (c.error == null) input.clear();
      } else if (['waiting', 'proposal'].contains(c.session(id!)['status'])) {
        c.setError(() => l10n.uiAddAReplyOrConfirmThe);
        c.changed();
      } else {
        await c.run(id!);
      }
    } finally {
      if (mounted) setState(() => submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: c,
    builder: (context, _) {
      final s = id == null
          ? null
          : c.sessions.where((s) => s['id'] == id).firstOrNull;
      final teacher =
          s?['kind'] == 'teacher' ||
          widget.source?['kind'] == 'world' ||
          widget.source?['kind'] == 'capture';
      final done = ['accepted', 'committed'].contains(s?['status']);
      return Scaffold(
        appBar: AppBar(
          title: Text(
            teacher
                ? context.l10n.uiTalkToALanguageTeacher
                : context.l10n.uiPrepareLearningResources,
          ),
          actions: [
            IconButton(
              tooltip: context.l10n.uiModelServices,
              onPressed: c.busy || submitting
                  ? null
                  : () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => AgentSettingsScreen(controller: c),
                        ),
                      );
                      if (mounted) setState(() {});
                    },
              icon: const Icon(Icons.settings_outlined),
            ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            key: const ValueKey('agent-scroll'),
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                teacher
                    ? context.l10n.uiTellYourTeacherWhatYouWant
                    : context.l10n.uiPrepareAndReviewMaterialForThe,
              ),
              Text(
                c.providers.forPurpose(teacher ? 'teacher' : 'content') == null
                    ? context.l10n.uiNoModelServiceSelected
                    : context.l10n.uiCurrentService(
                        (c.providers.forPurpose(
                          teacher ? 'teacher' : 'content',
                        )!['name']).toString(),
                      ),
              ),
              if (!teacher)
                Text(
                  context.l10n.uiReviewService(
                    (c.providers.forPurpose('review')?['name'] ??
                            context.l10n.uiNotConfigured572)
                        .toString(),
                  ),
                ),
              if (id == null && widget.source?['kind'] == 'world') ...[
                Text(context.l10n.uiSendingSharesThisCaptureAndConversation),
                CheckboxListTile(
                  value: images,
                  onChanged: submitting
                      ? null
                      : (v) => setState(() => images = v!),
                  title: Text(context.l10n.uiIncludeImagesFromTheCapture),
                ),
                Text(context.l10n.uiTurnOffToDiscussTextOnly),
              ],
              if (c.busy && c.previewSession == id && c.preview.isNotEmpty)
                Text(
                  context.l10n.uiWorkingDraft((c.preview).toString()),
                  key: const ValueKey('agent-preview'),
                ),
              if (s != null) ...[
                Text(agentStatus(context, s['status'])),
                if (teacher)
                  for (final m in s['messages'])
                    if (['assistant', 'user'].contains(m['role']) &&
                        m['content'] is String &&
                        (m['content'] as String).isNotEmpty)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Text(
                            '${m['role'] == 'user' ? context.l10n.uiYou : context.l10n.uiTeacher}：${m['content']}',
                          ),
                        ),
                      ),
                if (teacher &&
                    s['status'] == 'waiting' &&
                    s['question'] != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(
                        context.l10n.uiTeacher579((s['question']).toString()),
                      ),
                    ),
                  ),
                if (s['candidate'] != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: teacher
                            ? [
                                Text(
                                  s['candidate']['expression']['surface'],
                                  style: Theme.of(
                                    context,
                                  ).textTheme.headlineSmall,
                                ),
                                Text(s['candidate']['explanation']),
                                Text(
                                  s['candidate']['semanticSpec']['coreMeaningFocus'],
                                ),
                              ]
                            : [
                                Text(s['candidate']['scene']),
                                Text(s['candidate']['senseFocus']),
                              ],
                      ),
                    ),
                  ),
                if (!teacher && s['review'] != null)
                  Text(
                    context.l10n.uiReview580(
                      (s['review']['reason']).toString(),
                    ),
                  ),
                if (s['status'] == 'proposal')
                  FilledButton(
                    onPressed: c.busy || submitting
                        ? null
                        : () => c.accept(id!),
                    child: Text(context.l10n.uiThatIsWhatIMeanSave),
                  ),
                if (s['status'] == 'accepted')
                  Text(context.l10n.uiSavedYouCanAddThisTo582),
              ],
              if (c.error != null) Text(c.error!),
              if (c.busy) const LinearProgressIndicator(),
              if (!done && teacher)
                TextField(
                  key: const ValueKey('agent-reply'),
                  controller: input,
                  enabled: !c.busy && !submitting,
                  minLines: 2,
                  maxLines: 5,
                  decoration: InputDecoration(
                    labelText: context.l10n.uiReplyOrCorrectTheSuggestion,
                  ),
                ),
              if (!done) ...[
                if (c.busy && id != null)
                  OutlinedButton(
                    onPressed: () => c.stop(id!),
                    child: Text(context.l10n.uiPauseThisConversation),
                  )
                else
                  FilledButton(
                    onPressed: submitting ? null : submit,
                    child: Text(
                      id == null
                          ? teacher
                                ? context.l10n.uiSendCaptureAndStart
                                : context.l10n.uiStartPreparation
                          : s?['status'] == 'waiting' ||
                                s?['status'] == 'proposal'
                          ? context.l10n.uiSendReply
                          : context.l10n.uiResume588,
                    ),
                  ),
                Text(context.l10n.uiYourConversationIsSavedRestartingWill),
              ],
              if (done)
                FilledButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(context.l10n.uiBack),
                ),
            ],
          ),
        ),
      );
    },
  );
}
