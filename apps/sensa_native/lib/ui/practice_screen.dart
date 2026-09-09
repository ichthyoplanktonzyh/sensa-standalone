import '../l10n/interface_locale.dart';
import 'package:flutter/material.dart';
import '../data/practice_repository.dart';
import 'library_view_model.dart';
import 'practice_model.dart';
import 'youglish_view.dart';
import 'product_theme.dart';

class PracticeScreen extends StatefulWidget {
  const PracticeScreen({
    super.key,
    required this.library,
    this.fixtureScript,
    this.onExit,
  });
  final LibraryViewModel library;
  final String? fixtureScript;
  final VoidCallback? onExit;
  @override
  State<PracticeScreen> createState() => _PracticeScreenState();
}

class _PracticeScreenState extends State<PracticeScreen> {
  late final PracticeModel model;
  late final brief = TextEditingController(
    text: context.l10n.uiHearHowDifferentSpeakersUseThis,
  );
  bool playerOpen = false, closing = false;
  int generation = 0;
  String status = 'loading';
  Map<String, dynamic> observation = {};
  Future<void> Function(String)? player;
  Future<void> events = Future.value();
  @override
  void initState() {
    super.initState();
    model = PracticeModel(PracticeRepository(widget.library.repository.path));
    model.addListener(changed);
    model.load();
  }

