// The old Sensa wire remains regression evidence. Production actions now use
// AgentScreen; these helpers exercise the retained adapter, not removed buttons.
import 'package:flutter_test/flutter_test.dart';
import 'package:sensa_native/ui/library_view_model.dart';
import 'package:sensa_native/ui/semantic_resolution_screen.dart';
import 'package:sensa_native/ui/preparation_screen.dart';

Future<void> resolveLegacyFixture(
  WidgetTester tester,
  LibraryViewModel model, {
  String? clarification,
}) async {
  final screen = tester.widget<SemanticResolutionScreen>(
    find.byType(SemanticResolutionScreen),
  );
  await model.resolveSemantic(
    screen.capture,
    intakeId: screen.intakeId,
    previousId: clarification == null ? null : model.lookups.first['id'],
    clarification: clarification,
  );
}

Future<void> prepareLegacyFixture(
  WidgetTester tester,
  LibraryViewModel model,
) async {
  final screen = tester.widget<PreparationScreen>(
    find.byType(PreparationScreen),
  );
  final meaning = (model.snapshot!.personal['meanings'] as List)
      .where((m) => m['id'] == screen.meaningId)
      .firstOrNull;
  final id = screen.taskId ?? meaning?['preparation']?['id'];
  expect(id, isNotNull);
  await model.prepareContent(id);
}
