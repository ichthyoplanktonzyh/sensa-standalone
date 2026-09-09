import '../l10n/interface_locale.dart';
import 'dart:io';
import 'intake_setup_screen.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'library_view_model.dart';

/// External inputs use the same Rust admission as the browser host and local CLI.
class IntakeConnectionScreen extends StatefulWidget {
  const IntakeConnectionScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<IntakeConnectionScreen> createState() => _IntakeConnectionScreenState();
}

class _IntakeConnectionScreenState extends State<IntakeConnectionScreen> {
  String? feedback;
  bool busy = false;
  Future<void> import() async {
    setState(() {
      busy = true;
      feedback = null;
    });
    try {
      final raw = await widget.model.packReader.pick();
      if (raw == null || !mounted) return;
      if (utf8.encode(raw).length > 96 * 1024) throw const FormatException();
      final value = jsonDecode(raw) as Map<String, dynamic>;
      final request =
          (value['kind'] == 'submit' ? value['request'] : value)
              as Map<String, dynamic>;
      if (request['libraryId'] != widget.model.snapshot!.value['libraryId']) {
        setState(
          () => feedback = context.l10n.uiThisRequestBelongsToAnotherLibrary,
        );
        return;
      }
      final accept = request['acceptance'] != null;
      final resolution = request['resolution'] as Map?;
      final sense = resolution?['kind'] == 'proposal'
          ? resolution?['proposal']?['explanation']
          : widget.model.snapshot!.catalog
                .where((e) => e['material']['id'] == resolution?['material_id'])
                .map((e) => e['material']['sense'])
                .firstOrNull;
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(
            accept
                ? context.l10n.uiConfirmContextExpressionAndMeaning
                : context.l10n.uiSaveToYourInbox,
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(context.l10n.uiContext),
                SelectableText('${request['snapshot']?['sentence'] ?? ''}'),
                const SizedBox(height: 16),
                Text(
                  context.l10n.uiExpression403(
                    (request['snapshot']?['expression']?['text'] ??
                            context.l10n.uiAwaitingConfirmation)
                        .toString(),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  context.l10n.uiMeaning404(
                    (sense ?? context.l10n.uiAwaitingConfirmation).toString(),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  context.l10n.uiSource(
                    (request['snapshot']?['source']?['title'] ??
                            context.l10n.uiUnnamedSource)
                        .toString(),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  accept
                      ? context.l10n.uiSaveThisMeaningNowYouCan
                      : context.l10n.uiKeepThisInYourInboxTo,
                ),
                ExpansionTile(
                  key: const PageStorageKey(
                    'intake_connection_screen-detail-1',
                  ),
                  title: Text(context.l10n.uiViewFullRequest),
                  children: [
                    SelectableText(
                      const JsonEncoder.withIndent('  ').convert(request),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              key: const ValueKey('intake-import-confirm'),
              onPressed: () => Navigator.pop(context, true),
              child: Text(
                accept
                    ? context.l10n.uiConfirmMeaningAndSave
                    : context.l10n.uiSaveForLater,
              ),
            ),
          ],
        ),
      );
      if (yes != true || !mounted) return;
      await widget.model.act({'kind': 'intake', 'request': request});
      if (mounted) {
        setState(
          () => feedback =
              widget.model.error ??
              (accept
                  ? context.l10n.uiMeaningSaved410
                  : context.l10n.uiSavedContinueClarifyingInYourInbox),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => feedback = context.l10n.uiImportFailedCheckTheCaptureRequest,
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(context.l10n.uiCaptureConnections)),
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text(context.l10n.uiReceiveCapturesFromYourBrowserOr),
              const SizedBox(height: 16),
              if (Platform.isMacOS) ...[
                FilledButton(
                  onPressed: busy
                      ? null
                      : () => Navigator.push(
                          context,
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                IntakeSetupScreen(model: widget.model),
                          ),
                        ),
                  child: Text(context.l10n.uiConnectBrowserAndAgents),
                ),
                const SizedBox(height: 20),
              ],
              Text(context.l10n.uiLibraryId),
              SelectableText(
                widget.model.snapshot!.value['libraryId'] as String,
              ),
              const SizedBox(height: 12),
              Text(context.l10n.uiLibraryLocation),
              SelectableText(widget.model.repository.path),
              OutlinedButton(
                onPressed: () => Clipboard.setData(
                  ClipboardData(text: widget.model.repository.path),
                ),
                child: Text(context.l10n.uiCopyLibraryLocation),
              ),
              ExpansionTile(
                key: PageStorageKey('intake-setup-detail'),
                title: Text(context.l10n.uiDesktopConnectionDetails),
                children: [
                  Padding(
                    padding: EdgeInsets.all(12),
                    child: Text(
                      context.l10n.uiOnFirstConnectionConfirmTheLibrary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Text(context.l10n.uiYouCanAlsoImportACapture),
              FilledButton(
                key: const ValueKey('intake-import'),
                onPressed: busy ? null : import,
                child: Text(context.l10n.uiImportCaptureRequest),
              ),
              if (feedback != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(feedback!),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}
