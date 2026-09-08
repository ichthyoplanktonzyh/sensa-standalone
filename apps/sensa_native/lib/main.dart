import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'data/library_repository.dart';
import 'ui/library_view_model.dart';
import 'ui/library_screen.dart';
import 'src/rust/frb_generated.dart';

Future<LibraryViewModel> createLibrary({
  String name = 'acceptance-v1.sqlite',
}) async {
  final support = await getApplicationSupportDirectory();
  final directory = Directory('${support.path}/local-acceptance');
  await directory.create(recursive: true);
  final model = LibraryViewModel(LibraryRepository('${directory.path}/$name'));
  await model.load();
  return model;
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await RustLib.init();
  runApp(NativeApp(model: await createLibrary()));
}

class NativeApp extends StatelessWidget {
  const NativeApp({super.key, required this.model});
  final LibraryViewModel model;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Sensa · 本地验收',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff147663),
        surface: const Color(0xfff8f6f4),
      ),
      scaffoldBackgroundColor: const Color(0xfff8f6f4),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          fontSize: 32,
          fontWeight: FontWeight.w600,
          color: Color(0xff1f1d2b),
        ),
        headlineSmall: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w600,
          color: Color(0xff1f1d2b),
        ),
        bodyLarge: TextStyle(
          fontSize: 18,
          height: 1.65,
          color: Color(0xff1f1d2b),
        ),
        bodyMedium: TextStyle(
          fontSize: 14,
          height: 1.6,
          color: Color(0xff6c6878),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(0, 52)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 52)),
      ),
    ),
    home: LibraryScreen(model: model),
  );
}
