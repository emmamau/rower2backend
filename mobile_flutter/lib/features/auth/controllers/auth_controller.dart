import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../models/user_profile.dart';

final authControllerProvider = StateNotifierProvider<AuthController, AsyncValue<UserProfile?>>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final storage = ref.watch(secureStorageServiceProvider);
  return AuthController(apiClient, storage);
});

class AuthController extends StateNotifier<AsyncValue<UserProfile?>> {
  final ApiClient _apiClient;
  final SecureStorageService _storage;

  AuthController(this._apiClient, this._storage) : super(const AsyncValue.loading()) {
    init();
  }

  /// Initialise la session depuis le stockage persistant chiffré
  Future<void> init() async {
    try {
      final savedUserId = await _storage.getUserId();
      final savedPseudo = await _storage.getDisplayPseudo();
      final jwtToken = await _storage.getJwtToken();
      final devToken = await _storage.getDeviceToken();

      if (savedUserId != null && savedUserId.isNotEmpty) {
        if (jwtToken != null && jwtToken.isNotEmpty) {
          // Tenter de rafraîchir le profil utilisateur depuis le serveur
          try {
            final res = await _apiClient.getUserProfile(savedUserId);
            if (res.statusCode == 200 && res.data is Map) {
              final profile = UserProfile.fromMap(
                Map<String, dynamic>.from(res.data as Map),
                deviceToken: devToken,
              );
              state = AsyncValue.data(profile);
              return;
            }
          } catch (_) {}
        }

        // Profil hors ligne ou invité avec pseudo persisté
        state = AsyncValue.data(
          UserProfile(
            id: savedUserId,
            login: savedPseudo ?? savedUserId,
            name: savedPseudo ?? savedUserId,
            deviceToken: devToken,
          ),
        );
      } else {
        state = const AsyncValue.data(null);
      }
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Connexion d'un membre avec mot de passe (POST /api/auth/login)
  /// + Auto-provisioning transparent du deviceToken pour /boost si manquant
  Future<UserProfile> login(String login, String password) async {
    state = const AsyncValue.loading();
    try {
      final deviceId = await _storage.getOrCreateDeviceId();
      final res = await _apiClient.login(login, password, deviceId: deviceId);

      if (res.statusCode != 200 || res.data is! Map) {
        throw Exception(res.data?['message'] ?? 'Erreur lors de la connexion');
      }

      final data = Map<String, dynamic>.from(res.data as Map);
      final token = data['token']?.toString() ?? '';
      await _storage.saveJwtToken(token);

      String? devToken;
      if (data['pairedDevice'] is Map) {
        devToken = data['pairedDevice']['deviceToken']?.toString();
      }

      final userMap = data['user'] is Map ? Map<String, dynamic>.from(data['user'] as Map) : data;
      final profile = UserProfile.fromMap(userMap, deviceToken: devToken);

      await _storage.saveUserId(profile.id);
      await _storage.saveDisplayPseudo(profile.displayPseudo);

      // Si le compte n'a pas encore de deviceToken (joueur mobile sans montre Garmin),
      // auto-provisionner un deviceToken authentique via code + claim en tâche de fond
      if (devToken == null || devToken.isEmpty) {
        devToken = await _autoProvisionDeviceToken(profile.displayPseudo, deviceId);
      }

      if (devToken != null && devToken.isNotEmpty) {
        await _storage.saveDeviceToken(devToken);
      }

      final completeProfile = UserProfile.fromMap(userMap, deviceToken: devToken);
      state = AsyncValue.data(completeProfile);
      return completeProfile;
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      rethrow;
    }
  }

  /// Résolution atomique du Code Unique 5 Caractères (POST /api/session/claim)
  /// Permet de rejoindre un salon privé ou de lier une session en un geste
  Future<Map<String, dynamic>> claimSessionCode(String code5, {String? customPseudo}) async {
    final deviceId = await _storage.getOrCreateDeviceId();
    final res = await _apiClient.claimSessionCode(
      code: code5,
      deviceId: deviceId,
      pseudo: customPseudo,
    );

    if (res.statusCode != 200 || res.data is! Map) {
      throw Exception(res.data?['message'] ?? res.data?['error'] ?? 'Code invalide ou expiré');
    }

    final data = Map<String, dynamic>.from(res.data as Map);
    final devToken = data['deviceToken']?.toString();
    final userId = data['userId']?.toString() ?? 'guest_${code5.toLowerCase()}';
    final playerName = data['playerName']?.toString() ?? customPseudo ?? userId;

    if (devToken != null && devToken.isNotEmpty) {
      await _storage.saveDeviceToken(devToken);
    }
    await _storage.saveUserId(userId);
    await _storage.saveDisplayPseudo(playerName);

    final guestProfile = UserProfile(
      id: userId,
      login: playerName,
      name: playerName,
      deviceToken: devToken,
    );
    state = AsyncValue.data(guestProfile);

    return data;
  }

  /// Assure qu'un joueur invité sans compte dispose d'un deviceToken valide pour /boost
  Future<String> ensureDeviceToken({String? guestName}) async {
    String? current = await _storage.getDeviceToken();
    if (current != null && current.isNotEmpty) return current;

    final deviceId = await _storage.getOrCreateDeviceId();
    final pseudo = guestName ?? (await _storage.getDisplayPseudo()) ?? 'Rameur_Mobile';
    final newDevToken = await _autoProvisionDeviceToken(pseudo, deviceId);

    if (newDevToken != null && newDevToken.isNotEmpty) {
      await _storage.saveDeviceToken(newDevToken);
      await _storage.saveUserId('guest_${deviceId.substring(0, 8)}');
      await _storage.saveDisplayPseudo(pseudo);
      return newDevToken;
    }

    return '';
  }

  /// Auto-provisioning via session/code + session/claim
  Future<String?> _autoProvisionDeviceToken(String pseudo, String deviceId) async {
    try {
      final codeRes = await _apiClient.requestSessionCode(
        type: 'guest_cockpit',
        playerName: pseudo,
      );
      if (codeRes.statusCode == 200 && codeRes.data is Map) {
        final code5 = codeRes.data['code']?.toString();
        if (code5 != null && code5.isNotEmpty) {
          final claimRes = await _apiClient.claimSessionCode(
            code: code5,
            deviceId: deviceId,
            pseudo: pseudo,
          );
          if (claimRes.statusCode == 200 && claimRes.data is Map) {
            return claimRes.data['deviceToken']?.toString();
          }
        }
      }
    } catch (_) {}
    return null;
  }

  /// Déconnexion
  Future<void> logout() async {
    await _storage.clearUserSession();
    state = const AsyncValue.data(null);
  }
}
