import 'package:flutter/material.dart';
import 'package:sensa_native/main.dart' as app;
import 'package:sensa_native/ui/library_screen.dart';
import 'package:sensa_native/ui/library_view_model.dart';

// Historical migration tests keep their fixture entry. Formal tests use NativeApp.
class MigrationApp extends StatelessWidget {
  const MigrationApp({super.key, required this.model});
  final LibraryViewModel model;
  @override
  Widget build(BuildContext context) => app.NativeApp(
    model: model,
    home: LibraryScreen(model: model, acceptanceTools: true),
  );
}
