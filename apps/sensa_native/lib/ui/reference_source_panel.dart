import '../l10n/interface_locale.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

/// Local source selection is explicit; this surface does not certify a publisher.
class ReferenceSourcePanel extends StatefulWidget {
  const ReferenceSourcePanel({
    super.key,
    required this.model,
    required this.task,
  });
  final LibraryViewModel model;
  final Map<String, dynamic> task;
  @override
  State<ReferenceSourcePanel> createState() => _ReferenceSourcePanelState();
}

class _ReferenceSourcePanelState extends State<ReferenceSourcePanel> {
  String? error;
  bool reading = false;
  Future<void> attach() async {
    setState(() {
      reading = true;
      error = null;
    });
    final task = widget.task;
    try {
      final raw = await widget.model.packReader.pick();
      if (raw == null || !mounted) return;
      if (raw.length > 32000) throw const FormatException();
      final source = Map<String, dynamic>.from(jsonDecode(raw));
      final preview = JsonEncoder.withIndent('  ').convert(source);
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(context.l10n.uiUseThisReference),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.l10n.uiUseThisForTheCurrentMeaning(
                    (task['target']['proposal']['expression']['surface'])
                        .toString(),
                  ),
                ),
                SelectableText(preview),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              key: const ValueKey('reference-confirm'),
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.l10n.uiConfirmReference),
            ),
          ],
        ),
      );
      if (yes != true || !mounted) return;
      await widget.model.provisioningAction({
        'kind': 'set_reference',
        'task_id': task['id'],
        'expected_revision': task['revision'],
        'reference': {
          ...source,
          'senseVersionId': task['target']['senseVersionId'],
          'bindingVersionId': task['target']['bindingVersionId'],
        },
      });
    } catch (_) {
      if (mounted) {
        setState(() => error = context.l10n.uiChooseASensaJsonReferenceExcerpt);
      }
    } finally {
      if (mounted) setState(() => reading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.task['reference'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              r == null
                  ? context.l10n.uiNoReferenceAttached
                  : context.l10n.uiReference596(
                      (r['attribution']).toString(),
                      (r['edition']).toString(),
                    ),
            ),
            if (r != null) ...[
              Text(
                context.l10n.uiSourceLicenseReview(
                  (r['sourceUrl']).toString(),
                  (r['license']).toString(),
                  (r['reviewer']).toString(),
                ),
              ),
              for (final resource in r['resources'])
                Text(
                  resource['contentPayload'].values
                      .where((v) => v != null)
                      .join(' · '),
                ),
            ],
            Text(context.l10n.uiReplacingOrRemovingThisReferenceAffects),
            OutlinedButton(
              key: const ValueKey('reference-import'),
              onPressed: reading || widget.model.busy ? null : attach,
              child: Text(
                r == null
                    ? context.l10n.uiImportReference
                    : context.l10n.uiReplaceReference,
              ),
            ),
            if (r != null)
              TextButton(
                key: const ValueKey('reference-remove'),
                onPressed: widget.model.busy
                    ? null
                    : () => widget.model.provisioningAction({
                        'kind': 'set_reference',
                        'task_id': widget.task['id'],
                        'expected_revision': widget.task['revision'],
                        'reference': null,
                      }),
                child: Text(context.l10n.uiRemoveReference),
              ),
            if (error != null) Text(error!),
          ],
        ),
      ),
    );
  }
}
