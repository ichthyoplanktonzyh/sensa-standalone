import 'dart:convert';
import 'dart:typed_data';
import 'package:file_selector/file_selector.dart';
import '../src/rust/api/library.dart' as native;
import 'library_repository.dart';

class WorldRepository {
  WorldRepository(this.library);
  final LibraryRepository library;
  Future<Map<String, dynamic>> load() async =>
      jsonDecode(await native.libraryWorld(path: library.path))
          as Map<String, dynamic>;
  Future<String> putImage(Uint8List bytes) =>
      native.libraryWorldPutMedia(path: library.path, bytes: bytes);
  Future<Uint8List> image(String digest) =>
      native.libraryWorldMedia(path: library.path, digest: digest);
  Future<Uint8List?> pickImage() async {
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
          uniformTypeIdentifiers: [
            'public.png',
            'public.jpeg',
            'org.webmproject.webp',
          ],
        ),
      ],
    );
    if (file == null) return null;
    if (await file.length() > 4 * 1024 * 1024) throw StateError('图片超过4MB');
    return file.readAsBytes();
  }
}
