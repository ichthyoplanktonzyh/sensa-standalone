import '../data/agent_provider.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import '../data/provider_auth.dart';
import 'agent_controller.dart';

class ProviderLoginScreen extends StatefulWidget {
  const ProviderLoginScreen({
    super.key,
    required this.controller,
    required this.profile,
  });
  final AgentController controller;
  final Map<String, dynamic> profile;
  @override
  State<ProviderLoginScreen> createState() => _ProviderLoginScreenState();
}

class _ProviderLoginScreenState extends State<ProviderLoginScreen> {
  final address = TextEditingController(),
      apiKey = TextEditingController(),
      email = TextEditingController(),
      code = TextEditingController();
  bool busy = false, sent = false, cooling = false;
  String? notice;
  Timer? timer;
  @override
  void dispose() {
    timer?.cancel();
    for (final c in [address, apiKey, email, code]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> perform(Future<void> Function() action) async {
    setState(() {
      busy = true;
      notice = null;
    });
    try {
      await action();
    } on OnlineAuthFailure catch (e) {
      notice = switch (e.code) {
        'invalid' => '验证码或登录凭据已失效，请重新登录。',
        'email' => '请填写有效邮箱。',
        'rate_limit' => '发送过于频繁，请稍后重试。',
        'access' => '邮箱已验证，但此在线服务尚未允许访问，请检查受邀资格或服务地址。',
        'configuration' => '请检查认证项目地址与公开访问密钥。',
        _ => '在线登录暂不可用，请稍后重试；本机学习不受影响。',
      };
    } on AgentFailure catch (e) {
      notice = e.code == 'secure_storage'
          ? '登录凭据未能安全保存，请检查系统安全存储。'
          : '在线访问尚未恢复，请检查受邀资格、网络或重新登录。';
    } catch (_) {
      notice = '登录凭据未能安全保存，请重新检查系统安全存储后重试。';
    } finally {
      widget.controller.changed();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final providers = widget.controller.providers;
    final signed = providers.accountEmail(widget.profile['id']);
    return Scaffold(
      appBar: AppBar(title: const Text('在线服务账户')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('服务：${widget.profile['name']}\n${widget.profile['endpoint']}'),
          const Text('登录只用于访问这个在线服务。本机资料、学习进度和所属学习库不会随登录或退出改变；这不会启用同步。'),
          if (signed != null) ...[
            Text('已登录：$signed', key: const ValueKey('provider-account-email')),
            Text(providers.status(widget.profile['id'])),
            OutlinedButton(
              onPressed: busy
                  ? null
                  : () => perform(() async {
                      final role = ['teacher', 'content', 'review', 'service']
                          .where(
                            (r) =>
                                providers.forPurpose(r)?['id'] ==
                                widget.profile['id'],
                          )
                          .firstOrNull;
                      if (role == null) {
                        notice = '请先把这个服务分配给需要的用途。';
                        return;
                      }
                      await providers.ensureAccess(role);
                      notice = '在线访问凭据已检查。';
                    }),
              child: const Text('检查在线访问'),
            ),

            FilledButton(
              onPressed: busy
                  ? null
                  : () => perform(() async {
                      await providers.logout(widget.profile['id']);
                      notice = '已退出本机在线服务账户。';
                    }),
              child: const Text('退出在线账户'),
            ),
          ] else ...[
            const Text('使用受邀邮箱验证码登录。认证项目地址与公开访问密钥由服务提供方提供，登录会将邮箱发送到该认证项目。'),
            TextField(
              key: const ValueKey('auth-url'),
              controller: address,
              enabled: !busy,
              decoration: const InputDecoration(
                labelText: '认证项目地址',
                hintText: 'https://your-project.supabase.co',
              ),
            ),
            TextField(
              key: const ValueKey('auth-key'),
              controller: apiKey,
              enabled: !busy,
              obscureText: true,
              decoration: const InputDecoration(labelText: '公开访问密钥'),
            ),
            TextField(
              key: const ValueKey('auth-email'),
              controller: email,
              enabled: !busy,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: '受邀邮箱'),
            ),
            OutlinedButton(
              onPressed: busy || cooling
                  ? null
                  : () => perform(() async {
                      await ProviderAuth.sendCode(
                        address.text.trim(),
                        apiKey.text.trim(),
                        email.text.trim(),
                      );
                      sent = true;
                      cooling = true;
                      notice = '验证码已发送，请检查邮箱。';
                      timer?.cancel();
                      timer = Timer(const Duration(seconds: 60), () {
                        if (mounted) setState(() => cooling = false);
                      });
                    }),
              child: Text(cooling ? '请稍后再发送' : '发送验证码'),
            ),
            if (sent) ...[
              TextField(
                key: const ValueKey('auth-code'),
                controller: code,
                enabled: !busy,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: '邮箱验证码'),
              ),
              FilledButton(
                onPressed: busy
                    ? null
                    : () => perform(() async {
                        await providers.login(
                          widget.profile,
                          address.text.trim(),
                          apiKey.text.trim(),
                          email.text.trim(),
                          code.text.trim(),
                        );
                        code.clear();
                        apiKey.clear();
                        notice = '已登录，访问凭据保存在系统安全存储。';
                      }),
                child: const Text('验证并登录'),
              ),
            ],
          ],
          if (busy) const LinearProgressIndicator(),
          if (notice != null) Text(notice!),
        ],
      ),
    );
  }
}
