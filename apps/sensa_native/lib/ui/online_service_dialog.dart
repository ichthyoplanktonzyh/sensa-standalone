import 'package:flutter/material.dart';
import 'library_view_model.dart';
import 'agent_screen.dart';

Future<void> configureOnlineService(
  BuildContext context,
  LibraryViewModel model,
) async {
  await model.agents.load();
  if (!context.mounted) return;
  await Navigator.push(
    context,
    MaterialPageRoute<void>(
      builder: (_) => AgentSettingsScreen(controller: model.agents),
    ),
  );
  await model.load();
}
