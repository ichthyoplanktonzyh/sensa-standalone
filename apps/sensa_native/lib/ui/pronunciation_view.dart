import 'dart:async';
import 'dart:typed_data';
import '../data/local_audio.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

/// Mounted only after Reveal; disposal stops playback when the learner leaves that step.
class PronunciationView extends StatefulWidget {
  const PronunciationView({
    super.key,
    required this.model,
    required this.material,
  });
  final LibraryViewModel model;
  final Map<String, dynamic> material;
  @override
  State<PronunciationView> createState() => _PronunciationViewState();
}

class _PronunciationViewState extends State<PronunciationView> {
  final player = LocalAudioPlayer();
  StreamSubscription<void>? completed;
  Uint8List? bytes;
  bool loading = false;
  bool playing = false;
  String? message;
  @override
  void initState() {
    super.initState();
    completed = player.onPlayerComplete.listen(
      (_) {
        // Android may emit completion after a decoder error. Preserve the error.
        if (mounted && playing) {
          setState(() {
            playing = false;
            message = '发音播放完成';
          });
        }
      },
      onError: (Object _) {
        if (mounted) {
          setState(() {
            playing = false;
            message = '发音无法播放，可以继续文字学习或重试播放。';
          });
        }
      },
    );
    if (widget.material['pronunciation'] != null) {
      unawaited(load());
    }
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      message = null;
    });
    try {
      final result = await widget.model.obtainPronunciation(widget.material);
      if (mounted) {
        setState(() {
          bytes = result;
          message = '发音已保存到本机，可离线播放';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          message = '发音暂不可用，可以继续文字学习；联网并配置服务后重试。';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          loading = false;
        });
      }
    }
  }

  Future<void> play() async {
    setState(() {
      playing = true;
      message = null;
    });
    try {
      await player.play(bytes!).timeout(const Duration(seconds: 10));
    } catch (_) {
      if (mounted) {
        setState(() {
          playing = false;
          message = '发音无法播放，可以继续文字学习或重试播放。';
        });
      }
    }
  }

  @override
  void dispose() {
    unawaited(completed?.cancel());
    unawaited(player.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.material['pronunciation'] == null) {
      return const Text(
        '暂无静态发音，可以继续文字学习。',
        key: ValueKey('pronunciation-absent'),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (message != null)
          Text(message!, key: const ValueKey('pronunciation-status')),
        TextButton.icon(
          key: const ValueKey('pronunciation-play'),
          onPressed: loading || playing
              ? null
              : bytes == null
              ? load
              : play,
          icon: Icon(playing ? Icons.volume_up : Icons.play_arrow),
          label: Text(
            loading
                ? '正在获取发音…'
                : playing
                ? '正在播放…'
                : bytes == null
                ? '重试下载发音'
                : '播放发音',
          ),
        ),
      ],
    );
  }
}
