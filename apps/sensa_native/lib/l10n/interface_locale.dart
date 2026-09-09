import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'generated/app_localizations.dart';

export 'generated/app_localizations.dart';

/// Device UI preference, separate from the library and learning target language.
final interfaceLocale = InterfaceLocale();

/// Presentation models resolve messages when read, using the active UI locale.
AppLocalizations get l10n => interfaceLocale.strings;

extension SensaLocalization on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
  String localDate(DateTime date) => DateFormat.yMMMd(
    Localizations.localeOf(this).toLanguageTag(),
  ).format(date);
}

class InterfaceLocale extends ChangeNotifier {
  Locale _locale = const Locale('zh');
  File? _file;
  bool saving = false;
  bool saveFailed = false;
  Locale get locale => _locale;
  AppLocalizations get strings => lookupAppLocalizations(_locale);

  Future<void> load(File file) async {
    _file = file;
    try {
      final value = jsonDecode(await file.readAsString());
      _locale = Locale(value is Map && value['language'] == 'en' ? 'en' : 'zh');
    } catch (_) {
      _locale = const Locale('zh');
    }
    notifyListeners();
  }

  Future<void> select(String language) async {
    if (saving || !['zh', 'en'].contains(language)) return;
    saving = true;
    saveFailed = false;
    notifyListeners();
    try {
      final file = _file;
      if (file != null) {
        await file.parent.create(recursive: true);
        final pending = File('${file.path}.pending');
        await pending.writeAsString(
          jsonEncode({'language': language}),
          flush: true,
        );
        await pending.rename(file.path);
      }
      _locale = Locale(language);
    } catch (_) {
      saveFailed = true;
    } finally {
      saving = false;
      notifyListeners();
    }
  }
}
