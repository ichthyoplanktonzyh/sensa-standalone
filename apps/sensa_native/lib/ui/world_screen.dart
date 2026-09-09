import '../l10n/interface_locale.dart';
import 'product_theme.dart';
import 'agent_screen.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uuid/uuid.dart';
import '../data/world_repository.dart';
import 'library_view_model.dart';
import 'world_model.dart';
import 'preparation_screen.dart';

class WorldScreen extends StatefulWidget {
  const WorldScreen({super.key, required this.library, this.repository});
  final LibraryViewModel library;
  final WorldRepository? repository;
  @override
  State<WorldScreen> createState() => _WorldScreenState();
}

class _WorldScreenState extends State<WorldScreen> {
  late final WorldModel model;
  int view = 0;
  String search = '';
  int section = 0;
  String? region;
  @override
  void initState() {
    super.initState();
    model = WorldModel(
      widget.repository ?? WorldRepository(widget.library.repository),
      agents: widget.library.agents,
    );
    model.addListener(changed);
    model.load();
  }

  void changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    model.removeListener(changed);
    model.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get meanings =>
      ((model.data?['meanings'] as List?) ?? []).cast<Map<String, dynamic>>();
  Future<void> edit([
    Map<String, dynamic>? draft,
    Map<String, dynamic>? copy,
  ]) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WorldEditor(model: model, record: draft, copy: copy),
      ),
    );
    await model.load();
    if (mounted) setState(() => section = 1);
  }

  Future<void> detail(Map<String, dynamic> m) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WorldDetail(
          model: model,
          library: widget.library,
          meaningId: m['id'],
        ),
      ),
    );
    await model.load();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = meanings
        .where(
          (m) =>
              (section == 2
                  ? m['status'] == 'removed'
                  : m['status'] == 'confirmed') &&
              '${m['sense']} ${m['expression']} ${m['snapshot']['sentence']}'
                  .toLowerCase()
                  .contains(search.toLowerCase()),
        )
        .toList();
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final m in filtered) {
      groups.putIfAbsent(m['contextAnchorId'], () => []).add(m);
    }
    final selected = groups.containsKey(region)
        ? region
        : groups.keys.firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.uiImagesAndConnections),
        actions: [
          IconButton(
            tooltip: context.l10n.uiConversationsAndResources,
            icon: const Icon(Icons.chat_outlined),
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) =>
                      AgentHistoryScreen(controller: widget.library.agents),
                ),
              );
              await model.load();
            },
          ),
        ],
      ),
      body: model.data == null
          ? Center(
              child: TextButton(
                onPressed: model.load,
                child: Text(model.error ?? context.l10n.uiLoadingYourLibrary),
              ),
            )
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Wrap(
                        spacing: 8,
                        children: [
                          FilledButton(
                            onPressed: model.busy ? null : () => edit(),
                            child: Text(context.l10n.uiNewTextAndImageCapture),
                          ),
                          for (final (i, label) in [
                            context.l10n.uiSaved,
                            context.l10n.uiDraftsAndCaptures,
                            context.l10n.uiRemoved,
                          ].indexed)
                            ChoiceChip(
                              label: Text(label),
                              selected: section == i,
                              onSelected: (_) => setState(() => section = i),
                            ),
                        ],
                      ),
                      TextField(
                        key: const ValueKey('world-search'),
                        decoration: InputDecoration(
                          labelText: context
                              .l10n
                              .uiSearchContextsMeaningsOrExpressions,
                        ),
                        onChanged: (v) => setState(() => search = v),
                      ),
                      if (section == 0)
                        Wrap(
                          spacing: 8,
                          children: [
                            for (var v = 0; v < 3; v++)
                              ChoiceChip(
                                label: Text(
                                  [
                                    context.l10n.uiList,
                                    context.l10n.uiExpand,
                                    context.l10n.uiGraph,
                                  ][v],
                                ),
                                selected: view == v,
                                onSelected: (_) => setState(() => view = v),
                              ),
                          ],
                        ),
                      if (model.error != null) Text(model.error!),
                    ],
                  ),
                ),
                Expanded(
                  child: section == 1
                      ? ListView(
                          key: const ValueKey('world-list'),
                          children: [
                            for (final d in model.data!['drafts'])
                              if (d['status'] != 'removed' &&
                                  jsonEncode(d['draft']).toLowerCase().contains(
                                    search.toLowerCase(),
                                  ))
                                ListTile(
                                  title: Text(
                                    d['draft']['familiarExpression']
                                            .toString()
                                            .isNotEmpty
                                        ? d['draft']['familiarExpression']
                                        : context.l10n.uiTextAndImageCaptureV(
                                            (d['revision']).toString(),
                                          ),
                                  ),
                                  subtitle: Text(
                                    context.l10n.uiBlocks(
                                      (d['status'] == 'accepted'
                                              ? context
                                                    .l10n
                                                    .uiConfirmedMoreMeaningsCanBeAdded
                                              : d['status'] == 'inbox'
                                              ? context
                                                    .l10n
                                                    .uiAwaitingConfirmation
                                              : context.l10n.uiEditDraft)
                                          .toString(),
                                      ((d['draft']['blocks'] as List).length)
                                          .toString(),
                                    ),
                                  ),
                                  onTap: () => edit(d),
                                ),
                            if ((model.data!['drafts'] as List).isEmpty)
                              ListTile(title: Text(context.l10n.uiNoDraftsYet)),
                          ],
                        )
                      : section == 0 && view == 2
                      ? Column(
                          children: [
                            if (selected != null)
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                ),
                                child: DropdownButtonFormField<String>(
                                  key: ValueKey(selected),
                                  initialValue: selected,
                                  isExpanded: true,
                                  items: [
                                    for (final key in groups.keys)
                                      DropdownMenuItem(
                                        value: key,
                                        child: Text(
                                          '${groups[key]!.first['snapshot']['sentence']}'
                                                  .isEmpty
                                              ? context.l10n.uiImageContext
                                              : groups[key]!
                                                    .first['snapshot']['sentence'],
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                  ],
                                  onChanged: (v) => setState(() => region = v),
                                ),
                              ),
                            Text(context.l10n.uiDragOrPinchToExploreSelect),
                            Expanded(
                              child: selected == null
                                  ? Center(
                                      child: Text(
                                        context
                                            .l10n
                                            .uiConfirmedConnectionsAppearHere,
                                      ),
                                    )
                                  : WorldGraph(
                                      items: groups[selected]!,
                                      onOpen: detail,
                                    ),
                            ),
                          ],
                        )
                      : ListView(
                          key: const ValueKey('world-list'),
                          padding: const EdgeInsets.all(16),
                          children: [
                            for (final m in filtered)
                              Card(
                                child: ListTile(
                                  title: Text(m['expression']),
                                  subtitle: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(m['sense']),
                                      if (view == 1) ...[
                                        Text(m['snapshot']['sentence']),
                                        if (m['focus'] != null)
                                          Text(
                                            context.l10n.uiFocus(
                                              (m['focus']).toString(),
                                            ),
                                          ),
                                        Text(
                                          m['bindingMetadata'] == null
                                              ? context
                                                    .l10n
                                                    .uiFromAConfirmedBinding
                                              : '${m['bindingMetadata']['relation']} · ${m['bindingMetadata']['semanticCoverage']}',
                                        ),
                                      ],
                                    ],
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () => detail(m),
                                ),
                              ),
                            if (section == 2)
                              for (final d in model.data!['drafts'])
                                if (d['status'] == 'removed')
                                  ListTile(
                                    title: Text(context.l10n.uiRemovedDrafts),
                                    trailing: TextButton(
                                      onPressed: () => model.act(
                                        () => {
                                          'kind': 'membership',
                                          'id': d['id'],
                                          'expected_revision': d['revision'],
                                          'active': true,
                                        },
                                      ),
                                      child: Text(context.l10n.uiRestoreDraft),
                                    ),
                                  ),
                            if (filtered.isEmpty)
                              ListTile(
                                title: Text(
                                  context.l10n.uiNoConfirmedConnectionsYet,
                                ),
                              ),
                          ],
                        ),
                ),
              ],
            ),
    );
  }
}

