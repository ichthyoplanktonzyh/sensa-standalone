import 'dart:convert';
import 'package:sensa_native/src/rust/api/library.dart' as native;

/// Read models contain only projections. Rust owns every domain transition.
class LibrarySnapshot {
  LibrarySnapshot._(this.value);
  factory LibrarySnapshot.decode(String encoded) => LibrarySnapshot._(
    Map<String, dynamic>.unmodifiable(
      jsonDecode(encoded) as Map<String, dynamic>,
    ),
  );
  final Map<String, dynamic> value;
  List<Map<String, dynamic>> get catalog =>
      (value['catalog'] as List? ?? []).cast<Map<String, dynamic>>();
  String get id => value['libraryId'] as String;
  int get revision => value['revision'] as int;
  int? get quantity => value['dailyNewLimit'] as int?;
  Map<String, dynamic>? get material =>
      value['material'] as Map<String, dynamic>?;
  Map<String, dynamic>? get run => value['run'] as Map<String, dynamic>?;
  bool get enrolled => value['enrolled'] as bool;
  String? get phase => run?['phase'] as String?;
  bool get paused => run?['paused'] as bool? ?? false;
  int? get dueAtMs => value['dueAtMs'] as int?;
}

class LibraryRepository {
  LibraryRepository(this.path);
  final String path;
  Future<LibrarySnapshot> load() async =>
      LibrarySnapshot.decode(await native.librarySnapshot(path: path));
  Future<LibrarySnapshot> execute(Map<String, dynamic> command) async =>
      LibrarySnapshot.decode(
        await native.libraryCommand(
          path: path,
          commandJson: jsonEncode(command),
        ),
      );
}
