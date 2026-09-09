import 'dart:io';
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';

/// Playback staging is disposable. Verified durable bytes remain in the local library.
class LocalAudioPlayer {
  final _player = AudioPlayer();
  Directory? _directory;
  bool _disposed = false;
  int _sequence = 0;
  Stream<void> get onPlayerComplete => _player.onPlayerComplete;
  Future<void> play(Uint8List bytes) async {
    if (_disposed) return;
    // Some platform adapters assume the cache directory already exists and omit
    // the file extension. Create only our own temporary .mp3 staging file.
    final root = await getTemporaryDirectory();
    await root.create(recursive: true);
    final directory =
        _directory ?? await root.createTemp('sensa-pronunciation-');
    if (_disposed) {
      if (await directory.exists()) await directory.delete(recursive: true);
      return;
    }
    _directory = directory;
    final file = File('${directory.path}/audio-${_sequence++}.mp3');
    await _player.stop();
    await file.writeAsBytes(bytes, flush: true);
    if (!_disposed) {
      await _player.play(DeviceFileSource(file.path, mimeType: 'audio/mpeg'));
    }
  }

  Future<void> dispose() async {
    _disposed = true;
    try {
      await _player.dispose();
    } finally {
      final directory = _directory;
      if (directory != null && await directory.exists()) {
        await directory.delete(recursive: true);
      }
    }
  }
}
