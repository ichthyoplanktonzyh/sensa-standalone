import '../l10n/interface_locale.dart';
import 'package:flutter/material.dart';
import '../data/practice_repository.dart';
import 'library_view_model.dart';
import 'practice_model.dart';
import 'youglish_view.dart';
import 'product_theme.dart';
import 'practice_home.dart';
import 'practice_scope_screen.dart';

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
  final scroll = ScrollController();
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
    scroll.dispose();
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
        if (scroll.hasClients) scroll.jumpTo(0);
        generation++;
      });
    }
  }

  Future<void> select() async {
    final result = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(
        builder: (_) => PracticeScopeScreen(catalog: model.data!['catalog']),
      ),
    );
    if (result != null) {
      await model.act(() => {'kind': 'select', 'selection': result});
    }
  }

  void open() {
    if (scroll.hasClients) scroll.jumpTo(0);
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
                  controller: scroll,
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
                      PracticeHome(
                        data: model.data!,
                        busy: model.busy || model.error != null,
                        brief: brief,
                        onScope: select,
                        onStart: open,
                        onAbandon: () => model.act(
                          () => {
                            'kind': 'end',
                            'session_id': model.session!['id'],
                            'abandoned': true,
                          },
                        ),
                      ),
                    ] else if (current != null) ...[
                      Text(
                        key: const ValueKey('practice-provider-status'),
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
                      AspectRatio(
                        key: const ValueKey('practice-video'),
                        aspectRatio: 16 / 9,
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
                      if (observation['occurrence'] != null)
                        Text(
                          context.l10n.uiClip('${observation['occurrence']}'),
                        ),
                      if (observation['video'] != null)
                        Text(
                          context.l10n.uiYouglishClip(
                            '${observation['video']}',
                          ),
                        ),
                      const SizedBox(height: 16),
                      ProductPanel(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              context.l10n.practiceCaptions,
                              style: Theme.of(context).textTheme.labelLarge,
                            ),
                            const SizedBox(height: 12),
                            PracticeCaption(
                              caption:
                                  observation['caption'] as String? ??
                                  context.l10n.uiNoSubtitles,
                            ),
                            const SizedBox(height: 20),
                            Wrap(
                              alignment: WrapAlignment.center,
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                OutlinedButton.icon(
                                  onPressed: ready
                                      ? () => controls('previous')
                                      : null,
                                  icon: const Icon(Icons.skip_previous),
                                  label: Text(context.l10n.uiPreviousClip),
                                ),
                                FilledButton.icon(
                                  onPressed: ready
                                      ? () => controls(
                                          observation['playing'] == true
                                              ? 'pause'
                                              : 'play',
                                        )
                                      : null,
                                  icon: Icon(
                                    observation['playing'] == true
                                        ? Icons.pause
                                        : Icons.play_arrow,
                                  ),
                                  label: Text(
                                    observation['playing'] == true
                                        ? context.l10n.uiPause
                                        : context.l10n.uiPlay,
                                  ),
                                ),
                                OutlinedButton.icon(
                                  onPressed: ready
                                      ? () => controls('next')
                                      : null,
                                  icon: const Icon(Icons.skip_next),
                                  label: Text(context.l10n.uiNextClip),
                                ),
                                TextButton.icon(
                                  onPressed: ready
                                      ? () => controls('replay')
                                      : null,
                                  icon: const Icon(Icons.replay),
                                  label: Text(context.l10n.uiReplay),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
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
                                    if (scroll.hasClients) scroll.jumpTo(0);
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
