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
  final label = TextEditingController(text: '我的 Sensa 学习库');
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
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> install() async {
    if (browser && !RegExp(r'^[a-p]{32}$').hasMatch(extension.text.trim())) {
      setState(() => error = '请填写 Chrome 提供的 32 位扩展 ID，或关闭浏览器连接。');
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
      if (mounted) setState(() => error = e.message ?? '无法建立连接，请检查所选位置。');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('连接浏览器与 Agent')),
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
            Text('连接已创建', style: Theme.of(context).textTheme.headlineSmall),
            Text('${connection!['label']} · 资料将保存到当前本机库。'),
            if (connection!['browser'] == true)
              const Text('打开 Sensa 浏览器插件，选择原生接收端，核对库名称并确认连接。'),
            const SizedBox(height: 24),
            const Text('本地 Agent 接入工具'),
            SelectableText('${connection!['executable']}'),
            OutlinedButton(
              onPressed: () => Clipboard.setData(
                ClipboardData(text: '${connection!['executable']}'),
              ),
              child: const Text('复制工具位置'),
            ),
            const Text('工具使用同目录的连接配置。Agent 通过标准输入发送采集请求；确认词义需你的明确授权。'),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('完成'),
            ),
          ] else ...[
            const Text('选择接收这个学习库的入口。连接工具只接收采集请求，不会替你加入学习或修改学习结果。'),
            const SizedBox(height: 20),
            SwitchListTile(
              title: const Text('同时连接 Chrome 浏览器'),
              subtitle: const Text('关闭后只创建本地 Agent 连接。'),
              value: browser,
              onChanged: busy ? null : (v) => setState(() => browser = v),
            ),
            TextField(
              controller: label,
              enabled: !busy,
              maxLength: 100,
              decoration: const InputDecoration(labelText: '显示的库名称'),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: busy ? null : () => choose(false),
              child: const Text('选择连接工具保存位置'),
            ),
            if (destination != null) SelectableText(destination!),
            if (browser) ...[
              const SizedBox(height: 24),
              TextField(
                controller: extension,
                enabled: !busy,
                maxLength: 32,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Sensa Chrome 扩展 ID',
                  helperText: '从 Chrome 扩展详情复制扩展 ID。',
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                '选择这个浏览器用户目录中的 NativeMessagingHosts 文件夹；没有时可在系统窗口中创建同名文件夹。现有连接不会被覆盖。',
              ),
              OutlinedButton(
                onPressed: busy ? null : () => choose(true),
                child: const Text('选择浏览器连接文件夹'),
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
              child: Text(busy ? '正在创建连接…' : '创建此库的连接'),
            ),
          ],
        ],
      ),
    ),
  );
}
