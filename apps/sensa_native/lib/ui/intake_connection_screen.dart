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
        setState(() => feedback = '这份请求属于另一学习库，未导入。');
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
          title: Text(accept ? '确认上下文、表达与词义？' : '保存到本机收件箱？'),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('上下文'),
                SelectableText('${request['snapshot']?['sentence'] ?? ''}'),
                const SizedBox(height: 16),
                Text(
                  '表达：${request['snapshot']?['expression']?['text'] ?? '待确认'}',
                ),
                const SizedBox(height: 12),
                Text('词义：${sense ?? '待确认'}'),
                const SizedBox(height: 12),
                Text(
                  '来源：${request['snapshot']?['source']?['title'] ?? '未命名来源'}',
                ),
                const SizedBox(height: 12),
                Text(
                  accept
                      ? '这次操作会确认并保存词义。加入学习仍需另行选择。'
                      : '材料先进入收件箱，可以之后选择表达并澄清词义。',
                ),
                ExpansionTile(
                  key: const PageStorageKey(
                    'intake_connection_screen-detail-1',
                  ),
                  title: const Text('查看完整请求'),
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
                  child: const Text('连接浏览器与 Agent'),
                ),
                const SizedBox(height: 20),
              ],
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
                key: PageStorageKey('intake-setup-detail'),
                title: Text('桌面接入设置'),
                children: [
                  Padding(
                    padding: EdgeInsets.all(12),
                    child: Text(
                      '浏览器插件通过桌面接入工具连接这个学习库。首次连接时，请在插件中核对库名称和标识；本地 Agent 使用同一连接。更换库不会转移旧连接中尚未送达的材料。',
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
