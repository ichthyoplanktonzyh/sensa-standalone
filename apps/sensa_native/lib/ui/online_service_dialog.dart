import 'package:flutter/material.dart';
import 'library_view_model.dart';

Future<void> configureOnlineService(
  BuildContext context,
  LibraryViewModel model,
) async {
  final address = TextEditingController(text: model.semanticService.origin);
  final token = TextEditingController();
  String? error;
  await showDialog<void>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: const Text('在线解析服务'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('使用已配置模型的 Sensa 服务。地址和访问令牌仅用于本次应用会话；本地资料无需登录。'),
              TextField(
                key: const ValueKey('semantic-origin'),
                controller: address,
                decoration: const InputDecoration(
                  labelText: '服务根地址（HTTPS 或本机回环）',
                ),
              ),
              TextField(
                key: const ValueKey('semantic-token'),
                controller: token,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: 'Sensa 访问令牌（不是模型 API Key）',
                ),
              ),
              if (error != null) Text(error!),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              try {
                model.semanticService.configure(address.text, token.text);
                Navigator.pop(context);
              } catch (_) {
                setDialogState(() => error = '请填写有效的服务根地址和访问令牌。');
              }
            },
            child: const Text('使用此服务'),
          ),
        ],
      ),
    ),
  );
  // Dialog route disposal occurs after its exit animation.
  await Future<void>.delayed(const Duration(milliseconds: 300));
  address.dispose();
  token.dispose();
}
