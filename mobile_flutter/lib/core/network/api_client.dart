import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/app_config.dart';
import '../storage/secure_storage_service.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  final storage = ref.watch(secureStorageServiceProvider);
  return ApiClient(storage);
});

class ApiClient {
  final SecureStorageService _storage;
  late final Dio _dio;

  ApiClient(this._storage) {
    _dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.defaultBaseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 12),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // Utiliser l'URL dynamique personnalisée si définie
          final customUrl = await _storage.getCustomApiUrl();
          if (customUrl != null && customUrl.isNotEmpty) {
            options.baseUrl = AppConfig.sanitizeUrl(customUrl);
          }

          final path = options.path;
          final jwtToken = await _storage.getJwtToken();
          final deviceToken = await _storage.getDeviceToken();

          // Injection des jetons selon la destination de la route
          if (path.contains('/boost') || path.contains('/api/rooms/') || path.contains('/api/garmin/')) {
            if (deviceToken != null && deviceToken.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $deviceToken';
              options.headers['X-Device-Token'] = deviceToken;
            } else if (jwtToken != null && jwtToken.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $jwtToken';
            }
          } else if (jwtToken != null && jwtToken.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $jwtToken';
          }

          return handler.next(options);
        },
        onError: (DioException e, handler) {
          // Log ou gestion globale des erreurs réseau transitoires
          return handler.next(e);
        },
      ),
    );
  }

  Dio get rawDio => _dio;

  /// Met à jour l'URL de base du backend
  Future<void> updateBaseUrl(String newUrl) async {
    final sanitized = AppConfig.sanitizeUrl(newUrl);
    await _storage.saveCustomApiUrl(sanitized);
    _dio.options.baseUrl = sanitized;
  }

  Future<String> getEffectiveBaseUrl() async {
    final customUrl = await _storage.getCustomApiUrl();
    if (customUrl != null && customUrl.isNotEmpty) {
      return AppConfig.sanitizeUrl(customUrl);
    }
    return AppConfig.defaultBaseUrl;
  }

  // ==========================================
  // AUTHENTIFICATION & CODE UNIQUE 5 CARACTÈRES
  // ==========================================

  /// Connexion membre avec mot de passe (POST /api/auth/login)
  Future<Response> login(String login, String password, {String? deviceId}) async {
    return _dio.post(
      '/api/auth/login',
      data: {
        'login': login.trim(),
        'password': password,
        'deviceId': deviceId,
      },
    );
  }

  /// Profil et statistiques du joueur (GET /api/user/profile/:userId)
  Future<Response> getUserProfile(String userId) async {
    return _dio.get('/api/user/profile/${Uri.encodeComponent(userId)}');
  }

  /// Demande de génération d'un Code Unique 5 caractères (POST /api/session/code)
  Future<Response> requestSessionCode({
    required String type,
    String? userId,
    String? roomId,
    String? playerName,
  }) async {
    return _dio.post(
      '/api/session/code',
      data: {
        'type': type,
        'userId': userId,
        'roomId': roomId,
        'playerName': playerName,
      },
    );
  }

  /// Résolution d'un Code Unique 5 caractères par le mobile (POST /api/session/claim)
  Future<Response> claimSessionCode({
    required String code,
    required String deviceId,
    String? pseudo,
  }) async {
    return _dio.post(
      '/api/session/claim',
      data: {
        'code': code.trim().toUpperCase(),
        'deviceId': deviceId,
        'pseudo': pseudo,
        'playerName': pseudo,
      },
    );
  }

  // ==========================================
  // COURSE PUBLIQUE
  // ==========================================

  /// Récupère l'état de la prochaine course publique (GET /api/race/next)
  Future<Response> getNextPublicRace() async {
    return _dio.get('/api/race/next');
  }

  /// Rejoint la course publique en attente ou en cours (POST /api/race/join)
  Future<Response> joinPublicRace({
    required String userId,
    required String userName,
    required String deviceId,
    String? deviceToken,
    String action = 'join',
  }) async {
    return _dio.post(
      '/api/race/join',
      data: {
        'userId': userId,
        'userName': userName,
        'deviceId': deviceId,
        'deviceToken': deviceToken,
        'action': action,
      },
    );
  }

  // ==========================================
  // SALONS PRIVÉS & GESTION READY
  // ==========================================

  /// Récupère les détails d'un salon privé (GET /api/v1/races/private/:id)
  Future<Response> getPrivateRace(String identifier) async {
    return _dio.get('/api/v1/races/private/${Uri.encodeComponent(identifier.trim())}');
  }

  /// Rejoint un salon privé par code (POST /api/rooms/join)
  Future<Response> joinRoom({
    required String code,
    required String userId,
    required String userName,
    String? deviceToken,
    bool ready = false,
  }) async {
    return _dio.post(
      '/api/rooms/join',
      data: {
        'code': code.trim(),
        'pin': code.trim(),
        'userId': userId,
        'userName': userName,
        'deviceToken': deviceToken,
        'ready': ready,
      },
    );
  }

  /// Machine à états BLE : Notifie le serveur que le rameur est réveillé (READY: true)
  Future<Response> updateRoomReadyStatus({
    required String roomId,
    required bool ready,
    required String userId,
    String? deviceToken,
  }) async {
    return _dio.post(
      '/api/rooms/${Uri.encodeComponent(roomId.trim())}/status',
      data: {
        'ready': ready,
        'userId': userId,
        'deviceToken': deviceToken,
      },
    );
  }

  /// Quitte un salon privé (POST /api/rooms/leave)
  Future<Response> leaveRoom({
    required String roomId,
    required String userId,
    String? deviceToken,
  }) async {
    return _dio.post(
      '/api/rooms/leave',
      data: {
        'roomId': roomId.trim(),
        'code': roomId.trim(),
        'userId': userId,
        'deviceToken': deviceToken,
      },
    );
  }

  // ==========================================
  // TÉLÉMÉTRIE /BOOST (SYNCHRONISATION COURSE)
  // ==========================================

  /// Envoie un paquet de télémétrie coup par coup ou d'état final (POST /boost)
  Future<Response> sendBoostTelemetry(Map<String, dynamic> payload) async {
    return _dio.post('/boost', data: payload);
  }
}
