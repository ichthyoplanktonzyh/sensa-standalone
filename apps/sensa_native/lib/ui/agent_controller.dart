import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/library_repository.dart';
import '../data/world_repository.dart';
import '../data/agent_provider.dart';
import '../src/rust/api/library.dart' as native;

class AgentController extends ChangeNotifier {
  AgentController(this.library)
    : providers = AgentProviders(File('${library.path}.agent-providers.json'));
  final LibraryRepository library;
  final AgentProviders providers;
  final transport = AgentTransport();
  List<Map<String, dynamic>> sessions = [];
  String? error;
  bool busy = false, closed = false;
  int epoch = 0;
  Future<void> pending = Future.value();
  bool loaded = false;
  Map<String, dynamic> session(String id) =>
      sessions.firstWhere((s) => s['id'] == id);
  void changed() {
    if (!closed) notifyListeners();
  }

  Future<void> load() async {
    if (!loaded) {
      loaded = true;
      try {
        await providers.load();
      } catch (_) {
        error = '模型配置无法读取，请重新设置；本机对话仍可查看。';
      }
    }
    try {
      sessions =
          (jsonDecode(
                    await native.libraryAgents(path: library.path),
                  )['sessions']
                  as List)
              .cast<Map<String, dynamic>>();
    } catch (_) {
      error = '本机对话无法读取，请重试。';
    }
    changed();
  }

  Future<void> act(Map<String, dynamic> Function() action) {
    final next = pending.then((_) async {
      await load();
      final s = await library.load();
      final c = {
        'operationId': const Uuid().v4(),
        'libraryId': s.id,
        'expectedRevision': s.revision,
        'action': {'kind': 'agent', 'action': action()},
      };
      try {
        await library.execute(c);
      } catch (_) {
        await library.execute(c);
      }
      await load();
    });
    pending = next.catchError((_) {});
    return next;
  }

  Future<String?> create(Map<String, dynamic> source) async {
    error = null;
    try {
      final id = const Uuid().v4();
      await act(
        () => {
          'kind': 'create',
          'id': id,
          'source': {
            ...source,
            if (source['kind'] == 'content' &&
                providers.forPurpose('content') != null)
              'service_origin': Uri.parse(
                providers.forPurpose('content')!['endpoint'],
              ).origin,
          },
        },
      );
      return id;
    } catch (e) {
      error = describe(e);
      changed();
      return null;
    }
  }

  Future<void> say(String id, String text) async {
    try {
      await act(
        () => {
          'kind': 'say',
          'id': id,
          'revision': session(id)['revision'],
          'message': text,
        },
      );
      await run(id);
    } catch (e) {
      error = describe(e);
      changed();
    }
  }

  String purpose(String id) => session(id)['kind'] == 'teacher'
      ? 'teacher'
      : session(id)['candidate'] != null
      ? 'review'
      : 'content';

  Future<void> run(String id) async {
    if (busy) return;
    if (session(id)['status'] == 'ready') {
      try {
        await act(
          () => {
            'kind': 'commit',
            'id': id,
            'revision': session(id)['revision'],
          },
        );
        error = null;
      } catch (e) {
        error = describe(e);
      }
      changed();
      return;
    }
    if (!providers.ready(purpose(id))) {
      error = '请先选择模型服务并保存有效凭据。';
      changed();
      return;
    }
    busy = true;
    error = null;
    final token = ++epoch;
    changed();
    String? lease;
    try {
      for (var step = 0; step < 8; step++) {
        if (epoch != token) return;
        if (!providers.ready(purpose(id))) {
          throw const AgentFailure('credentials');
        }
        await act(
          () => {
            'kind': 'lease',
            'id': id,
            'revision': session(id)['revision'],
            'provider': providers.connection(
              providers.forPurpose(purpose(id))!,
            ),
          },
        );
        if (epoch != token) return;
        final req =
            jsonDecode(
                  await native.libraryAgentRequest(path: library.path, id: id),
                )
                as Map<String, dynamic>;
        lease = req['id'];
        final result = await transport.complete(
          req,
          providers,
          WorldRepository(library),
        );
        if (epoch != token) return;
        await act(
          () => {
            'kind': req['purpose'] == 'review' ? 'review' : 'turn',
            'id': id,
            'lease_id': lease,
            ...result,
          },
        );
        lease = null;
        final status = session(id)['status'];
        if (status == 'ready') {
          await act(
            () => {
              'kind': 'commit',
              'id': id,
              'revision': session(id)['revision'],
            },
          );
          return;
        }
        if (status == 'waiting' ||
            status == 'proposal' ||
            status == 'committed') {
          return;
        }
      }
      await act(
        () => {'kind': 'stop', 'id': id, 'revision': session(id)['revision']},
      );
      error = '这一轮先停在这里。可以查看记录后明确继续。';
    } catch (e) {
      if (epoch == token) {
        error = describe(e);
        if (lease != null) {
          try {
            await act(() => {'kind': 'fail', 'id': id, 'lease_id': lease});
          } catch (_) {}
        }
      }
    } finally {
      if (epoch == token) {
        busy = false;
        changed();
      }
    }
  }

  Future<void> stop(String id) async {
    epoch++;
    transport.cancel();
    try {
      await act(
        () => {'kind': 'stop', 'id': id, 'revision': session(id)['revision']},
      );
    } catch (e) {
      error = describe(e);
    }
    busy = false;
    changed();
  }

  Future<void> accept(String id) async {
    error = null;
    try {
      await act(
        () => {
          'kind': 'accept',
          'id': id,
          'revision': session(id)['revision'],
          'consent': 'accept_context_expression_sense',
        },
      );
    } catch (e) {
      error = describe(e);
    }
    changed();
  }

  String describe(Object e) {
    final code = e is AgentFailure ? e.code : e.toString();
    if (code.contains('secure_storage')) {
      return '系统安全存储暂不可用，凭据没有以明文保存。请解锁设备后重试。';
    }
    if (code.contains('vision')) return '这份材料含图片。请选择支持图片的模型服务，或返回后明确选择只讨论文字。';
    if (code.contains('credentials')) return '凭据未设置或已失效，请重新填写。';
    if (code.contains('budget') || code.contains('limit')) {
      return '本轮次数已用完，已保留对话和候选，不会继续自动调用。';
    }
    if (code.contains('conflict') ||
        code.contains('draft_') ||
        code.contains('superseded') ||
        code.contains('stale')) {
      return '材料或任务已发生变化，旧结果没有覆盖新内容。请返回查看最新状态。';
    }
    if (code.contains('anchor_recipient')) {
      return '原文授权的接收服务与当前选择不一致。请选择原授权服务，或返回撤销、重新授权后再准备。';
    }
    if (code.contains('unsupported_content_policy')) {
      return '当前资源循环不支持此学习方式，原来的学习选择已保留。';
    }
    if (code.contains('size')) return '图片或对话超过本次发送大小限制，请减少材料后重试。';
    if (code.contains('configuration')) return '请填写有效的服务地址、名称和模型。';
    return '这轮暂时没有完成，对话已保存在本机。可以检查服务设置后明确继续。';
  }

  @override
  void dispose() {
    epoch++;
    transport.cancel();
    providers.clear();
    closed = true;
    super.dispose();
  }
}
