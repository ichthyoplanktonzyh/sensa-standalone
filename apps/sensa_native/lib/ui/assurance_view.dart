import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

/// Presentation of a Rust-owned encounter. Every grading result comes from its
/// committed snapshot, including after a replay with a changed learner answer.
class AssuranceView extends StatefulWidget {
  const AssuranceView({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<AssuranceView> createState() => _AssuranceViewState();
}

class _AssuranceViewState extends State<AssuranceView> {
  late final TextEditingController answer;
  Timer? saveTimer;
  bool dirty = false;
  final player = AudioPlayer();
  String? mediaError;
  bool playing = false;
  Map<String, dynamic> get a => widget.model.snapshot!.assurance!;
  Map<String, dynamic> get draft => a['draft'] as Map<String, dynamic>;
  Map<String, dynamic> get teaching =>
      (a['teaching'] as Map<String, dynamic>?) ?? {};
  bool get canSubmit =>
      a['resource']?['kind'] == 'meaning_to_form_recall' &&
          draft['support'] != 'choice'
      ? answer.text.trim().isNotEmpty
      : draft['optionId'] != null;
  bool get available => !widget.model.busy && widget.model.error == null;
  @override
  void initState() {
    super.initState();
    answer = TextEditingController(text: draft['text'] as String? ?? '');
  }

  @override
  void dispose() {
    saveTimer?.cancel();
    answer.dispose();
    unawaited(player.dispose());
    super.dispose();
  }

  Future<void> saveDraft() async {
    saveTimer?.cancel();
    if (!mounted || !dirty) return;
    if (widget.model.busy) {
      saveTimer = Timer(const Duration(milliseconds: 150), saveDraft);
      return;
    }
    final text = answer.text;
    dirty = false;
    await widget.model.assuranceIntent({
      'kind': 'draft',
      'text': text,
      'option_id': draft['optionId'],
    });
  }

  Future<void> act(Map<String, dynamic> intent) async {
    if (!available || intent['kind'] == 'submit' && !canSubmit) return;
    if (dirty) {
      await saveDraft();
      if (!mounted || !available) return;
    }
    await widget.model.assuranceIntent(intent);
    if (mounted && !dirty && answer.text != draft['text']) {
      answer.text = draft['text'] as String? ?? '';
    }
  }

  Future<void> play(String reference) async {
    if (playing) return;
    setState(() {
      playing = true;
      mediaError = null;
    });
    try {
      final bytes = await widget.model.repository.media(
        a['id'] as String,
        reference,
      );
      if (!mounted) return;
      await player.play(BytesSource(bytes, mimeType: 'audio/mpeg'));
    } catch (_) {
      if (mounted) setState(() => mediaError = '音频暂时无法播放，可以继续阅读文字，稍后重试。');
    } finally {
      if (mounted) setState(() => playing = false);
    }
  }

  Widget title(String text) =>
      Text(text, style: Theme.of(context).textTheme.headlineSmall);
  Widget primary(String label, String kind) => FilledButton(
    key: ValueKey('assurance-$kind'),
    onPressed: available && (kind != 'submit' || canSubmit)
        ? () => act({'kind': kind})
        : null,
    child: Text(label),
  );
  Widget panel(List<Widget> children) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: const Color(0xfff5f7fb),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children
          .expand((w) => [w, const SizedBox(height: 12)])
          .toList(),
    ),
  );
  List<Map<String, dynamic>> list(dynamic value) =>
      (value as List? ?? []).cast<Map<String, dynamic>>();
  Widget example(Map<String, dynamic> e) => panel([
    SelectableText(
      e['textL2'] as String? ?? '',
      style: Theme.of(context).textTheme.titleLarge,
    ),
    Text(e['textL1'] as String? ?? ''),
    if (e['audioUrl'] != null)
      TextButton.icon(
        key: const ValueKey('assurance-example-audio'),
        onPressed: playing ? null : () => play(e['audioUrl'] as String),
        icon: const Icon(Icons.volume_up_outlined),
        label: const Text('播放例句'),
      ),
  ]);
  Widget scene() {
    if (teaching['repairRecap'] case final Map<String, dynamic> recap) {
      return panel([
        Text(recap['bodyL1'] as String? ?? ''),
        for (final step in list(recap['steps']))
          Text(step['labelL1'] as String? ?? ''),
      ]);
    }
    final exp = (teaching['experience'] as Map<String, dynamic>?) ?? {};
    final renders = list(exp['renders']);
    final selections = list(exp['renderPlan']?['selections']);
    int rank(Map<String, dynamic> s) => switch (s['role']) {
      'preferred' => 0,
      'alternative' => 1,
      _ => 2,
    };
    selections.sort((x, y) {
      final r = rank(x).compareTo(rank(y));
      return r == 0 ? (x['rank'] as num).compareTo(y['rank'] as num) : r;
    });
    final planned = selections
        .map(
          (s) => renders
              .where((r) => r['renderKey'] == s['renderKey'])
              .firstOrNull,
        )
        .whereType<Map<String, dynamic>>()
        .toList();
    final render = planned
        .where(
          (r) =>
              r['kind'] == 'text' ||
              r['kind'] == 'interaction' &&
                  r['rendererKey'] == 'state_change_v1',
        )
        .firstOrNull;
    final fallback = planned.where((r) => r['kind'] == 'text').firstOrNull;
    if (render == null) return const Text('当前场景暂不可用，请重新读取。');
    if (render['kind'] == 'text' || draft['textScene'] == true) {
      return panel([
        Text(
          (render['kind'] == 'text' ? render : fallback)?['sceneL1']
                  as String? ??
              '',
          style: Theme.of(context).textTheme.titleLarge,
        ),
      ]);
    }
    final payload = render['payload'] as Map<String, dynamic>;
    final states = list(payload['states'] ?? payload['timeline']);
    final control = payload['control'] as Map<String, dynamic>? ?? {};
    final min = (control['minimum'] as num? ?? 0).toDouble();
    final max = (control['maximum'] as num? ?? states.length - 1).toDouble();
    final step = (control['step'] as num? ?? 1).toDouble();
    final value = ((draft['experienceValue'] as num? ?? min).toDouble()).clamp(
      min,
      max,
    );
    final active =
        states.indexed
            .where((e) => (e.$2['value'] as num? ?? e.$1).toDouble() == value)
            .firstOrNull
            ?.$2 ??
        states.first;
    return panel([
      Text(payload['instructionL1'] as String? ?? ''),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: states
            .map(
              (s) => Chip(
                label: Text(s['labelL1'] as String),
                backgroundColor: s == active ? const Color(0xffdde5f7) : null,
              ),
            )
            .toList(),
      ),
      Text(
        payload['runtimePresentation']?['controlLabelL1'] as String? ?? '体验变化',
      ),
      Slider(
        key: const ValueKey('assurance-experience'),
        min: min,
        max: max,
        value: value,
        divisions: ((max - min) / step).round().clamp(1, 1000),
        label: active['labelL1'] as String?,
        onChanged: available
            ? (v) =>
                  act({'kind': 'experience', 'value': v, 'text_scene': false})
            : null,
      ),
      Text(
        active['feedbackL1'] as String? ?? active['labelL1'] as String? ?? '',
      ),
      if (fallback != null)
        TextButton(
          onPressed: available
              ? () => act({
                  'kind': 'experience',
                  'value': value,
                  'text_scene': true,
                })
              : null,
          child: const Text('切换文字场景'),
        ),
    ]);
  }

  List<Widget> revealed() => [
    title(teaching['lemma'] as String? ?? ''),
    Text(
      '${teaching['partOfSpeech'] ?? ''} · ${teaching['guideLabelL1'] ?? ''}',
    ),
    Text(teaching['definitionL2'] as String? ?? ''),
    Wrap(
      spacing: 8,
      runSpacing: 8,
      children: list(teaching['pronunciations'])
          .map(
            (p) => OutlinedButton.icon(
              key: ValueKey('pronunciation-${p['accentLocale']}'),
              onPressed: p['mediaKey'] != null && !playing
                  ? () => play(p['mediaKey'] as String)
                  : null,
              icon: const Icon(Icons.volume_up_outlined),
              label: Text('${p['accentLocale']}  ${p['ipa']}'),
            ),
          )
          .toList(),
    ),
    panel([
      Text(teaching['l1Bridge'] as String? ?? ''),
      for (final f in teaching['senseFeatures'] as List? ?? []) Text('• $f'),
    ]),
    if (teaching['studyExample'] != null)
      example(teaching['studyExample'] as Map<String, dynamic>),
    for (final usage in list(teaching['usagePatterns']))
      panel([
        Text(usage['canonicalPattern'] as String? ?? ''),
        Text(usage['usageRestriction'] as String? ?? ''),
        for (final collocation in list(usage['collocations']))
          TextButton(
            onPressed: () {
              final key = (list(
                collocation['exampleBindings'],
              ).firstOrNull)?['exampleKey'];
              final bound = list(
                teaching['learningExamples'],
              ).where((e) => e['exampleKey'] == key).firstOrNull;
              if (bound != null) {
                showModalBottomSheet<void>(
                  context: context,
                  builder: (context) => SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: example(bound),
                    ),
                  ),
                );
              }
            },
            child: Text(collocation['displayTextL2'] as String? ?? ''),
          ),
      ]),
  ];
  @override
  Widget build(BuildContext context) {
    final vm = widget.model;
    final queue = a['queue'] as Map<String, dynamic>;
    final stats = queue['stats'] as Map<String, dynamic>;
    final session = queue['session'] as Map<String, dynamic>?;
    final action = session?['action'] as Map<String, dynamic>?;
    final resource = a['resource'] as Map<String, dynamic>?;
    final reviewResult = session?['result'] is Map
        ? session!['result'] as Map<String, dynamic>
        : null;
    final evaluation = draft['evaluation'] as Map<String, dynamic>?;
    final feedback = reviewResult != null || evaluation != null;
    final correct =
        reviewResult?['correct'] as bool? ??
        ['independent', 'success'].contains(evaluation?['outcome']);
    final supported = [
      'first_letter',
      'choice',
    ].contains(evaluation?['outcome']);
    final isTeaching =
        action?['intent'] == 'instruction' || action?['intent'] == 'repair';
    final children = <Widget>[];
    if (a['completed'] == true) {
      children.addAll([
        const Icon(
          Icons.check_circle_outline,
          size: 44,
          color: Color(0xff147663),
        ),
        title(a['purpose'] == 'initial_learning' ? '本次高保证首学已完成' : '本次复习与修复已完成'),
        Text(
          '测评 ${stats['totalAttempts']} 次 · 正确 ${stats['correctAttempts']} 次',
        ),
        Text(
          a['purpose'] == 'initial_learning'
              ? '本轮通过验证 ${(queue["graduated"] as List? ?? []).length} 个连接。只有通过验证的连接才新增复习安排；已掌握声明可重新加入学习。'
              : '复习结果和修复进展已保存在本机。修复不会重复改变本次复习的排程。',
        ),
        FilledButton(onPressed: vm.showHome, child: const Text('回到首页')),
      ]);
    } else if (a['paused'] == true) {
      children.addAll([
        title('学习已暂停'),
        const Text('场景、回答和学习进度已保留。'),
        FilledButton(
          key: const ValueKey('assurance-resume'),
          onPressed: available
              ? () => vm.act({'kind': 'start_or_resume'})
              : null,
          child: const Text('继续高保证学习'),
        ),
      ]);
    } else if (session == null) {
      children.addAll([
        title('当前步骤暂不可用'),
        const Text('保留了当前学习，请检查材料后重新读取。'),
        OutlinedButton(onPressed: vm.load, child: const Text('重新读取')),
      ]);
    } else {
      children.add(
        Text(switch (a['purpose']) {
          'initial_learning' => '高保证首学',
          'relearning' => '针对性再学',
          _ => '到期复习',
        }, style: Theme.of(context).textTheme.labelLarge),
      );
      children.add(
        Text('步骤 ${session['index']} · 已完成测评 ${stats['totalAttempts']} 次'),
      );
      if (isTeaching) {
        if (draft['revealed'] == true) {
          children.addAll(revealed());
          children.add(
            primary(
              action!['intent'] == 'repair' ? '完成修复，稍后重测' : '开始检验连接',
              'continue',
            ),
          );
        } else {
          children.add(
            title(action!['intent'] == 'repair' ? '重新连接这个意义' : '先进入这个场景'),
          );
          children.add(scene());
          children.add(primary('揭示意义与表达', 'reveal'));
        }
      } else if (feedback) {
        children.add(
          title(
            supported
                ? '借助提示想起来了'
                : correct
                ? '这次连接成功'
                : '还需要再连接一次',
          ),
        );
        children.add(
          Text(
            supported
                ? '辅助回想不会算作独立通过，稍后会再次检验。'
                : correct
                ? '继续下一步，检查在其他场景中的连接。'
                : '先看清这个意义，修复后再独立回想。',
          ),
        );
        if (resource != null) {
          final options = list(
            resource['kind'] == 'novel_context_transfer'
                ? (resource['scenario']?['options'])
                : resource['options'],
          );
          final selected = options
              .where((o) => o['id'] == draft['optionId'])
              .firstOrNull;
          if (selected != null &&
              (reviewResult == null ||
                  correct ==
                      [
                        'independent',
                        'success',
                      ].contains(evaluation?['outcome']))) {
            children.add(
              panel([
                Text(selected['feedbackTitleL1'] as String? ?? ''),
                Text(selected['feedbackBodyL1'] as String? ?? ''),
              ]),
            );
          }
          final e = resource['kind'] == 'novel_context_transfer'
              ? (resource['scenario']?['revealExample'])
              : resource['example'];
          if (e is Map<String, dynamic>) children.add(example(e));
          if (resource['kind'] == 'meaning_to_form_recall') {
            children.add(
              title(
                resource['primaryForm'] as String? ??
                    teaching['lemma'] as String? ??
                    '',
              ),
            );
          }
        }
        children.add(panel([Text(teaching['l1Bridge'] as String? ?? '')]));
        children.add(primary('继续', 'continue'));
        children.add(
          TextButton(
            onPressed: available
                ? () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    builder: (context) => SafeArea(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: revealed()
                              .expand((w) => [w, const SizedBox(height: 16)])
                              .toList(),
                        ),
                      ),
                    ),
                  )
                : null,
            child: const Text('回看讲解与例句'),
          ),
        );
      } else if (resource != null) {
        final recall = resource['kind'] == 'meaning_to_form_recall';
        final transfer = resource['kind'] == 'novel_context_transfer';
        children.add(
          title(
            recall
                ? '试着主动想起这个表达'
                : transfer
                ? '换一个场景，还能用上吗？'
                : resource['kind'] == 'boundary_contrast'
                ? '分清这个意义的边界'
                : '在新语境中辨认意义',
          ),
        );
        children.add(Text(resource['instructionL1'] as String? ?? ''));
        if (recall) {
          children.add(
            panel([
              Text(resource['cueL1'] as String? ?? ''),
              for (final f in resource['cueFeatureLabelsL1'] as List? ?? [])
                Text('$f'),
            ]),
          );
        } else if (transfer) {
          children.add(
            panel([
              Text(resource['scenario']?['setupL2'] as String? ?? ''),
              Text(resource['scenario']?['setupL1'] as String? ?? ''),
              Text(resource['scenario']?['questionL1'] as String? ?? ''),
            ]),
          );
        } else {
          if (resource['example'] is Map<String, dynamic>) {
            children.add(example(resource['example'] as Map<String, dynamic>));
          }
          children.add(Text(resource['questionL1'] as String? ?? ''));
          if (resource['contrastSenseL1'] != null) {
            children.add(Text(resource['contrastSenseL1'] as String));
          }
        }
        if (recall && draft['support'] != 'choice') {
          if (draft['support'] == 'first_letter') {
            children.add(
              Text(
                '首字母提示：${(resource['primaryForm'] as String? ?? teaching['lemma'] as String? ?? '').characters.firstOrNull ?? ''}',
              ),
            );
          }
          children.add(
            TextField(
              key: const ValueKey('assurance-answer'),
              controller: answer,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(
                labelText: '输入表达',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) {
                dirty = true;
                saveTimer?.cancel();
                saveTimer = Timer(const Duration(milliseconds: 300), saveDraft);
              },
              onSubmitted: (_) => act({'kind': 'submit'}),
            ),
          );
          if (a['purpose'] == 'initial_learning') {
            children.add(
              TextButton(
                onPressed: available
                    ? () => act({
                        'kind': 'support',
                        'mode': draft['support'] == 'independent'
                            ? 'first_letter'
                            : 'choice',
                      })
                    : null,
                child: Text(
                  draft['support'] == 'independent' ? '需要首字母提示' : '使用选择辅助',
                ),
              ),
            );
          }
        } else {
          final opts = list(
            recall
                ? resource['choiceOptions']
                : transfer
                ? (resource['scenario']?['options'])
                : resource['options'],
          );
          for (final o in opts) {
            children.add(
              OutlinedButton(
                key: ValueKey('assurance-option-${o['id']}'),
                style: OutlinedButton.styleFrom(
                  backgroundColor: draft['optionId'] == o['id']
                      ? const Color(0xffe8eef9)
                      : null,
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.all(16),
                ),
                onPressed: available
                    ? () => act({
                        'kind': 'draft',
                        'text': '',
                        'option_id': o['id'],
                      })
                    : null,
                child: Text(
                  (o['textL2'] ?? o['textL1'] ?? o['labelL1']) as String,
                ),
              ),
            );
          }
        }
        children.add(primary('确认回答', 'submit'));
      }
      children.add(
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            TextButton(
              onPressed: available ? () => act({'kind': 'undo'}) : null,
              child: const Text('撤销上一步'),
            ),
            TextButton(
              onPressed: available ? () => act({'kind': 'mastery'}) : null,
              child: Text(
                a['purpose'] == 'initial_learning' ? '这个连接我已掌握' : '本轮暂时跳过',
              ),
            ),
            TextButton(
              onPressed: available ? () => act({'kind': 'pause'}) : null,
              child: const Text('暂停'),
            ),
          ],
        ),
      );
    }
    for (final target in list(a['queue']['states'])) {
      if (target['declaredMastery'] == true) {
        children.add(
          OutlinedButton(
            onPressed: available
                ? () => act({
                    'kind': 'return_target',
                    'target_id': target['retentionTargetId'],
                  })
                : null,
            child: Text('重新学习：${target['packageId']}'),
          ),
        );
      }
    }
    if (mediaError != null) {
      children.add(
        Text(
          mediaError!,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children
          .expand((w) => [w, const SizedBox(height: 20)])
          .toList(),
    );
  }
}
