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
        setState(() => feedback = '这份请求属于另一学习库，未导入。');
        return;
      }
      final accept = request['acceptance'] != null;
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(accept ? '确认上下文、表达与词义？' : '保存到本机收件箱？'),
          content: SingleChildScrollView(
            child: SelectableText(
              const JsonEncoder.withIndent('  ').convert(request),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              key: const ValueKey('intake-import-confirm'),
              onPressed: () => Navigator.pop(context, true),
              child: Text(accept ? '确认词义并保存' : '保存待处理'),
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
              (accept ? '已保存词义，没有自动加入学习。' : '已保存，可到收件箱继续澄清。'),
        );
      }
    } catch (_) {
      if (mounted) setState(() => feedback = '无法导入。请检查采集请求格式，原文件未改动。');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('采集接入')),
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Text('浏览器和本地 Agent 可以直接保存到这个学习库。保存待处理不需要账号；确认词义后仍需显式加入学习。'),
              const SizedBox(height: 16),
              const Text('本机库标识'),
              SelectableText(
                widget.model.snapshot!.value['libraryId'] as String,
              ),
              const SizedBox(height: 12),
              const Text('本机库位置'),
              SelectableText(widget.model.repository.path),
              OutlinedButton(
                onPressed: () => Clipboard.setData(
                  ClipboardData(text: widget.model.repository.path),
                ),
                child: const Text('复制库位置'),
              ),
              const ExpansionTile(
                title: Text('桌面接入设置'),
                children: [
                  Padding(
                    padding: EdgeInsets.all(12),
                    child: Text(
                      '使用随桌面接入工具提供的 sensa-intake 配置当前库。浏览器插件通过已登记的本机桥接连接，首次连接时核对库名称和标识。Agent 使用同一连接配置调用 CLI。接入工具和安装步骤见 native-intake-group-handoff.md；当前是迁移验收入口。不要让外部工具直接修改数据库。',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              const Text('也可以导入面向当前库的采集 JSON 请求。导入前会展示完整内容；同一操作重复导入不会重复创建内容。'),
              FilledButton(
                key: const ValueKey('intake-import'),
                onPressed: busy ? null : import,
                child: const Text('导入采集请求'),
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