class WorldImage extends StatefulWidget {
  const WorldImage({super.key, required this.repository, required this.digest});
  final WorldRepository repository;
  final String digest;
  @override
  State<WorldImage> createState() => _WorldImageState();
}

class _WorldImageState extends State<WorldImage> {
  late Future<Uint8List> bytes;
  @override
  void initState() {
    super.initState();
    bytes = widget.repository.image(widget.digest);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List>(
    future: bytes,
    builder: (c, s) => s.hasData
        ? Image.memory(
            s.data!,
            height: 180,
            fit: BoxFit.contain,
            errorBuilder: (_, e, st) => Text(context.l10n.uiImageUnavailable),
          )
        : Text(
            s.hasError
                ? context.l10n.uiTheLocalImageIsUnavailableIts
                : context.l10n.uiLoadingImage,
          ),
  );
}

class WorldEditor extends StatefulWidget {
  const WorldEditor({super.key, required this.model, this.record, this.copy});
  final WorldModel model;
  final Map<String, dynamic>? record, copy;
  @override
  State<WorldEditor> createState() => _WorldEditorState();
}

class _WorldEditorState extends State<WorldEditor> with WidgetsBindingObserver {
  late String id;
  int revision = 0;
  late TextEditingController familiar;
  List<Map<String, dynamic>> blocks = [];
  final controllers = <String, TextEditingController>{};
  String? start;
  Timer? timer;
  bool closing = false, dirty = false, saving = false;
  String? localError;
  int generation = 0;
  WorldModel get model => widget.model;
  bool get frozen => widget.record?['status'] == 'accepted';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    id = widget.record?['id'] ?? const Uuid().v4();
    revision = widget.record?['revision'] ?? 0;
    final body =
        widget.record?['draft'] ??
        widget.copy ??
        {
          'familiarExpression': '',
          'blocks': [
            {'kind': 'text', 'id': const Uuid().v4(), 'text': ''},
          ],
          'startingPoint': null,
        };
    familiar = TextEditingController(text: body['familiarExpression']);
    start = body['startingPoint'];
    blocks = (jsonDecode(jsonEncode(body['blocks'])) as List)
        .cast<Map<String, dynamic>>();
    for (final b in blocks) {
      if (b['kind'] == 'text') {
        controllers[b['id']] = TextEditingController(text: b['text']);
      }
    }
  }

