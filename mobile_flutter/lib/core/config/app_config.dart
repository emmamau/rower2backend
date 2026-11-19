class AppConfig {
  static const String _defaultApiUrl = 'https://rower-api-service.onrender.com';

  /// URL d'API définie au moment de la compilation via --dart-define=API_URL=...
  /// ou retombée sur l'instance de production Render.com.
  static String get defaultBaseUrl {
    const fromEnv = String.fromEnvironment('API_URL');
    if (fromEnv.isNotEmpty) {
      return fromEnv.trim().replaceAll(RegExp(r'/+$'), '');
    }
    return _defaultApiUrl;
  }

  /// Nettoie une URL pour s'assurer du protocole https/http sans slash terminal
  static String sanitizeUrl(String url) {
    var clean = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (clean.isNotEmpty && !clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://$clean';
    }
    return clean.isEmpty ? _defaultApiUrl : clean;
  }
}
