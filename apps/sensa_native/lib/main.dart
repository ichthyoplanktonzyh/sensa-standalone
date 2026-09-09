import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'data/library_repository.dart';
import 'ui/library_view_model.dart';
import 'ui/native_shell.dart';
import 'ui/product_theme.dart';
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
  // Start platform directory initialization outside the first widget build.
  final support = getApplicationSupportDirectory().then<Directory?>(
    (directory) => directory,
    onError: (Object error, StackTrace stack) => null,
  );
  runApp(_Bootstrap(support: support));
}

class _Bootstrap extends StatefulWidget {
  const _Bootstrap({required this.support});
  final Future<Directory?> support;
  @override
  State<_Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<_Bootstrap> {
  LibraryViewModel? model;
  bool initialized = false;
  bool attemptedSupport = false;
  bool opening = false;
  String? failure;
  @override
  void initState() {
    super.initState();
    open();
  }

  Future<void> open() async {
    if (opening) return;
    setState(() {
      opening = true;
      failure = null;
    });
    try {
      if (!initialized) {
        await RustLib.init();
        initialized = true;
      }
      final support = await (attemptedSupport
          ? getApplicationSupportDirectory()
          : widget.support);
      attemptedSupport = true;
      if (support == null) {
        throw const FileSystemException('Application support unavailable');
      }
      final directory = Directory('${support.path}/libraries');
      await directory.create(recursive: true);
      final next = LibraryViewModel(
        LibraryRepository('${directory.path}/main.sqlite'),
      );
      await next.load();
      if (mounted) {
        setState(() => model = next);
      } else {
        next.dispose();
      }
    } catch (_) {
      attemptedSupport = true;
      if (mounted) {
        setState(() => failure = '暂时无法打开本地学习库。请检查设备的可用空间和文件访问权限，再重试。');
      }
    } finally {
      if (mounted) setState(() => opening = false);
    }
  }

  @override
  void dispose() {
    model?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => model != null
      ? NativeApp(model: model!)
      : MaterialApp(
          theme: productTheme(),
          debugShowCheckedModeBanner: false,
          home: Scaffold(
            body: SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('sensa', style: TextStyle(fontSize: 36)),
                      const SizedBox(height: 24),
                      if (failure == null)
                        const CircularProgressIndicator(
                          semanticsLabel: '正在打开本地学习库',
                        )
                      else ...[
                        Text(failure!),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: open,
                          child: const Text('重新打开'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
}

class NativeApp extends StatelessWidget {
  const NativeApp({super.key, required this.model, this.home});
  final LibraryViewModel model;
  final Widget? home;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Sensa',
    debugShowCheckedModeBanner: false,
    theme: productTheme(),
    home: home ?? NativeShell(model: model),
  );
}
