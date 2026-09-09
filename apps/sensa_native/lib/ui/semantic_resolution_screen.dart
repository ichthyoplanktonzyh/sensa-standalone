import '../l10n/interface_locale.dart';
import 'online_service_dialog.dart';
import 'agent_screen.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

class SemanticResolutionScreen extends StatefulWidget {
  const SemanticResolutionScreen({
    super.key,
    required this.model,
    required this.capture,
    this.intakeId,
  });
  final LibraryViewModel model;
  final Map<String, dynamic> capture;
  final String? intakeId;
  @override
  State<SemanticResolutionScreen> createState() =>
      _SemanticResolutionScreenState();
}

class _SemanticResolutionScreenState extends State<SemanticResolutionScreen> {
  final focus = TextEditingController();
  LibraryViewModel get model => widget.model;
  Map<String, dynamic>? get job {
    // A replacement retains the exact capture, including source time and occurrence.
    final candidates = model.lookups.where((v) {
      final s = v['request']['snapshot'];
      Object? ordered(Object? value) {
        if (value is Map) {
          final keys = value.keys.cast<String>().toList()..sort();
          return {for (final key in keys) key: ordered(value[key])};
        }
        if (value is List) return value.map(ordered).toList();
        return value;
      }

      return v['status'] != 'superseded' &&
          jsonEncode(ordered(s)) == jsonEncode(ordered(widget.capture)) &&
          v['intakeId'] == widget.intakeId;
    });
    return candidates.firstOrNull;
  }

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  Future<void> configure() async {
    await configureOnlineService(context, model);
    if (mounted) setState(() {});
  }

  Future<void> request({bool clarify = false}) async {
    await model.agents.load();
    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => AgentScreen(
          controller: model.agents,
          initialMessage: clarify ? focus.text.trim() : null,
          source: {
            'kind': 'capture',
            'snapshot': widget.capture,
            'intake_id': widget.intakeId,
            'previous_id': job?['id'],
          },
        ),
      ),
    );
    await model.load();
    if (mounted && job?['status'] == 'accepted') Navigator.pop(context, true);
  }

  Future<void> accept() async {
    await model.semanticAction({
      'kind': 'accept',
      'id': job!['id'],
      'consent': 'accept_context_expression_sense',
    });
    if (mounted && model.error == null) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: model,
    builder: (context, _) {
      final current = job;
      final expired =
          current != null &&
          (current['expiresAtMs'] as int) <=
              DateTime.now().millisecondsSinceEpoch;
      final ready = current?['status'] == 'ready' && !expired;
      final accepted = current?['status'] == 'accepted';
      final available =
          !model.busy && !model.semanticBusy && model.error == null;
      final proposal = current?['proposal'] as Map<String, dynamic>?;
      final spec = proposal?['semanticSpec'] as Map<String, dynamic>?;
      return Scaffold(
        appBar: AppBar(title: Text(context.l10n.uiUnderstandThisExpression)),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: ListView(
                key: const ValueKey('semantic-scroll'),
                padding: const EdgeInsets.all(20),
                children: [
                  SelectableText(widget.capture['sentence'] as String),
                  const SizedBox(height: 12),
                  Text(
                    context.l10n.uiExpression403(
                      (widget.capture['expression']['text']).toString(),
                    ),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Text(
                    context.l10n.uiSource(
                      (widget.capture['source']['title']).toString(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(context.l10n.uiYourContextAndExpressionWillBe),
                  TextButton(
                    onPressed: model.semanticBusy ? null : configure,
                    child: Text(context.l10n.uiModelServiceSettings),
                  ),
                  if (model.semanticBusy) ...[
                    const LinearProgressIndicator(),
                    Text(context.l10n.uiExplainingYouCanLeaveThisPage),
                  ] else if (current?['status'] == 'running')
                    Text(
                      context.l10n.uiThePreviousRequestWasInterruptedRetrying,
                    ),
                  if (expired)
                    Text(context.l10n.uiThisSuggestionExpiredRequestANew),
                  if (current?['status'] == 'failed')
                    Text(switch (current?['reason']) {
                      'access_required' =>
                        context.l10n.uiThisServiceRequiresValidAccessCheck,
                      'lookup_timeout' =>
                        context.l10n.uiExplanationTimedOutYourInputIs,
                      'invalid_response' =>
                        context.l10n.uiTheResultFailedValidationAndWas,
                      _ => context.l10n.uiCouldNotGetAnExplanationYour,
                    }),
                  if (current?['status'] == 'unresolved')
                    Text(context.l10n.uiAddALittleMoreContextOr),
                  if (current?['focus'] != null)
                    Text(
                      context.l10n.uiFocus(
                        (current!['focus']['text']).toString(),
                      ),
                    ),
                  if (proposal != null) ...[
                    const SizedBox(height: 16),
                    Text(proposal['explanation'] as String),
                    const SizedBox(height: 12),
                    Text(
                      spec!['coreMeaningFocus'] as String,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    for (final scene in spec['prototypeScenes'] as List)
                      Text(
                        context.l10n.uiTypicalScene(
                          (scene['summary']).toString(),
                        ),
                      ),
                    for (final value in spec['includedCases'] as List)
                      Text(context.l10n.uiIncludes((value).toString())),
                    for (final value in spec['excludedCases'] as List)
                      Text(context.l10n.uiExcludes((value).toString())),
                    for (final value in spec['neighborContrasts'] as List)
                      Text('${value['label']}：${value['distinction']}'),
                    Text(
                      context.l10n.uiExplanationSource(
                        (current!['provenance']['provider']).toString(),
                        (current['provenance']['model']).toString(),
                      ),
                    ),
                  ],
                  if (accepted)
                    Text(context.l10n.uiMeaningConfirmedAndSaved)
                  else ...[
                    if (ready)
                      FilledButton(
                        onPressed: available ? accept : null,
                        child: Text(context.l10n.uiConfirmAndSaveMeaning),
                      ),
                    Text(context.l10n.uiYouCanPrepareLearningMaterialAfter),
                    if (current != null)
                      TextField(
                        key: const ValueKey('semantic-focus'),
                        controller: focus,
                        maxLength: 2000,
                        maxLines: 3,
                        decoration: InputDecoration(
                          labelText: context.l10n.uiFocusNoteOptional,
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    if (current != null && focus.text.trim().isNotEmpty)
                      OutlinedButton(
                        onPressed: available
                            ? () => request(clarify: true)
                            : null,
                        child: Text(context.l10n.uiExplainWithThisFocus),
                      ),
                    OutlinedButton(
                      onPressed: available ? request : null,
                      child: Text(
                        current == null
                            ? context.l10n.uiRequestExplanation
                            : context.l10n.uiRequestAnotherExplanation,
                      ),
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
