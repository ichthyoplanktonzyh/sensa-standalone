import 'dart:convert';
import 'dart:typed_data';
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
  bool get inStudyScope =>
      ((value['curriculum']?['scope']?['members'] as List?) ?? []).any(
        (m) => m['materialId'] == material?['id'],
      );
  String? get phase => run?['phase'] as String?;
  bool get paused => run?['paused'] as bool? ?? false;
  String get protocol =>
      run?['protocolVersion'] as String? ?? 'consumer-initial-v1';
  Map<String, dynamic> get retention =>
      value['retention'] as Map<String, dynamic>? ?? {};
  int? get nextEligibleAtMs => retention['nextEligibleAtMs'] as int?;
  Map<String, dynamic> get policyState =>
      value['policyState'] as Map<String, dynamic>? ?? {};
  Map<String, dynamic>? get policyPlan =>
      policyState['selected'] as Map<String, dynamic>?;
  List<Map<String, dynamic>> get policyChoices =>
      (policyState['choices'] as List? ?? []).cast<Map<String, dynamic>>();
  bool get policyCommitted => policyPlan?['committed'] == true;
  Map<String, dynamic>? get initialReadiness =>
      policyPlan?['plan']?['purposes']?['initial_learning']?['readiness']
          as Map<String, dynamic>?;
  String policyLabel(String? id) =>
      policyChoices
          .where((c) => c['policy']['profileId'] == id)
          .map((c) => c['label'] as String)
          .firstOrNull ??
      (id ?? '尚未设置');
  String get policySourceLabel =>
      switch (policyPlan?['plan']?['effective']?['scope']) {
        'target' => '此项单独设置',
        'curriculum' => '学习包默认设置',
        'learner' => '我的默认设置',
        _ => '系统默认设置',
      };
  String get selectedPolicyLabel => policyLabel(
    policyPlan?['plan']?['effective']?['policy']?['profileId'] as String?,
  );
  String get defaultPolicyLabel =>
      policyLabel(policyState['defaultPolicy']?['profileId'] as String?);
  Map<String, dynamic> get personal =>
      (value['personal'] as Map<String, dynamic>?) ?? {};
  Map<String, dynamic> get learning =>
      (value['learning'] as Map<String, dynamic>?) ?? {};
  Map<String, dynamic>? get activity =>
      learning['activity'] as Map<String, dynamic>?;
  Map<String, dynamic>? get assurance =>
      value['assurance'] as Map<String, dynamic>?;
  int? get dueAtMs => value['dueAtMs'] as int?;
}

class LibraryRepository {
  LibraryRepository(this.path);
  final String path;
  Future<Uint8List> media(String sessionId, String reference) =>
      native.libraryAssuranceMedia(
        path: path,
        sessionId: sessionId,
        reference: reference,
      );
  Future<Uint8List> pronunciation(String materialId) =>
      native.libraryCachedPronunciation(path: path, materialId: materialId);
  Future<void> cachePronunciation(String materialId, Uint8List bytes) =>
      native.libraryCachePronunciation(
        path: path,
        materialId: materialId,
        bytes: bytes,
      );
  Future<Map<String, dynamic>> history(Map<String, dynamic> query) async =>
      jsonDecode(
            await native.libraryHistory(
              path: path,
              queryJson: jsonEncode(query),
            ),
          )
          as Map<String, dynamic>;
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
