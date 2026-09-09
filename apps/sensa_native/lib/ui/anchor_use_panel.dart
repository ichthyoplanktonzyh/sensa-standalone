import '../l10n/interface_locale.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';
import 'online_service_dialog.dart';
import 'world_screen.dart';
import '../data/world_repository.dart';

class AnchorUsePanel extends StatelessWidget {
  const AnchorUsePanel({super.key, required this.model, required this.meaning});
  final LibraryViewModel model;
  final Map<String, dynamic> meaning;
  Future<void> enable(BuildContext context) async {
    if (!model.contentServiceConfigured) {
      await configureOnlineService(context, model);
      if (!context.mounted || !model.contentServiceConfigured) return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.l10n.uiAllowUseOfThisContext),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (meaning['worldContext'] != null)
                for (final block in meaning['worldContext']['draft']['blocks'])
                  if (block['kind'] == 'text')
                    SelectableText(block['text'] as String)
                  else if (block['kind'] == 'image')
                    WorldImage(
                      repository: WorldRepository(model.repository),
                      digest: block['digest'],
                    )
                  else
                    SelectableText(meaning['snapshot']['sentence'] as String),
              const SizedBox(height: 12),
              Text(
                context.l10n.uiRecipient(
                  (model.contentServiceOrigin).toString(),
                ),
              ),
              Text(context.l10n.uiSendTheTextImagesConfirmedMeaning),
              Text(context.l10n.uiRevokingPermissionBlocksOldResultsFrom),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.uiNotNow),
          ),
          FilledButton(
            key: const ValueKey('anchor-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.l10n.uiAllowThisContext),
          ),
        ],
      ),
    );
    if (confirmed == true) await model.setAnchorUse(meaning, true);
  }

  @override
  Widget build(BuildContext context) {
    final grant = meaning['anchorGrant'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              grant == null
                  ? context.l10n.uiContextSharingOff
                  : context.l10n.uiContextSharingOn,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            if (grant != null)
              Text(context.l10n.uiRecipient((grant['recipient']).toString())),
            Text(context.l10n.uiThisAppliesToFutureLearningMaterial),
            OutlinedButton(
              key: const ValueKey('anchor-toggle'),
              onPressed: model.busy
                  ? null
                  : () async {
                      if (grant == null) {
                        await enable(context);
                      } else {
                        await model.setAnchorUse(meaning, false);
                      }
                    },
              child: Text(
                grant == null
                    ? context.l10n.uiAllowContextUse
                    : context.l10n.uiRevokePermission,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
