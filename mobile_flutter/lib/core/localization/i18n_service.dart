import 'dart:ui';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../storage/secure_storage_service.dart';
import 'app_strings.dart';

final i18nProvider = StateNotifierProvider<I18nNotifier, String>((ref) {
  final storage = ref.watch(secureStorageServiceProvider);
  return I18nNotifier(storage);
});

class I18nNotifier extends StateNotifier<String> {
  final SecureStorageService _storage;

  I18nNotifier(this._storage) : super(_resolveDefaultLanguage()) {
    _loadSavedLanguage();
  }

  static String _resolveDefaultLanguage() {
    final systemLocale = PlatformDispatcher.instance.locale.languageCode.toLowerCase();
    return systemLocale == 'fr' ? 'fr' : 'en';
  }

  Future<void> _loadSavedLanguage() async {
    final saved = await _storage.getLanguage();
    if (saved != null && (saved == 'fr' || saved == 'en')) {
      state = saved;
    }
  }

  Future<void> setLanguage(String lang) async {
    if (lang != 'fr' && lang != 'en') return;
    state = lang;
    await _storage.saveLanguage(lang);
  }

  String t(String key) {
    return AppStrings.get(key, state);
  }
}
