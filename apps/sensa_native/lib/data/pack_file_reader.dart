import 'dart:convert';
import 'dart:typed_data';
import 'package:file_selector/file_selector.dart';

/// OS-granted file access only. No arbitrary paths or cloud upload.
class PackFileReader {
  const PackFileReader();
  Future<String?> pick() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Sensa 学习包',
          extensions: ['json'],
          uniformTypeIdentifiers: ['public.json'],
        ),
      ],
    );
    if (file == null) return null;
    if (await file.length() > 20000000) throw StateError('pack_too_large');
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in file.openRead()) {
      if (bytes.length + chunk.length > 20000000) {
        throw StateError('pack_too_large');
      }
      bytes.add(chunk);
    }
    return utf8.decode(bytes.takeBytes());
  }
}
