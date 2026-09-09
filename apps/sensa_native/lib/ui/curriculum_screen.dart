import '../l10n/interface_locale.dart';
import 'product_theme.dart';
import 'package:flutter/material.dart';
import 'library_view_model.dart';

class CurriculumScreen extends StatefulWidget {
  const CurriculumScreen({super.key, required this.model});
  final LibraryViewModel model;
  @override
  State<CurriculumScreen> createState() => _CurriculumScreenState();
}

class _CurriculumScreenState extends State<CurriculumScreen> {
  String search = '';
  Map<String, dynamic> get data =>
      widget.model.snapshot!.value['curriculum'] as Map<String, dynamic>;
  List<Map<String, dynamic>> rows(String key) =>
      (data[key] as List).cast<Map<String, dynamic>>();
  Future<void> action(Map<String, dynamic> value) =>
      widget.model.act({'kind': 'curriculum', 'action': value});
  String label(String mode) => switch (mode) {
    'active' => context.l10n.uiCurrentNewLearning,
    'maintenance' => context.l10n.uiContinueStartedContentOnly,
    _ => context.l10n.uiPaused,
  };
  Future<void> selectSources() async {
    final chosen =
        (data['scope']['selection'] as List?)?.cast<String>().toSet() ??
        {'supplemental', ...rows('enrollments').map((e) => e['id'] as String)};
    final result = await showDialog<List<String>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          title: Text(context.l10n.uiChooseLearningSources),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final source in [
                  {
                    'id': 'supplemental',
                    'title': context.l10n.uiAdditionalLearning,
                  },
                  ...rows('enrollments').map(
                    (e) => {
                      'id': e['id'],
                      'title':
                          '${rows('books').firstWhere((b) => b['id'] == e['bookId'] && b['version'] == e['version'])['title']} · ${label(e['mode'])}',
                    },
                  ),
                ])
                  CheckboxListTile(
                    title: Text(source['title'] as String),
                    value: chosen.contains(source['id']),
                    onChanged: (v) => set(() {
                      v == true
                          ? chosen.add(source['id'] as String)
                          : chosen.remove(source['id']);
                    }),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, chosen.toList()),
              child: Text(context.l10n.uiApplySources),
            ),
          ],
        ),
      ),
    );
    if (result != null) {
      await action({'kind': 'select_sources', 'source_ids': result});
    }
  }

  String expression(String id) =>
      widget.model.snapshot!.catalog
          .map((m) => m['material'] as Map<String, dynamic>)
          .where((m) => m['id'] == id)
          .map((m) => '${m['expression']} · ${m['sense']}')
          .firstOrNull ??
      id;
  Future<Map<String, dynamic>?> range(
    Map<String, dynamic> book, {
    Map<String, dynamic>? initial,
  }) async {
    String mode = initial?['kind'] as String? ?? 'all';
    final start = TextEditingController(text: '${initial?['start'] ?? 1}'),
        end = TextEditingController(
          text: '${initial?['end'] ?? (book['members'] as List).length}',
        );
    final members = (book['members'] as List).cast<Map<String, dynamic>>(),
        selected =
            (initial?['material_ids'] as List?)?.cast<String>().toSet() ??
            <String>{};
    final sections = members
        .map((m) => m['section'])
        .whereType<String>()
        .toSet()
        .toList();
    String? section = initial?['section'] as String? ?? sections.firstOrNull;
    String? error;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          title: Text(context.l10n.uiAdjustNewLearningRange),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(context.l10n.uiThisChangesFutureNewLearningStarted),
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: mode,
                    items: [
                      DropdownMenuItem(
                        value: 'all',
                        child: Text(context.l10n.uiWholeBook),
                      ),
                      DropdownMenuItem(
                        value: 'ordinals',
                        child: Text(context.l10n.uiByPosition),
                      ),
                      DropdownMenuItem(
                        value: 'section',
                        child: Text(context.l10n.uiByChapter),
                      ),
                      DropdownMenuItem(
                        value: 'selection',
                        child: Text(context.l10n.uiSpecificMeanings),
                      ),
                    ],
                    onChanged: (v) => set(() {
                      mode = v!;
                      error = null;
                    }),
                  ),
                  if (mode == 'ordinals') ...[
                    TextField(
                      key: const ValueKey('range-start'),
                      controller: start,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: context.l10n.uiStartPosition,
                      ),
                    ),
                    TextField(
                      key: const ValueKey('range-end'),
                      controller: end,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: context.l10n.uiEndPosition,
                      ),
                    ),
                  ],
                  if (mode == 'section')
                    sections.isEmpty
                        ? Text(context.l10n.uiThisVersionHasNoChapters)
                        : DropdownButton<String>(
                            value: section,
                            items: sections
                                .map(
                                  (s) => DropdownMenuItem(
                                    value: s,
                                    child: Text(s),
                                  ),
                                )
                                .toList(),
                            onChanged: (v) => set(() => section = v),
                          ),
                  if (mode == 'selection')
                    SizedBox(
                      height: 250,
                      child: ListView.builder(
                        itemCount: members.length,
                        itemBuilder: (context, i) {
                          final id = members[i]['materialId'] as String;
                          return CheckboxListTile(
                            title: Text(expression(id)),
                            value: selected.contains(id),
                            onChanged: (v) => set(() {
                              v == true
                                  ? selected.add(id)
                                  : selected.remove(id);
                            }),
                          );
                        },
                      ),
                    ),
                  if (error != null)
                    Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.l10n.uiCancel),
            ),
            FilledButton(
              onPressed: () {
                final a = int.tryParse(start.text), b = int.tryParse(end.text);
                if (mode == 'ordinals' &&
                        (a == null ||
                            b == null ||
                            a < 1 ||
                            a > b ||
                            b > members.length) ||
                    mode == 'section' && section == null ||
                    mode == 'selection' && selected.isEmpty) {
                  set(() => error = context.l10n.uiChooseAValidNonemptyRange);
                  return;
                }
                Navigator.pop(context, {
                  'kind': mode,
                  if (mode == 'ordinals') ...{'start': a, 'end': b},
                  if (mode == 'section') 'section': section,
                  if (mode == 'selection') 'material_ids': selected.toList(),
                });
              },
              child: Text(context.l10n.uiSaveRange),
            ),
          ],
        ),
      ),
    );
    start.dispose();
    end.dispose();
    return result;
  }

  Future<void> inspect(Map<String, dynamic> book) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) =>
            BookMembersScreen(book: book, model: widget.model),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.model,
    builder: (context, _) {
      final model = widget.model;
      final active = model.snapshot!.activity?['status'] == 'active';
      final enabled = !model.busy && !active;
      final books = rows('books')
          .where(
            (b) => '${b['title']} ${b['id']}'.toLowerCase().contains(
              search.toLowerCase(),
            ),
          )
          .toList();
      return Scaffold(
        appBar: AppBar(title: Text(context.l10n.uiLearningSources)),
        body: Readable(
          child: ListView(
            key: const ValueKey('curriculum-scroll'),
            padding: const EdgeInsets.all(20),
            children: [
              Text(context.l10n.uiBooksAndAdditionalLearningShareYour),
              if (model.error != null) Text(model.error!),
              if (active)
                FilledButton(
                  onPressed: model.busy ? null : () => model.stopActivity(),
                  child: Text(context.l10n.uiPauseLearningToMakeChanges),
                ),
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: enabled ? model.importPack : null,
                    child: Text(context.l10n.uiImportAPackageOrBook),
                  ),
                  OutlinedButton(
                    onPressed: enabled ? selectSources : null,
                    child: Text(context.l10n.uiChooseLearningSources),
                  ),
                  TextButton(
                    onPressed: enabled
                        ? () => action({
                            'kind': 'select_sources',
                            'source_ids': null,
                          })
                        : null,
                    child: Text(context.l10n.uiUseAllSources),
                  ),
                ],
              ),
              Text(
                context.l10n.uiCurrentScopeItemsIncludingThoseBeing(
                  ((data['scope']['members'] as List).length).toString(),
                ),
              ),
              TextField(
                key: const ValueKey('book-search'),
                decoration: InputDecoration(
                  labelText: context.l10n.uiSearchBooks,
                ),
                onChanged: (v) => setState(() => search = v),
              ),
              if (books.isEmpty)
                Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(context.l10n.uiNoMatchingBooksImportALearning),
                ),
              for (final b in books)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          context.l10n.uiVersion(
                            (b['title']).toString(),
                            (b['version']).toString(),
                          ),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text(
                          context.l10n.uiMeanings(
                            (b['members'] as List).length,
                          ),
                        ),
                        Wrap(
                          spacing: 8,
                          children: [
                            TextButton(
                              onPressed: () => inspect(b),
                              child: Text(
                                context.l10n.uiBrowseAndSearchContent,
                              ),
                            ),
                            FilledButton(
                              onPressed: enabled
                                  ? () async {
                                      final selected = await range(b);
                                      if (selected != null) {
                                        await action({
                                          'kind': 'enroll',
                                          'book_id': b['id'],
                                          'version': b['version'],
                                          'range': selected,
                                        });
                                      }
                                    }
                                  : null,
                              child: Text(context.l10n.uiUseForNewLearning),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              const Divider(),
              Text(
                context.l10n.uiSelectedBooks,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              for (final e in rows('enrollments')) ...[
                Text(
                  '${rows('books').firstWhere((b) => b['id'] == e['bookId'] && b['version'] == e['version'])['title']} · ${e['version']}',
                ),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  key: ValueKey('enrollment-${e['id']}-${e['mode']}'),
                  initialValue: e['mode'] as String,
                  items: ['active', 'maintenance', 'paused']
                      .map(
                        (m) =>
                            DropdownMenuItem(value: m, child: Text(label(m))),
                      )
                      .toList(),
                  onChanged: enabled
                      ? (v) => action({
                          'kind': 'set_mode',
                          'enrollment_id': e['id'],
                          'mode': v,
                        })
                      : null,
                ),
                TextButton(
                  onPressed: enabled
                      ? () async {
                          final b = rows('books').firstWhere(
                            (b) =>
                                b['id'] == e['bookId'] &&
                                b['version'] == e['version'],
                          );
                          final r = await range(
                            b,
                            initial: e['range'] as Map<String, dynamic>,
                          );
                          if (r != null) {
                            await action({
                              'kind': 'set_range',
                              'enrollment_id': e['id'],
                              'range': r,
                            });
                          }
                        }
                      : null,
                  child: Text(context.l10n.uiAdjustNewLearningRange),
                ),
              ],
              const Divider(),
              Text(
                context.l10n.uiAdditionalLearning,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (rows('supplemental').isEmpty)
                Text(context.l10n.uiMeaningsAddedIndividuallyAppearHere),
              for (final (i, m) in rows('supplemental').indexed)
                ListTile(
                  title: Text(m['expression'] as String),
                  subtitle: Text(
                    m['active'] == true
                        ? context.l10n.uiIncludedInLearning
                        : context.l10n.uiRemovedFromLearningHistoryKept,
                  ),
                  trailing: Wrap(
                    children: [
                      if (i > 0)
                        IconButton(
                          tooltip: context.l10n.uiMoveUp,
                          onPressed: enabled
                              ? () => action({
                                  'kind': 'move_supplemental',
                                  'target_id': m['targetId'],
                                  'before_target_id': rows(
                                    'supplemental',
                                  )[i - 1]['targetId'],
                                })
                              : null,
                          icon: const Icon(Icons.arrow_upward),
                        ),
                      TextButton(
                        onPressed: enabled
                            ? () => action({
                                'kind': 'supplemental',
                                'target_id': m['targetId'],
                                'active': m['active'] != true,
                              })
                            : null,
                        child: Text(
                          m['active'] == true
                              ? context.l10n.uiRemoveFromLearning
                              : context.l10n.uiResumeLearning513,
                        ),
                      ),
                    ],
                  ),
                ),
              const Divider(),
              Text(context.l10n.uiPausedSessionsKeepTheirScopeA),
              FilledButton(
                onPressed: enabled
                    ? () async {
                        await model.act({
                          'kind': 'activity_fresh',
                          'mode': 'mixed',
                        });
                        if (context.mounted && model.error == null) {
                          Navigator.pop(context);
                        }
                      }
                    : null,
                child: Text(context.l10n.uiStartWithCurrentSources),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class BookMembersScreen extends StatefulWidget {
  const BookMembersScreen({super.key, required this.book, required this.model});
  final Map<String, dynamic> book;
  final LibraryViewModel model;
  @override
  State<BookMembersScreen> createState() => _BookMembersScreenState();
}

class _BookMembersScreenState extends State<BookMembersScreen> {
  String search = '';
  int visible = 40;
  @override
  Widget build(BuildContext context) {
    final materials = widget.model.snapshot!.catalog
        .map((m) => m['material'] as Map<String, dynamic>)
        .toList();
    final members = (widget.book['members'] as List)
        .map(
          (m) => materials.where((v) => v['id'] == m['materialId']).firstOrNull,
        )
        .whereType<Map<String, dynamic>>()
        .where(
          (m) => '${m['expression']} ${m['sense']}'.toLowerCase().contains(
            search.toLowerCase(),
          ),
        )
        .toList();
    return Scaffold(
      appBar: AppBar(title: Text(widget.book['title'] as String)),
      body: Readable(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            TextField(
              key: const ValueKey('book-member-search'),
              decoration: InputDecoration(
                labelText: context.l10n.uiSearchExpressionsOrMeanings217,
              ),
              onChanged: (v) => setState(() {
                search = v;
                visible = 40;
              }),
            ),
            Text(context.l10n.uiItemsFound(members.length)),
            for (final m in members.take(visible))
              ListTile(
                onTap: widget.model.busy
                    ? null
                    : () async {
                        await widget.model.selectMaterial(m['id'] as String);
                        if (context.mounted && widget.model.error == null) {
                          Navigator.of(
                            context,
                          ).popUntil((route) => route.isFirst);
                        }
                      },
                title: Text(m['expression'] as String),
                subtitle: Text(m['sense'] as String),
                trailing: Text(
                  widget.model.snapshot!.catalog.firstWhere(
                            (c) => c['material']['id'] == m['id'],
                          )['completed'] ==
                          true
                      ? context.l10n.uiInitialLearningCompleted
                      : context.l10n.uiInitialLearningNotCompleted,
                ),
              ),
            if (members.length > visible)
              TextButton(
                onPressed: () => setState(() => visible += 40),
                child: Text(context.l10n.uiShowMore),
              ),
          ],
        ),
      ),
    );
  }
}
