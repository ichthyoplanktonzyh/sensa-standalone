import '../l10n/interface_locale.dart';
import 'intake_connection_screen.dart';
import 'world_screen.dart';
import 'preparation_screen.dart';
import 'semantic_resolution_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'library_view_model.dart';

/// Personal content consumes Rust projections; no UI flag can confirm a Sense.
class PersonalWorldScreen extends StatefulWidget {
  const PersonalWorldScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<PersonalWorldScreen> createState() => _PersonalWorldScreenState();
}

class _PersonalWorldScreenState extends State<PersonalWorldScreen>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !model.busy) {
      model.load();
    }
  }

  int section = 0;
  String search = '';
  LibraryViewModel get model => widget.model;
  Future<void> compose({
    Map<String, dynamic>? intake,
    Map<String, dynamic>? copy,
  }) async {
    final accepted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            _CaptureEditor(model: model, intake: intake, copy: copy),
      ),
    );
    if (mounted && accepted != null) {
      setState(() => section = accepted ? 0 : 1);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            accepted
                ? context.l10n.uiMeaningSaved
                : context.l10n.uiSavedToInbox,
          ),
        ),
      );
    }
  }

  Future<void> openLookup(Map<String, dynamic> lookup) async {
    final accepted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => SemanticResolutionScreen(
          model: model,
          capture: lookup['request']['snapshot'] as Map<String, dynamic>,
          intakeId: lookup['intakeId'] as String?,
        ),
      ),
    );
    if (mounted && accepted == true) setState(() => section = 0);
  }

  Future<void> membership(
    Map<String, dynamic> item,
    String entity,
    bool active,
  ) => model.personalAction({
    'kind': 'set_membership',
    'entity': entity,
    'id': item['id'],
    'expected_revision': item['revision'],
    'active': active,
  });
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final p = model.snapshot!.personal;
      final meanings = (p['meanings'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      final intakes = (p['intakes'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      final items =
          [
                if (section == 1)
                  for (final lookup in model.lookups.where(
                    (v) =>
                        v['status'] != 'accepted' &&
                        v['status'] != 'superseded',
                  ))
                    {
                      ...lookup,
                      'snapshot': lookup['request']['snapshot'],
                      'entity': 'lookup',
                    },
                for (final m in meanings)
                  if (section == 0 && m['status'] == 'confirmed' ||
                      section == 2 && m['status'] == 'removed')
                    {...m, 'entity': 'meaning'},
                for (final i in intakes)
                  if (section == 1 && i['status'] == 'inbox' ||
                      section == 2 && i['status'] == 'removed')
                    {...i, 'entity': 'intake'},
              ]
              .where(
                (i) =>
                    '${i['snapshot']['sentence']} ${i['sense'] ?? ''} ${i['expression'] ?? ''}'
                        .toLowerCase()
                        .contains(search.toLowerCase()),
              )
              .toList();
      return Scaffold(
        appBar: AppBar(
          title: Text(context.l10n.uiMySemanticWorld),
          actions: [
            IconButton(
              tooltip: context.l10n.uiRefreshCaptures,
              icon: const Icon(Icons.refresh),
              onPressed: model.busy ? null : model.load,
            ),
            IconButton(
              tooltip: context.l10n.uiCaptureConnections,
              icon: const Icon(Icons.input),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => IntakeConnectionScreen(model: model),
                ),
              ),
            ),
            IconButton(
              tooltip: context.l10n.uiImagesAndConnections,
              icon: const Icon(Icons.hub_outlined),
              onPressed: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => WorldScreen(library: model),
                  ),
                );
                await model.load();
              },
            ),
            IconButton(
              tooltip: context.l10n.uiLearningPreparation,
              icon: const Icon(Icons.auto_stories_outlined),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => PreparationListScreen(model: model),
                ),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 800),
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(context.l10n.uiSaveAContextAndFindThe),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: model.busy ? null : () => compose(),
                          child: Text(context.l10n.uiSaveContent),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final (index, label) in [
                              context.l10n.uiSaved,
                              context.l10n.uiInbox,
                              context.l10n.uiRemoved,
                            ].indexed)
                              ChoiceChip(
                                label: Text(label),
                                selected: section == index,
                                onSelected: (_) =>
                                    setState(() => section = index),
                              ),
                          ],
                        ),
                        TextField(
                          key: const ValueKey('personal-search'),
                          decoration: InputDecoration(
                            labelText: context
                                .l10n
                                .uiSearchContextsExpressionsOrMeanings,
                          ),
                          onChanged: (value) => setState(() => search = value),
                        ),
                      ],
                    ),
                  ),
                  if (model.notice != null)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(model.notice!),
                    ),
                  if (model.error != null) _ErrorNotice(model: model),
                  Expanded(
                    child: items.isEmpty
                        ? Center(child: Text(context.l10n.uiNoContentYet))
                        : ListView.builder(
                            key: const ValueKey('personal-items'),
                            itemCount: items.length,
                            itemBuilder: (context, index) {
                              final item = items[index];
                              if (item['entity'] == 'lookup') {
                                return ListTile(
                                  title: Text(
                                    context.l10n.uiToConfirm(
                                      (item['request']['snapshot']['expression']['text'])
                                          .toString(),
                                    ),
                                  ),
                                  subtitle: Text(
                                    context
                                        .l10n
                                        .uiViewExplanationOrContinueClarifying,
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () => openLookup(item),
                                );
                              }
                              final meaning = item['entity'] == 'meaning';
                              final removed = item['status'] == 'removed';
                              return Card(
                                margin: const EdgeInsets.fromLTRB(
                                  16,
                                  4,
                                  16,
                                  12,
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      if (meaning)
                                        Text(
                                          item['expression'] as String,
                                          style: Theme.of(
                                            context,
                                          ).textTheme.titleLarge,
                                        ),
                                      SelectableText(
                                        item['snapshot']['sentence'] as String,
                                      ),
                                      if (meaning) ...[
                                        const SizedBox(height: 8),
                                        Text(item['sense'] as String),
                                        if (item['focus'] != null)
                                          Text(
                                            context.l10n.uiFocus(
                                              (item['focus']).toString(),
                                            ),
                                          ),
                                        Text(
                                          context.l10n.uiMeaningSource(
                                            (item['materialSource']).toString(),
                                          ),
                                        ),
                                        Text(
                                          context.l10n.uiSavedYouCanAddThisTo,
                                        ),
                                      ],
                                      if (item['snapshot']['source']['title'] !=
                                          '')
                                        Text(
                                          context.l10n.uiSource(
                                            (item['snapshot']['source']['title'])
                                                .toString(),
                                          ),
                                        ),
                                      if (item['sourceLink'] != null)
                                        SelectableText(
                                          item['sourceLink'] as String,
                                        ),
                                      Wrap(
                                        spacing: 8,
                                        children: [
                                          if (item['sourceLink'] != null)
                                            TextButton(
                                              onPressed: () =>
                                                  Clipboard.setData(
                                                    ClipboardData(
                                                      text:
                                                          item['sourceLink']
                                                              as String,
                                                    ),
                                                  ),
                                              child: Text(
                                                context.l10n.uiCopySourceLink,
                                              ),
                                            ),
                                          if (removed)
                                            OutlinedButton(
                                              onPressed: model.busy
                                                  ? null
                                                  : () => membership(
                                                      item,
                                                      item['entity'] as String,
                                                      true,
                                                    ),
                                              child: Text(
                                                context.l10n.uiRestore,
                                              ),
                                            )
                                          else ...[
                                            if (!meaning)
                                              FilledButton(
                                                onPressed: model.busy
                                                    ? null
                                                    : () =>
                                                          compose(intake: item),
                                                child: Text(
                                                  context
                                                      .l10n
                                                      .uiChooseExpressionAndMeaning,
                                                ),
                                              ),
                                            if (meaning &&
                                                item['materialId'] == null &&
                                                (item['bindingMetadata'] ==
                                                        null ||
                                                    item['bindingMetadata']['relation'] ==
                                                            'realizes' &&
                                                        item['bindingMetadata']['semanticCoverage'] ==
                                                            'exact'))
                                              FilledButton(
                                                onPressed: model.busy
                                                    ? null
                                                    : () => Navigator.of(context).push(
                                                        MaterialPageRoute(
                                                          builder: (_) =>
                                                              PreparationScreen(
                                                                model: model,
                                                                meaningId:
                                                                    item['id']
                                                                        as String,
                                                              ),
                                                        ),
                                                      ),
                                                child: Text(
                                                  item['addedToLearning'] ==
                                                          true
                                                      ? context
                                                            .l10n
                                                            .uiViewPreparation
                                                      : context
                                                            .l10n
                                                            .uiAddToLearning,
                                                ),
                                              ),
                                            if (meaning &&
                                                item['materialId'] != null)
                                              FilledButton(
                                                onPressed:
                                                    model.busy ||
                                                        item['materialId'] ==
                                                            null ||
                                                        item['addedToLearning'] ==
                                                            true
                                                    ? null
                                                    : () => model.personalAction(
                                                        {
                                                          'kind':
                                                              'add_to_learning',
                                                          'meaning_id':
                                                              item['id'],
                                                          'expected_revision':
                                                              item['revision'],
                                                        },
                                                      ),
                                                child: Text(
                                                  item['addedToLearning'] ==
                                                          true
                                                      ? context
                                                            .l10n
                                                            .uiAddedToLearning
                                                      : item['materialId'] ==
                                                            null
                                                      ? context
                                                            .l10n
                                                            .uiLearningMaterialNotPrepared
                                                      : context
                                                            .l10n
                                                            .uiAddToLearning,
                                                ),
                                              ),
                                            TextButton(
                                              onPressed: model.busy
                                                  ? null
                                                  : () => membership(
                                                      item,
                                                      item['entity'] as String,
                                                      false,
                                                    ),
                                              child: Text(
                                                context.l10n.uiRemove,
                                              ),
                                            ),
                                            if (meaning &&
                                                item['worldContext'] == null)
                                              TextButton(
                                                onPressed: model.busy
                                                    ? null
                                                    : () => compose(
                                                        copy:
                                                            item['snapshot']
                                                                as Map<
                                                                  String,
                                                                  dynamic
                                                                >,
                                                      ),
                                                child: Text(
                                                  context.l10n.uiSaveAsNew,
                                                ),
                                              ),
                                          ],
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
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

class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({required this.model});
  final LibraryViewModel model;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(12),
    child: Column(
      children: [
        Semantics(
          liveRegion: true,
          child: Text(
            model.error ?? '',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
        Wrap(
          spacing: 8,
          children: [
            TextButton(
              onPressed: model.busy ? null : model.retry,
              child: Text(context.l10n.uiRetrySaving),
            ),
            TextButton(
              onPressed: model.busy ? null : model.load,
              child: Text(context.l10n.uiReload),
            ),
          ],
        ),
      ],
    ),
  );
}

class _CaptureEditor extends StatefulWidget {
  const _CaptureEditor({required this.model, this.intake, this.copy});
  final LibraryViewModel model;
  final Map<String, dynamic>? intake;
  final Map<String, dynamic>? copy;
  @override
  State<_CaptureEditor> createState() => _CaptureEditorState();
}

class _CaptureEditorState extends State<_CaptureEditor> {
  late final TextEditingController contextText,
      expressionText,
      sourceUrl,
      sourceTitle;
  late final Map<String, dynamic> source;
  int? occurrence;
  String? materialId;
  LibraryViewModel get model => widget.model;
  @override
  void initState() {
    super.initState();
    final snapshot =
        widget.intake?['snapshot'] as Map<String, dynamic>? ?? widget.copy;
    contextText = TextEditingController(
      text: snapshot?['sentence'] as String? ?? '',
    );
    expressionText = TextEditingController(
      text: snapshot?['expression']?['text'] as String? ?? '',
    );
    source = Map<String, dynamic>.from(
      snapshot?['source'] as Map? ??
          {
            'url': null,
            'title': '',
            'capturedAt': DateTime.now().toUtc().toIso8601String(),
          },
    );
    if (widget.intake == null) {
      source['capturedAt'] = DateTime.now().toUtc().toIso8601String();
    }
    sourceUrl = TextEditingController(text: source['url'] as String? ?? '');
    sourceTitle = TextEditingController(text: source['title'] as String? ?? '');
    occurrence = snapshot?['expression']?['start'] as int?;
  }

  @override
  void dispose() {
    contextText.dispose();
    expressionText.dispose();
    sourceUrl.dispose();
    sourceTitle.dispose();
    super.dispose();
  }

  List<int> get positions {
    final text = contextText.text.runes.toList(),
        expression = expressionText.text.runes.toList();
    if (expression.isEmpty) return [];
    return [
      for (var i = 0; i + expression.length <= text.length; i++)
        if (String.fromCharCodes(text.sublist(i, i + expression.length)) ==
            expressionText.text)
          i,
    ];
  }

  Map<String, dynamic> get snapshot {
    final starts = positions;
    final start = starts.length == 1
        ? starts.first
        : starts.contains(occurrence)
        ? occurrence
        : null;
    return {
      'sentence': contextText.text,
      'language': 'en',
      'source': widget.intake != null
          ? source
          : {
              ...source,
              'url': sourceUrl.text.trim().isEmpty
                  ? null
                  : sourceUrl.text.trim(),
              'title': sourceTitle.text,
            },
      'expression': start == null
          ? null
          : {
              'text': expressionText.text,
              'start': start,
              'end': start + expressionText.text.runes.length,
            },
    };
  }

  Future<void> explain() async {
    final accepted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => SemanticResolutionScreen(
          model: model,
          capture: snapshot,
          intakeId: widget.intake?['id'] as String?,
        ),
      ),
    );
    if (mounted && accepted == true) Navigator.pop(context, true);
  }

  Future<void> save(bool accept) async {
    await model.personalAction(
      accept
          ? {
              'kind': 'accept',
              'snapshot': snapshot,
              'material_id': materialId,
              'intake_id': widget.intake?['id'],
              'focus': null,
              'consent': 'accept_context_expression_sense',
            }
          : {'kind': 'save_intake', 'snapshot': snapshot},
    );
    if (mounted && model.error == null) Navigator.pop(context, accept);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final starts = positions;
      final selected = snapshot['expression'] != null;
      final candidates = model.snapshot!.catalog
          .map((e) => e['material'] as Map<String, dynamic>)
          .where(
            (m) =>
                m['expression'].toString().trim().toLowerCase() ==
                expressionText.text.trim().toLowerCase(),
          )
          .toList();
      final available = !model.busy && model.error == null;
      return Scaffold(
        appBar: AppBar(
          title: Text(
            widget.intake == null
                ? context.l10n.uiSaveContent
                : context.l10n.uiConfirmThisContent,
          ),
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: ListView(
                key: const ValueKey('capture-scroll'),
                padding: const EdgeInsets.all(20),
                children: [
                  TextField(
                    key: const ValueKey('capture-context'),
                    controller: contextText,
                    readOnly: widget.intake != null,
                    decoration: InputDecoration(
                      labelText: context.l10n.uiEnglishContextRequired,
                    ),
                    minLines: 4,
                    maxLines: 8,
                    onChanged: (_) => setState(() {
                      occurrence = null;
                      materialId = null;
                    }),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    key: const ValueKey('capture-expression'),
                    controller: expressionText,
                    readOnly: widget.intake?['snapshot']?['expression'] != null,
                    decoration: InputDecoration(
                      labelText:
                          context.l10n.uiExpressionInContextOptionalForNow,
                    ),
                    onChanged: (_) => setState(() {
                      occurrence = null;
                      materialId = null;
                    }),
                  ),
                  if (expressionText.text.isNotEmpty && starts.isEmpty)
                    Text(context.l10n.uiUseTheExactWordingFromThe),
                  if (starts.length > 1) ...[
                    Text(context.l10n.uiChooseWhichOccurrenceYouWantTo),
                    RadioGroup<int>(
                      groupValue: occurrence,
                      onChanged: (v) {
                        if (available) setState(() => occurrence = v);
                      },
                      child: Column(
                        children: [
                          for (final (i, start) in starts.indexed)
                            RadioListTile<int>(
                              title: Text(
                                context.l10n.uiOccurrence(
                                  (i + 1).toString(),
                                  (expressionText.text).toString(),
                                ),
                              ),
                              value: start,
                              enabled: available,
                            ),
                        ],
                      ),
                    ),
                  ],
                  if (widget.intake == null) ...[
                    TextField(
                      key: const ValueKey('capture-source-title'),
                      controller: sourceTitle,
                      decoration: InputDecoration(
                        labelText: context.l10n.uiSourceNameOptional,
                      ),
                    ),
                    TextField(
                      key: const ValueKey('capture-source-url'),
                      controller: sourceUrl,
                      decoration: InputDecoration(
                        labelText: context.l10n.uiSourceLinkOptional,
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  if (widget.intake == null)
                    OutlinedButton(
                      onPressed: available && contextText.text.trim().isNotEmpty
                          ? () => save(false)
                          : null,
                      child: Text(context.l10n.uiSaveToInboxFirst),
                    ),
                  if (selected) ...[
                    OutlinedButton(
                      onPressed: available ? explain : null,
                      child: Text(context.l10n.uiExplainThisExpression),
                    ),
                    Text(
                      context.l10n.uiChooseTheMeaningInThisContext,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (candidates.isEmpty)
                      Text(context.l10n.uiNoMatchingMeaningInYourLibrary),
                    RadioGroup<String>(
                      groupValue: materialId,
                      onChanged: (v) {
                        if (available) setState(() => materialId = v);
                      },
                      child: Column(
                        children: [
                          for (final m in candidates)
                            RadioListTile<String>(
                              key: ValueKey('sense-${m['id']}'),
                              title: Text(m['sense'] as String),
                              subtitle: Text(
                                context.l10n.uiExampleSceneSource(
                                  (m['scene']).toString(),
                                  (m['source']).toString(),
                                ),
                              ),
                              value: m['id'] as String,
                              enabled: available,
                            ),
                        ],
                      ),
                    ),
                    if (candidates.isNotEmpty)
                      Text(context.l10n.uiCheckThatTheMeaningFitsYour),
                    if (candidates.any((m) => m['id'] == materialId))
                      FilledButton(
                        onPressed: available ? () => save(true) : null,
                        child: Text(context.l10n.uiConfirmMeaningAndSave),
                      ),
                  ],
                  if (model.notice != null)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(model.notice!),
                    ),
                  if (model.error != null) _ErrorNotice(model: model),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