  void changed() {
    final savedBrief = model.session?['snapshot']['brief'] as String?;
    if (savedBrief != null && brief.text != savedBrief) brief.text = savedBrief;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    player?.call('pause');
    model.removeListener(changed);
    model.dispose();
    brief.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get targets =>
      ((model.session?['snapshot']['expressions'] ??
                      model.data?['catalog']['targets'])
                  as List? ??
              [])
          .cast<Map<String, dynamic>>();
  Map<String, dynamic> get state =>
      model.session?['state'] as Map<String, dynamic>? ??
      {'index': 0, 'accent': 'all', 'rate': 1.0};
  Future<void> provider(Map<String, dynamic> e, int token) {
    events = events
        .then((_) async {
          if (!mounted || !playerOpen || closing || token != generation) return;
          final total = (e['total'] as num?)?.toInt() ?? 0;
          final value = {
            'kind': 'provider',
            'playing': e['playing'],
            'status': e['status'],
            'total': total.clamp(0, 10000000),
            'caption': (e['caption'] as String?)?.substring(
              0,
              ((e['caption'] as String?)?.length ?? 0).clamp(0, 4000),
            ),
            'video': e['video']?.toString(),
            'occurrence': (e['occurrence'] as num?)?.toInt(),
          };
          if (model.session == null && e['status'] == 'ready' && total > 0) {
            await model.act(
              () => {
                'kind': 'start',
                'brief': brief.text,
                'provider_available': true,
              },
            );
          }
          if (model.session != null) await model.turn(value);
          if (mounted && playerOpen && token == generation) {
            setState(() {
              status = e['status'] as String;
              observation = e;
            });
          }
        })
        .catchError((_) {
          if (mounted) setState(() => status = 'error');
        });
    return events;
  }

  Future<void> controls(String kind) async {
    await model.turn({'kind': kind});
    if (model.error == null) await player?.call(kind);
  }

  Future<void> changeQuery(Map<String, dynamic> event) async {
    closing = true;
    await player?.call('pause');
    await events;
    await model.turn(event);
    if (mounted) {
      setState(() {
        generation++;
        closing = false;
        status = 'loading';
        observation = {};
      });
    }
  }

  Future<void> closePlayer() async {
    closing = true;
    await player?.call('pause');
    await events;
    if (model.session != null) await model.turn({'kind': 'pause'});
    if (mounted) {
      setState(() {
        playerOpen = false;
        generation++;
      });
    }
  }

  Future<void> select() async {
    final data = model.data!['catalog'];
    final sources = (data['sources'] as List).cast<Map<String, dynamic>>();
    String source = data['selection']['sourceId'];
    final chosen = ((data['selection']['targetIds'] as List?) ?? [])
        .cast<String>()
        .toSet();
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(context.l10n.uiPracticeScope),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: source,
                    items: [
                      DropdownMenuItem(
                        value: 'current_study',
                        child: Text(context.l10n.uiCurrentLearningScope),
                      ),
                      DropdownMenuItem(
                        value: 'personal_semantic_world',
                        child: Text(context.l10n.uiMySemanticWorld),
                      ),
                    ],
                    onChanged: (v) => set(() => source = v!),
                  ),
                  if (source == 'current_study')
                    Text(
                      context.l10n.uiTargets(
                        (sources[0]['targets'] as List).length,
                      ),
                    ),
                  if (source == 'personal_semantic_world') ...[
                    Text(context.l10n.uiPracticeSavedMeaningsWithoutAddingThem),
                    TextButton(
                      onPressed: () => set(() {
                        final all = (sources[1]['targets'] as List)
                            .map((t) => t['targetId'] as String)
                            .toSet();
                        chosen.length == all.length
                            ? chosen.clear()
                            : chosen.addAll(all);
                      }),
                      child: Text(context.l10n.uiSelectAllClear),
                    ),
                    for (final t in sources[1]['targets'])
                      CheckboxListTile(
                        value: chosen.contains(t['targetId']),
                        title: Text(t['expression']),
                        subtitle: Text('${t['sense']}\n${t['context']}'),
                        onChanged: (v) => set(
                          () => v == true
                              ? chosen.add(t['targetId'])
                              : chosen.remove(t['targetId']),
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              onPressed: source == 'personal_semantic_world' && chosen.isEmpty
                  ? null
                  : () => Navigator.pop(ctx, {
                      'sourceId': source,
                      if (source == 'personal_semantic_world')
                        'targetIds': chosen.toList(),
                    }),
              child: Text(context.l10n.uiUseThisScope),
            ),
          ],
        ),
      ),
    );
    if (result != null) {
      await model.act(() => {'kind': 'select', 'selection': result});
    }
  }

  void open() {
    setState(() {
      closing = false;
      playerOpen = true;
      generation++;
      status = 'loading';
      observation = {};
    });
  }

  @override
  Widget build(BuildContext context) {
    final ready = status == 'ready' && !model.busy && model.error == null;
    final current = targets.isEmpty
        ? null
        : targets[(state['index'] as int).clamp(0, targets.length - 1)];
    final token = generation;
    return PopScope(
      canPop: !playerOpen && widget.onExit == null,
      onPopInvokedWithResult: (p, _) async {
        if (!p) {
          if (playerOpen) {
            await closePlayer();
          } else {
            widget.onExit?.call();
          }
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            playerOpen
                ? context.l10n.uiAuthenticListening
                : context.l10n.uiFreePractice,
          ),
          leading: BackButton(
            onPressed: () async {
              if (playerOpen) {
                await closePlayer();
              } else if (widget.onExit != null) {
                widget.onExit!();
              } else if (context.mounted) {
                Navigator.pop(context);
              }
            },
          ),
        ),
        body: model.data == null
            ? Center(
                child: model.error == null
                    ? const CircularProgressIndicator()
                    : TextButton(
                        onPressed: model.load,
                        child: Text(
                          context.l10n.uiTapToRetry((model.error).toString()),
                        ),
                      ),
              )
            : Readable(
                child: ListView(
                  key: const ValueKey('practice-scroll'),
                  padding: const EdgeInsets.all(20),
                  children: [
                    Text(context.l10n.uiPracticeIsSeparateFromYourLearning),
                    if (model.error != null) ...[
                      Text(model.error!),
                      TextButton(
                        onPressed: model.load,
                        child: Text(context.l10n.uiReloadPractice),
                      ),
                    ],
                    if (!playerOpen) ...[
                      TextButton(
                        onPressed: model.busy ? null : select,
                        child: Text(context.l10n.uiChoosePracticeScope),
                      ),
                      Text(
                        context.l10n.uiTargetsExpressions(
                          ((model.data!['catalog']['targets'] as List).length)
                              .toString(),
                          ((model.data!['catalog']['targets'] as List)
                                  .map((t) => t['expression'])
                                  .toSet()
                                  .length)
                              .toString(),
                        ),
                      ),
                      for (final t
                          in (model.data!['catalog']['targets'] as List))
                        ListTile(
                          title: Text(t['expression']),
                          subtitle: Text(t['sense']),
                        ),
                      if ((model.data!['catalog']['blockedTargets'] as List)
                          .isNotEmpty)
                        Text(
                          context
                              .l10n
                              .uiSomeExpressionsWithAmbiguousPronunciationWere,
                        ),
                      TextField(
                        key: const ValueKey('practice-brief'),
                        controller: brief,
                        enabled: model.session == null,
                        maxLength: 500,
                        decoration: InputDecoration(
                          labelText: context.l10n.uiWhatWouldYouLikeToPractice,
                        ),
                      ),
                      Text(context.l10n.uiListenToRealSpeech),
                      Text(context.l10n.uiYouglishRequiresAnInternetConnection),
                      FilledButton(
                        onPressed: model.busy || targets.isEmpty ? null : open,
                        child: Text(
                          model.session == null
                              ? context.l10n.uiStartListening
                              : context.l10n.uiContinueListening,
                        ),
                      ),
                      if (model.session != null) ...[
                        Text(
                          context.l10n.uiResume(
                            (model.session!['snapshot']['brief']).toString(),
                          ),
                        ),
                        TextButton(
                          onPressed: model.busy
                              ? null
                              : () => model.act(
                                  () => {
                                    'kind': 'end',
                                    'session_id': model.session!['id'],
                                    'abandoned': true,
                                  },
                                ),
                          child: Text(context.l10n.uiAbandonThisPractice),
                        ),
                      ],
                      const Divider(),
                      Text(context.l10n.uiPracticeHistory),
                      for (final h in model.data!['history'])
                        ListTile(
                          title: Text(h['snapshot']['brief']),
                          subtitle: Text(
                            context.l10n.uiInteractions(
                              (h['status'] == 'active'
                                      ? context.l10n.uiInProgress
                                      : h['status'] == 'completed'
                                      ? context.l10n.uiEnded
                                      : context.l10n.uiAbandoned)
                                  .toString(),
                              (h['turnCount']).toString(),
                            ),
                          ),
                        ),
                    ] else if (current != null) ...[
                      Text(context.l10n.uiYouglishSearchesByExpressionSoClips),
                      Text(
                        context.l10n.uiExpressionsInThisScope(
                          (targets.length).toString(),
                        ),
                      ),
                      DropdownButtonFormField<int>(
                        isExpanded: true,
                        key: ValueKey('expression-${state['index']}'),
                        initialValue: state['index'] as int,
                        items: [
                          for (var i = 0; i < targets.length; i++)
                            DropdownMenuItem(
                              value: i,
                              child: Text(targets[i]['expression']),
                            ),
                        ],
                        onChanged: model.busy || model.session == null
                            ? null
                            : (i) async {
                                await changeQuery({
                                  'kind': 'navigate',
                                  'index': i,
                                });
                                if (mounted) setState(() => status = 'loading');
                              },
                      ),
                      Wrap(
                        spacing: 4,
                        children: [
                          for (final accent in [
                            'all',
                            'us',
                            'uk',
                            'aus',
                            'ca',
                            'ie',
                          ])
                            ChoiceChip(
                              label: Text(
                                {
                                  'all': context.l10n.uiAllAccents,
                                  'us': context.l10n.uiUs,
                                  'uk': context.l10n.uiUk,
                                  'aus': context.l10n.uiAustralia,
                                  'ca': context.l10n.uiCanada,
                                  'ie': context.l10n.uiIreland,
                                }[accent]!,
                              ),
                              selected: state['accent'] == accent,
                              onSelected: model.busy || model.session == null
                                  ? null
                                  : (_) async {
                                      await changeQuery({
                                        'kind': 'accent',
                                        'accent': accent,
                                      });
                                      if (mounted) {
                                        setState(() => status = 'loading');
                                      }
                                    },
                            ),
                        ],
                      ),
                      SizedBox(
                        height: 240,
                        child: YouglishView(
                          key: ValueKey(
                            '$generation-${state['index']}-${state['accent']}',
                          ),
                          expression: current['expression'],
                          accent: state['accent'],
                          rate: (state['rate'] as num).toDouble(),
                          fixtureScript: widget.fixtureScript,
                          onEvent: (e) {
                            if (current['expression'] ==
                                targets[(state['index']
                                    as int)]['expression']) {
                              provider(e, token);
                            }
                          },
                          onController: (c) => player = c,
                        ),
                      ),
                      Text(
                        status == 'ready'
                            ? context.l10n.uiFoundClips(
                                (observation['total'] ?? 0).toString(),
                              )
                            : status == 'error'
                            ? context.l10n.uiCouldNotConnectToYouglishCheck
                            : status == 'empty'
                            ? context.l10n.uiNoClipsFoundForThisExpression
                            : context.l10n.uiConnectingToYouglish,
                      ),
                      if (status == 'error' || status == 'empty')
                        TextButton(
                          onPressed: open,
                          child: Text(context.l10n.uiRetryConnection),
                        ),
                      if (observation['playing'] == true)
                        Text(context.l10n.uiPlaying),
                      if (observation['video'] != null)
                        Text(
                          context.l10n.uiYouglishClip(
                            (observation['video']).toString(),
                          ),
                        ),
                      if (observation['occurrence'] != null)
                        Text(
                          context.l10n.uiClip(
                            (observation['occurrence']).toString(),
                          ),
                        ),
                      Text(
                        (observation['caption'] as String? ??
                                context.l10n.uiNoSubtitles)
                            .replaceAll('[[[', '')
                            .replaceAll(']]]', ''),
                      ),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final pair in [
                            ('previous', context.l10n.uiPreviousClip),
                            ('play', context.l10n.uiPlay),
                            ('pause', context.l10n.uiPause),
                            ('replay', context.l10n.uiReplay),
                            ('next', context.l10n.uiNextClip),
                          ])
                            OutlinedButton(
                              onPressed: ready ? () => controls(pair.$1) : null,
                              child: Text(pair.$2),
                            ),
                        ],
                      ),
                      Wrap(
                        spacing: 4,
                        children: [
                          for (final rate in [0.5, 0.75, 1.0, 1.25])
                            ChoiceChip(
                              label: Text('$rate×'),
                              selected: state['rate'] == rate,
                              onSelected: ready
                                  ? (_) => model.turn({
                                      'kind': 'speed',
                                      'rate': rate,
                                    })
                                  : null,
                            ),
                        ],
                      ),
                      TextButton(
                        onPressed: closePlayer,
                        child: Text(context.l10n.uiSaveAndReturnToPractice),
                      ),
                      FilledButton(
                        onPressed: model.busy || model.session == null
                            ? null
                            : () async {
                                closing = true;
                                await player?.call('pause');
                                await events;
                                await model.act(
                                  () => {
                                    'kind': 'end',
                                    'session_id': model.session!['id'],
                                    'abandoned': false,
                                  },
                                );
                                if (mounted) {
                                  setState(() {
                                    playerOpen = false;
                                    generation++;
                                  });
                                }
                              },
                        child: Text(context.l10n.uiEndPractice),
                      ),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}
