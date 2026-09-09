import '../l10n/interface_locale.dart';
import 'product_theme.dart';
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
        'invalid' => l10n.uiYourCodeOrCredentialsExpiredSign,
        'email' => l10n.uiEnterAValidEmailAddress,
        'rate_limit' => l10n.uiTooManyRequestsTryAgainLater,
        'access' => l10n.uiEmailVerifiedButAccessIsNot,
        'configuration' => l10n.uiCheckTheAuthenticationUrlAndPublic,
        _ => l10n.uiSignInIsUnavailableTryAgain,
      };
    } on AgentFailure catch (e) {
      notice = e.code == 'secure_storage'
          ? l10n.uiCredentialsCouldNotBeSavedSecurely
          : l10n.uiAccessCouldNotBeRestoredCheck;
    } catch (_) {
      notice = l10n.uiCredentialsCouldNotBeSavedSecurely8;
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
      appBar: AppBar(title: Text(context.l10n.uiOnlineAccount)),
      body: Readable(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              l10n.uiService(
                (widget.profile['name']).toString(),
                (widget.profile['endpoint']).toString(),
              ),
            ),
            Text(l10n.uiThisAccountProvidesAccessToThis),
            if (signed != null) ...[
              Text(
                l10n.uiSignedIn((signed).toString()),
                key: const ValueKey('provider-account-email'),
              ),
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
                          notice = l10n.uiAssignThisServiceToAPurpose;
                          return;
                        }
                        await providers.ensureAccess(role);
                        notice = l10n.uiAccessChecked;
                      }),
                child: Text(l10n.uiCheckAccess),
              ),

              FilledButton(
                onPressed: busy
                    ? null
                    : () => perform(() async {
                        await providers.logout(widget.profile['id']);
                        notice = l10n.uiSignedOut;
                      }),
                child: Text(l10n.uiSignOut),
              ),
            ] else ...[
              Text(l10n.uiSignInWithTheCodeSent),
              TextField(
                key: const ValueKey('auth-url'),
                controller: address,
                enabled: !busy,
                decoration: InputDecoration(
                  labelText: l10n.uiAuthenticationUrl,
                  hintText: 'https://your-project.supabase.co',
                ),
              ),
              TextField(
                key: const ValueKey('auth-key'),
                controller: apiKey,
                enabled: !busy,
                obscureText: true,
                decoration: InputDecoration(labelText: l10n.uiPublicAccessKey),
              ),
              TextField(
                key: const ValueKey('auth-email'),
                controller: email,
                enabled: !busy,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(labelText: l10n.uiInvitedEmail),
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
                        notice = l10n.uiCodeSentCheckYourEmail;
                        timer?.cancel();
                        timer = Timer(const Duration(seconds: 60), () {
                          if (mounted) setState(() => cooling = false);
                        });
                      }),
                child: Text(
                  cooling ? l10n.uiWaitBeforeResending : l10n.uiSendCode,
                ),
              ),
              if (sent) ...[
                TextField(
                  key: const ValueKey('auth-code'),
                  controller: code,
                  enabled: !busy,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: l10n.uiEmailCode),
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
                          notice = l10n.uiSignedInCredentialsSavedSecurely;
                        }),
                  child: Text(l10n.uiVerifyAndSignIn),
                ),
              ],
            ],
            if (busy) const LinearProgressIndicator(),
            if (notice != null) Text(notice!),
          ],
        ),
      ),
    );
  }
}
