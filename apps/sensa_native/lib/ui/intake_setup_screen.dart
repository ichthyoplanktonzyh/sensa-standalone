import '../l10n/interface_locale.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'library_view_model.dart';
import 'product_theme.dart';

class IntakeSetupScreen extends StatefulWidget {
  const IntakeSetupScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<IntakeSetupScreen> createState() => _IntakeSetupScreenState();
}

class _IntakeSetupScreenState extends State<IntakeSetupScreen> {
  static const channel = MethodChannel('app.sensa/intake-install');
  late final label = TextEditingController(text: context.l10n.uiMySensaLibrary);
  final extension = TextEditingController();
  String? destination, registration, error;
  bool browser = true, busy = false;
  Map<dynamic, dynamic>? connection;
  @override
  void dispose() {
    label.dispose();
    extension.dispose();
    super.dispose();
  }

  Future<void> choose(bool host) async {
    try {
      final path = await channel.invokeMethod<String>(
        host ? 'chooseRegistration' : 'chooseDestination',
        {
          'prompt': context.l10n.chooseFolder,
          'message': host
              ? context.l10n.chooseBrowserFolder
              : context.l10n.chooseToolFolder,
        },
      );
      if (mounted && path != null) {
        setState(() {
          if (host) {
            registration = path;
          } else {
            destination = path;
          }
        });
      }
    } on PlatformException catch (e) {
      if (mounted) setState(() => error = installerMessage(e));
    }
  }

  String installerMessage(PlatformException error) => switch (error.details) {
    'select_folder' => context.l10n.installerSelectFolder,
    'select_browser' => context.l10n.installerSelectBrowser,
    'extension_id' => context.l10n.uiEnterTheCharacterChromeExtensionId,
    'registration_folder' => context.l10n.installerRegistrationFolder,
    'library_unavailable' => context.l10n.installerLibraryUnavailable,
    'helper_missing' => context.l10n.installerHelperMissing,
    'already_connected' => context.l10n.installerAlreadyConnected,
    'write_failed' => context.l10n.installerWriteFailed,
    _ => context.l10n.uiCouldNotCreateTheConnectionCheck,
  };

  Future<void> install() async {
    if (browser && !RegExp(r'^[a-p]{32}$').hasMatch(extension.text.trim())) {
      setState(() => error = context.l10n.uiEnterTheCharacterChromeExtensionId);
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await channel.invokeMapMethod<String, dynamic>('install', {
        'libraryPath': widget.model.repository.path,
        'libraryId': widget.model.snapshot!.id,
        'label': label.text.trim(),
        'browser': browser,
        'extensionId': browser ? extension.text.trim() : '',
      });
      if (mounted) setState(() => connection = result);
    } on PlatformException catch (e) {
      if (mounted) {
        setState(
          () => error =
              e.message ?? context.l10n.uiCouldNotCreateTheConnectionCheck,
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(context.l10n.uiConnectBrowserAndAgents)),
    body: Readable(
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (connection != null) ...[
            const Icon(
              Icons.check_circle_outline,
              size: 48,
              color: Color(0xff147663),
            ),
            const SizedBox(height: 20),
            Text(
              context.l10n.uiConnectionCreated,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            Text(
              context.l10n.uiCapturesWillBeSavedToThis(
                (connection!['label']).toString(),
              ),
            ),
            if (connection!['browser'] == true)
              Text(context.l10n.uiOpenTheSensaExtensionSelectThe),
            const SizedBox(height: 24),
            Text(context.l10n.uiLocalAgentTool),
            SelectableText('${connection!['executable']}'),
            OutlinedButton(
              onPressed: () => Clipboard.setData(
                ClipboardData(text: '${connection!['executable']}'),
              ),
              child: Text(context.l10n.uiCopyToolLocation),
            ),
            Text(context.l10n.uiTheToolReadsItsConnectionConfiguration),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.l10n.uiDone),
            ),
          ] else ...[
            Text(context.l10n.uiChooseHowToSendCapturesTo),
            const SizedBox(height: 20),
            SwitchListTile(
              title: Text(context.l10n.uiAlsoConnectChrome),
              subtitle: Text(context.l10n.uiTurnOffToCreateOnlyAn),
              value: browser,
              onChanged: busy ? null : (v) => setState(() => browser = v),
            ),
            TextField(
              controller: label,
              enabled: !busy,
              maxLength: 100,
              decoration: InputDecoration(
                labelText: context.l10n.uiLibraryDisplayName,
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: busy ? null : () => choose(false),
              child: Text(context.l10n.uiChooseToolLocation),
            ),
            if (destination != null) SelectableText(destination!),
            if (browser) ...[
              const SizedBox(height: 24),
              TextField(
                controller: extension,
                enabled: !busy,
                maxLength: 32,
                autocorrect: false,
                decoration: InputDecoration(
                  labelText: context.l10n.uiSensaChromeExtensionId,
                  helperText: context.l10n.uiCopyTheExtensionIdFromChrome,
                ),
              ),
              const SizedBox(height: 16),
              Text(context.l10n.uiChooseTheNativemessaginghostsFolderInThis),
              OutlinedButton(
                onPressed: busy ? null : () => choose(true),
                child: Text(context.l10n.uiChooseBrowserConnectionFolder),
              ),
              if (registration != null) SelectableText(registration!),
            ],
            const SizedBox(height: 24),
            if (error != null)
              Semantics(
                liveRegion: true,
                child: Text(
                  error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            FilledButton(
              onPressed:
                  busy ||
                      destination == null ||
                      (browser && registration == null)
                  ? null
                  : install,
              child: Text(
                busy
                    ? context.l10n.uiCreatingConnection
                    : context.l10n.uiCreateConnection,
              ),
            ),
          ],
        ],
      ),
    ),
  );
}
