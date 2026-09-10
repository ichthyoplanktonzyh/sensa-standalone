import 'package:flutter/material.dart';

// The confirmed apps/web HomeScreen/WebShell palette, adapted to native controls.
ThemeData productTheme() => ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xff303e73),
    primary: const Color(0xff303e73),
    surface: const Color(0xfffbfbfa),
  ),
  scaffoldBackgroundColor: const Color(0xfffbfbfa),
  appBarTheme: const AppBarTheme(
    backgroundColor: Color(0xfffbfbfa),
    surfaceTintColor: Colors.transparent,
    elevation: 0,
    centerTitle: false,
  ),
  textTheme: const TextTheme(
    headlineLarge: TextStyle(
      fontSize: 28,
      fontWeight: FontWeight.w500,
      color: Color(0xff222631),
    ),
    headlineSmall: TextStyle(
      fontSize: 21,
      fontWeight: FontWeight.w500,
      color: Color(0xff222631),
    ),
    bodyLarge: TextStyle(fontSize: 16, height: 1.5, color: Color(0xff222631)),
    bodyMedium: TextStyle(fontSize: 14, height: 1.6, color: Color(0xff626b7b)),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    contentPadding: const EdgeInsets.all(16),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(0, 52),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      minimumSize: const Size(0, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    ),
  ),
  listTileTheme: const ListTileThemeData(
    contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
  ),
);

class ProductPage extends StatelessWidget {
  const ProductPage({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.pageId,
  });
  final String title;
  final String? subtitle;
  final String? pageId;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1120),
        child: ListView(
          key: PageStorageKey(pageId ?? title),
          padding: EdgeInsets.all(constraints.maxWidth < 600 ? 16 : 32),
          children: [
            Text(title, style: Theme.of(context).textTheme.headlineLarge),
            if (subtitle != null) ...[
              const SizedBox(height: 12),
              Text(subtitle!),
            ],
            const SizedBox(height: 20),
            ...children.expand((w) => [w, const SizedBox(height: 16)]),
          ],
        ),
      ),
    ),
  );
}

class ProductPanel extends StatelessWidget {
  const ProductPanel({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16),
      side: const BorderSide(color: Color(0xffe3e5ea)),
    ),
    clipBehavior: Clip.antiAlias,
    child: Padding(padding: const EdgeInsets.all(20), child: child),
  );
}

/// Keeps forms and text legible on a desktop while retaining mobile scrolling.
class Readable extends StatelessWidget {
  const Readable({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => SafeArea(
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 880),
        child: child,
      ),
    ),
  );
}
