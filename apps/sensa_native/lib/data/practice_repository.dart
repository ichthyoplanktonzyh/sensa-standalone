import 'dart:convert';
import '../src/rust/api/library.dart' as native;

class PracticeRepository {
  PracticeRepository(this.path);
  final String path;
  Future<Map<String, dynamic>> load() async =>
      jsonDecode(await native.libraryPractice(path: path))
          as Map<String, dynamic>;
  Future<Map<String, dynamic>> execute(Map<String, dynamic> command) async =>
      jsonDecode(
            await native.libraryPracticeCommand(
              path: path,
              commandJson: jsonEncode(command),
            ),
          )
          as Map<String, dynamic>;
}
