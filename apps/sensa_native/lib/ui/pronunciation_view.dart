import '../l10n/interface_locale.dart';
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
            message = context.l10n.uiAudioFinished;
          });
        }
      },
      onError: (Object _) {
        if (mounted) {
          setState(() {
            playing = false;
            message = context.l10n.uiAudioUnavailableContinueWithTextOr;
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
          message = context.l10n.uiAudioSavedForOfflinePlayback;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          message = context.l10n.uiAudioUnavailableConnectToYourService;
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
          message = context.l10n.uiAudioUnavailableContinueWithTextOr;
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
      return Text(
        context.l10n.uiNoAudioYetYouCanContinue,
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
                ? context.l10n.uiDownloadingAudio
                : playing
                ? context.l10n.uiPlaying477
                : bytes == null
                ? context.l10n.uiRetryAudioDownload
                : context.l10n.uiPlayPronunciation,
          ),
        ),
      ],
    );
  }
}