  Map<String, dynamic> body() => {
    'familiarExpression': familiar.text,
    'startingPoint': start,
    'blocks': [
      for (final b in blocks)
        {...b, if (b['kind'] == 'text') 'text': controllers[b['id']]!.text},
    ],
  };
  void change() {
    if (frozen) return;
    dirty = true;
    generation++;
    timer?.cancel();
    timer = Timer(const Duration(milliseconds: 450), () => save());
    if (mounted) setState(() {});
  }

  Future<void> save({bool submit = false}) async {
    timer?.cancel();
    if (frozen || (!dirty && revision > 0 && !submit)) return;
    if (saving) {
      await model.pending;
      await Future<void>.delayed(const Duration(milliseconds: 30));
      return save(submit: submit);
    }
    saving = true;
    final version = generation;
    final value = body();
    final expected = revision;
    await model.act(
      () => {
        'kind': 'save',
        'id': id,
        'expected_revision': expected,
        'draft': value,
        'submit': submit,
      },
    );
    if (model.error == null) {
      // Advance only our committed revision; never adopt another writer's later revision.
      revision = expected + 1;
      if (version == generation) dirty = false;
    }
    saving = false;
    if (mounted) setState(() => localError = model.error);
    if (dirty && version != generation && model.error == null) await save();
  }

  Future<void> exit() async {
    if (closing) return;
    closing = true;
    await save();
    closing = false;
    if (mounted && localError == null) Navigator.pop(context);
  }

  Future<void> image() async {
    try {
      final bytes = await model.repository.pickImage();
      if (bytes == null) return;
      final digest = await model.repository.putImage(bytes);
      if (mounted) {
        setState(
          () => blocks.add({
            'kind': 'image',
            'id': const Uuid().v4(),
            'digest': digest,
          }),
        );
        change();
      }
    } catch (_) {
      if (mounted) {
        setState(() => localError = context.l10n.uiChooseAPngJpegOrWebp);
      }
    }
  }

  Future<void> resolve() async {
    await save(submit: true);
    if (model.error != null || !mounted) return;
    final source = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.l10n.uiChooseAConfirmedMeaningAndExpression),
        content: SizedBox(
          width: 550,
          height: 400,
          child: ListView(
            children: [
              for (final item in model.data!['materials'])
                ListTile(
                  title: Text(item['material']['expression']),
                  subtitle: Text(
                    context.l10n.uiReference(
                      (item['material']['sense']).toString(),
                      (item['material']['scene']).toString(),
                    ),
                  ),
                  onTap: () => Navigator.pop(ctx, {
                    'kind': 'material',
                    'id': item['material']['id'],
                  }),
                ),
              for (final m in model.data!['meanings'])
                if (m['status'] == 'confirmed')
                  ListTile(
                    title: Text(m['expression']),
                    subtitle: Text(m['sense']),
                    onTap: () => Navigator.pop(ctx, {
                      'kind': 'meaning',
                      'id': m['id'],
                      'revision': m['revision'],
                    }),
                  ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(context.l10n.uiCancel),
          ),
        ],
      ),
    );
    if (source == null || !mounted) return;
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.l10n.uiConfirmThisMeaningInContext),
        content: Text(context.l10n.uiCheckThatTheMeaningAndEnglish),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(context.l10n.uiCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(context.l10n.uiConfirmAndSaveConnection),
          ),
        ],
      ),
    );
    if (yes != true) return;
    await model.act(
      () => {
        'kind': 'resolve',
        'id': id,
        'expected_revision': revision,
        'source': source,
        'consent': 'accept_context_expression_sense',
      },
    );
    if (mounted && model.error == null) {
      Navigator.pop(context);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && !frozen) unawaited(save());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    familiar.dispose();
    for (final c in controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (did, _) {
      if (!did) exit();
    },
    child: Scaffold(
      appBar: AppBar(
        title: Text(
          frozen
              ? context.l10n.uiConfirmedTextAndImageCapture
              : context.l10n.uiTextAndImageDraft,
        ),
        leading: BackButton(onPressed: exit),
      ),
      body: Readable(
        child: ListView(
          key: const ValueKey('world-editor-scroll'),
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              frozen
                  ? context.l10n.uiChooseAnotherMeaningOrMakeA
                  : saving
                  ? context.l10n.uiSaving
                  : dirty || revision == 0
                  ? context.l10n.uiNotSaved
                  : context.l10n.uiSavedOnThisDevice,
            ),
            if (localError != null) Text(localError!),
            TextField(
              key: const ValueKey('world-familiar'),
              controller: familiar,
              enabled: !frozen,
              decoration: InputDecoration(
                labelText:
                    context.l10n.uiFamiliarExpressionOrIntendedMeaningOptional,
              ),
              onChanged: (_) => change(),
            ),
            DropdownButtonFormField<String>(
              initialValue: start,
              decoration: InputDecoration(
                labelText: context.l10n.uiStartingPointOptional,
              ),
              items: [
                DropdownMenuItem(
                  value: 'from_experience',
                  child: Text(context.l10n.uiStartFromAContext),
                ),
                DropdownMenuItem(
                  value: 'from_expression',
                  child: Text(context.l10n.uiIFoundAnExpression),
                ),
                DropdownMenuItem(
                  value: 'from_sense',
                  child: Text(context.l10n.uiIHaveAMeaningToExpress),
                ),
              ],
              onChanged: frozen
                  ? null
                  : (v) {
                      start = v;
                      change();
                    },
            ),
            for (final (i, b) in blocks.indexed)
              Card(
                key: ValueKey(b['id']),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      if (b['kind'] == 'text')
                        TextField(
                          key: ValueKey('world-block-$i'),
                          controller: controllers[b['id']],
                          enabled: !frozen,
                          minLines: 3,
                          maxLines: 8,
                          decoration: InputDecoration(
                            labelText: context.l10n.uiContextText,
                          ),
                          onChanged: (_) => change(),
                        )
                      else
                        WorldImage(
                          repository: model.repository,
                          digest: b['digest'],
                        ),
                      if (!frozen)
                        Wrap(
                          children: [
                            IconButton(
                              tooltip: context.l10n.uiMoveBlockUp,
                              onPressed: i == 0
                                  ? null
                                  : () {
                                      final a = blocks.removeAt(i);
                                      blocks.insert(i - 1, a);
                                      change();
                                    },
                              icon: const Icon(Icons.arrow_upward),
                            ),
                            IconButton(
                              tooltip: context.l10n.uiRemoveBlock,
                              onPressed: () {
                                blocks.removeAt(i);
                                change();
                              },
                              icon: const Icon(Icons.remove_circle_outline),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            if (!frozen)
              Wrap(
                children: [
                  TextButton(
                    onPressed: () {
                      final bid = const Uuid().v4();
                      controllers[bid] = TextEditingController();
                      blocks.add({'kind': 'text', 'id': bid, 'text': ''});
                      change();
                    },
                    child: Text(context.l10n.uiAddText),
                  ),
                  TextButton(
                    onPressed: image,
                    child: Text(context.l10n.uiAddImage),
                  ),
                ],
              ),
            Text(context.l10n.uiWhenYouNeedHelpSendThis),
            OutlinedButton(
              onPressed: saving
                  ? null
                  : () async {
                      await save(submit: true);
                      if (!context.mounted || model.error != null) return;
                      await Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => AgentScreen(
                            controller: model.agents,
                            source: {
                              'kind': 'world',
                              'draft_id': id,
                              'revision': revision,
                            },
                          ),
                        ),
                      );
                      await model.load();
                      if (context.mounted &&
                          (model.data!['drafts'] as List).any(
                            (d) => d['id'] == id && d['status'] == 'accepted',
                          )) {
                        Navigator.pop(context);
                      }
                    },
              child: Text(context.l10n.uiTalkToALanguageTeacher),
            ),
            if (!frozen)
              FilledButton(
                onPressed: saving
                    ? null
                    : () async {
                        await save(submit: true);
                        if (context.mounted && model.error == null) {
                          Navigator.pop(context);
                        }
                      },
                child: Text(context.l10n.uiSaveForConfirmation),
              ),
            FilledButton(
              onPressed: saving ? null : resolve,
              child: Text(
                frozen
                    ? context.l10n.uiConfirmAnotherMeaning
                    : context.l10n.uiChooseAndConfirmAnExistingMeaning,
              ),
            ),
            if (frozen || localError != null)
              TextButton(
                onPressed: () async {
                  await Navigator.of(context).pushReplacement(
                    MaterialPageRoute<void>(
                      builder: (_) => WorldEditor(model: model, copy: body()),
                    ),
                  );
                },
                child: Text(context.l10n.uiCopyToNewDraft),
              ),
            TextButton(
              onPressed: () async {
                await save();
                if (model.error != null) return;
                await model.act(
                  () => {
                    'kind': 'membership',
                    'id': id,
                    'expected_revision': revision,
                    'active': false,
                  },
                );
                if (context.mounted && model.error == null) {
                  Navigator.pop(context);
                }
              },
              child: Text(
                frozen
                    ? context.l10n.uiRemoveCaptureKeepConfirmedContent
                    : context.l10n.uiRemoveThisDraft,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class WorldDetail extends StatelessWidget {
  const WorldDetail({
    super.key,
    required this.model,
    required this.library,
    required this.meaningId,
  });
  final WorldModel model;
  final LibraryViewModel library;
  final String meaningId;
  Future<void> bind(BuildContext context, Map<String, dynamic> m) async {
    final surface = TextEditingController(text: m['expression']);
    String type = m['proposal']['expression']['type'];
    String? relation, coverage, failure;
    bool submitting = false;
    await showDialog<void>(
      barrierDismissible: false,
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(context.l10n.uiAddAnExpressionForThisMeaning),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(m['sense']),
                if (failure != null) Text(failure!),
                Text(context.l10n.uiConfirmTheNewExpressionBeforeSaving),
                TextField(
                  key: const ValueKey('binding-surface'),
                  controller: surface,
                  decoration: InputDecoration(
                    labelText: context.l10n.uiEnglishExpression,
                  ),
                ),
                DropdownButtonFormField<String>(
                  initialValue: type,
                  decoration: InputDecoration(
                    labelText: context.l10n.uiExpressionType,
                  ),
                  items: [
                    for (final entry in {
                      'word': context.l10n.uiWord,
                      'phrase': context.l10n.uiPhrase,
                      'construction': context.l10n.uiConstruction,
                      'sentence': context.l10n.uiSentence,
                      'utterance_strategy': context.l10n.uiExpressionStrategy,
                    }.entries)
                      DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                  ],
                  onChanged: (v) => set(() => type = v!),
                ),
                DropdownButtonFormField<String>(
                  key: const ValueKey('binding-relation'),
                  decoration: InputDecoration(
                    labelText: context.l10n.uiRelationToThisMeaning,
                  ),
                  items: [
                    for (final entry in {
                      'realizes': context.l10n.uiExpressesThisMeaning,
                      'approximates': context.l10n.uiApproximatesThisMeaning,
                      'evokes': context.l10n.uiEvokesAnAssociation,
                    }.entries)
                      DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                  ],
                  onChanged: (v) => set(() => relation = v),
                ),
                DropdownButtonFormField<String>(
                  key: const ValueKey('binding-coverage'),
                  decoration: InputDecoration(
                    labelText: context.l10n.uiMeaningCoverage,
                  ),
                  items: [
                    for (final entry in {
                      'exact': context.l10n.uiExact,
                      'broader': context.l10n.uiBroader,
                      'narrower': context.l10n.uiNarrower,
                      'overlapping': context.l10n.uiPartialOverlap,
                    }.entries)
                      DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                  ],
                  onChanged: (v) => set(() => coverage = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: submitting ? null : () => Navigator.pop(ctx),
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              onPressed: submitting || relation == null || coverage == null
                  ? null
                  : () async {
                      set(() => submitting = true);
                      final action = {
                        'kind': 'bind',
                        'meaning_id': m['id'],
                        'expected_revision': m['revision'],
                        'surface': surface.text,
                        'expression_type': type,
                        'relation': relation,
                        'coverage': coverage,
                        'consent': 'confirm_expression_binding',
                      };
                      await model.act(() => action);
                      if (!ctx.mounted) return;
                      if (model.error == null) {
                        Navigator.pop(ctx);
                      } else {
                        set(() {
                          submitting = false;
                          failure = model.error;
                        });
                      }
                    },
              child: Text(context.l10n.uiConfirmExpressionConnection),
            ),
          ],
        ),
      ),
    );
    // The dialog route may still render its reverse transition.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    surface.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final m = (model.data!['meanings'] as List)
          .cast<Map<String, dynamic>>()
          .where((m) => m['id'] == meaningId)
          .firstOrNull;
      if (m == null) {
        return Scaffold(
          appBar: AppBar(),
          body: Text(context.l10n.uiContentUnavailableGoBackAndRetry),
        );
      }
      final draft = m['worldContext']?['draft'];
      final binding = m['bindingMetadata'];
      final supported =
          binding == null ||
          (binding['relation'] == 'realizes' &&
              binding['semanticCoverage'] == 'exact');
      final siblings = (model.data!['meanings'] as List).where(
        (v) =>
            v['status'] == 'confirmed' &&
            v['contextAnchorId'] == m['contextAnchorId'] &&
            v['id'] != m['id'],
      );
      return Scaffold(
        appBar: AppBar(title: Text(context.l10n.uiContextAndExpression)),
        body: Readable(
          child: ListView(
            key: const ValueKey('world-detail-scroll'),
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                m['expression'],
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              Text(m['sense'], style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              Text(context.l10n.uiContext),
              if (draft != null) ...[
                for (final b in draft['blocks'])
                  if (b['kind'] == 'text')
                    SelectableText(b['text'])
                  else
                    WorldImage(
                      repository: model.repository,
                      digest: b['digest'],
                    ),
                if (draft['familiarExpression'] != '')
                  SelectableText(draft['familiarExpression']),
              ] else
                SelectableText(m['snapshot']['sentence']),
              if (m['focus'] != null)
                Text(context.l10n.uiFocus((m['focus']).toString())),
              if (m['sourceLink'] != null)
                TextButton(
                  onPressed: () =>
                      Clipboard.setData(ClipboardData(text: m['sourceLink'])),
                  child: Text(context.l10n.uiCopySourceLink),
                ),
              Text(
                context.l10n.uiSource(
                  (m['materialSource'] ?? context.l10n.uiConfirmedByYou)
                      .toString(),
                ),
              ),
              Text(
                binding == null
                    ? context.l10n.uiConfirmedExpressionConnection
                    : '${binding['type']} · ${binding['relation']} · ${binding['semanticCoverage']}',
              ),
              ExpansionTile(
                key: const PageStorageKey('world_screen-detail-1'),
                title: Text(context.l10n.uiVersionsAndConfirmationSource),
                children: [
                  SelectableText(
                    context.l10n.uiContextMeaningVersionExpressionVersion(
                      (m['contextAnchorId']).toString(),
                      (m['senseVersionId']).toString(),
                      (m['bindingVersionId']).toString(),
                      (jsonEncode(m['resolutionProvenance'])).toString(),
                    ),
                  ),
                ],
              ),
              if (model.error != null) Text(model.error!),
              if (m['status'] == 'removed')
                FilledButton(
                  onPressed: model.busy
                      ? null
                      : () => model.act(
                          () => {
                            'kind': 'meaning_membership',
                            'meaning_id': meaningId,
                            'expected_revision': m['revision'],
                            'active': true,
                          },
                        ),
                  child: Text(context.l10n.uiRestoreThisConnection),
                )
              else ...[
                if (!supported)
                  Text(
                    context
                        .l10n
                        .uiConnectionSavedLearningResourcesCurrentlyRequire,
                  ),
                FilledButton(
                  onPressed:
                      model.busy || !supported || m['addedToLearning'] == true
                      ? null
                      : () async {
                          await library.load();
                          if (!context.mounted) return;
                          if (m['materialId'] == null) {
                            await Navigator.push(
                              context,
                              MaterialPageRoute<void>(
                                builder: (_) => PreparationScreen(
                                  model: library,
                                  meaningId: meaningId,
                                ),
                              ),
                            );
                          } else {
                            await library.personalAction({
                              'kind': 'add_to_learning',
                              'meaning_id': meaningId,
                              'expected_revision': m['revision'],
                            });
                            if (context.mounted && library.error != null) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(library.error!)),
                              );
                            }
                          }
                          await model.load();
                        },
                  child: Text(
                    m['addedToLearning'] == true
                        ? context.l10n.uiAddedToLearning
                        : context.l10n.uiAddToLearning390,
                  ),
                ),
                if (m['proposal'] != null)
                  OutlinedButton(
                    onPressed: model.busy ? null : () => bind(context, m),
                    child: Text(context.l10n.uiAddAnExpression),
                  )
                else
                  Text(context.l10n.uiThisOlderCaptureLacksTheFull),
                if (draft != null) ...[
                  OutlinedButton(
                    onPressed: model.busy
                        ? null
                        : () async {
                            await Navigator.push(
                              context,
                              MaterialPageRoute<void>(
                                builder: (_) => WorldEditor(
                                  model: model,
                                  copy: Map<String, dynamic>.from(draft),
                                ),
                              ),
                            );
                            await model.load();
                          },
                    child: Text(context.l10n.uiCopyContextToEdit),
                  ),
                  for (final d in model.data!['drafts'])
                    if (d['id'] == m['worldContext']['id'] &&
                        d['status'] == 'accepted')
                      OutlinedButton(
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                WorldEditor(model: model, record: d),
                          ),
                        ),
                        child: Text(context.l10n.uiAddAMeaningToThisContext),
                      ),
                ],
                TextButton(
                  onPressed: model.busy
                      ? null
                      : () => model.act(
                          () => {
                            'kind': 'meaning_membership',
                            'meaning_id': meaningId,
                            'expected_revision': m['revision'],
                            'active': false,
                          },
                        ),
                  child: Text(context.l10n.uiRemoveThisConnection),
                ),
              ],
              if (siblings.isNotEmpty)
                Text(context.l10n.uiOtherConnectionsInThisContext),
              for (final other in siblings)
                ListTile(
                  title: Text(other['expression']),
                  subtitle: Text(other['sense']),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) => WorldDetail(
                        model: model,
                        library: library,
                        meaningId: other['id'],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    },
  );
}

class WorldGraph extends StatelessWidget {
  const WorldGraph({super.key, required this.items, required this.onOpen});
  final List<Map<String, dynamic>> items;
  final void Function(Map<String, dynamic>) onOpen;
  @override
  Widget build(BuildContext context) {
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final m in items) {
      groups.putIfAbsent(m['senseVersionId'], () => []).add(m);
    }
    final height = items.length * 160.0 + 40;
    final nodes = <Widget>[];
    final lines = <({Offset start, Offset end})>[];
    final center = Offset(140, height / 2);
    double row = 20;
    Widget node(
      String label,
      String text,
      double x,
      double y,
      double width,
      Map<String, dynamic> m,
    ) => Positioned(
      left: x,
      top: y,
      width: width,
      height: 130,
      child: Card(
        child: InkWell(
          onTap: () => onOpen(m),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 8),
                Expanded(
                  child: Text(
                    text,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    nodes.add(
      node(
        context.l10n.uiContext,
        items.first['snapshot']['sentence'].toString().isEmpty
            ? context.l10n.uiImageContext
            : items.first['snapshot']['sentence'],
        20,
        center.dy - 65,
        240,
        items.first,
      ),
    );
    for (final group in groups.values) {
      final y = row + (group.length - 1) * 80;
      lines.add((start: Offset(260, center.dy), end: Offset(340, y + 65)));
      nodes.add(
        node(
          group.first['focus'] == null
              ? context.l10n.uiMeaning
              : context.l10n.uiMeaning398((group.first['focus']).toString()),
          group.first['sense'],
          340,
          y,
          240,
          group.first,
        ),
      );
      for (final m in group) {
        lines.add((start: Offset(580, y + 65), end: Offset(660, row + 65)));
        nodes.add(
          node(context.l10n.uiExpression, m['expression'], 660, row, 220, m),
        );
        row += 160;
      }
    }
    return InteractiveViewer(
      constrained: false,
      boundaryMargin: const EdgeInsets.all(60),
      minScale: 0.25,
      maxScale: 2,
      child: SizedBox(
        width: 910,
        height: height,
        child: CustomPaint(
          painter: _WorldEdges(lines, Theme.of(context).colorScheme.outline),
          child: Stack(children: nodes),
        ),
      ),
    );
  }
}

class _WorldEdges extends CustomPainter {
  _WorldEdges(this.lines, this.color);
  final List<({Offset start, Offset end})> lines;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color
      ..strokeWidth = 2;
    for (final line in lines) {
      canvas.drawLine(line.start, line.end, p);
    }
  }

  @override
  bool shouldRepaint(covariant _WorldEdges old) =>
      old.lines != lines || old.color != color;
}
