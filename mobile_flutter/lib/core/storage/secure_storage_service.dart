import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

final secureStorageServiceProvider = Provider<SecureStorageService>((ref) {
  return SecureStorageService();
});

class SecureStorageService {
  final FlutterSecureStorage _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  static const String _keyDeviceId = 'device_id';
  static const String _keyJwtToken = 'jwt_token';
  static const String _keyDeviceToken = 'device_token';
  static const String _keyUserId = 'user_id';
  static const String _keyDisplayPseudo = 'display_pseudo';
  static const String _keyLastBleRemoteId = 'last_ble_remote_id';
  static const String _keyLastBleDeviceName = 'last_ble_device_name';
  static const String _keyCustomApiUrl = 'custom_api_url';

  /// Récupère ou génère un UUID matériel unique pour l'appareil mobile
  Future<String> getOrCreateDeviceId() async {
    String? devId = await _storage.read(key: _keyDeviceId);
    if (devId == null || devId.trim().isEmpty) {
      devId = 'flutter_${const Uuid().v4()}';
      await _storage.write(key: _keyDeviceId, value: devId);
    }
    return devId;
  }

  Future<String?> getJwtToken() => _storage.read(key: _keyJwtToken);
  Future<void> saveJwtToken(String token) => _storage.write(key: _keyJwtToken, value: token);
  Future<void> clearJwtToken() => _storage.delete(key: _keyJwtToken);

  Future<String?> getDeviceToken() => _storage.read(key: _keyDeviceToken);
  Future<void> saveDeviceToken(String token) => _storage.write(key: _keyDeviceToken, value: token);
  Future<void> clearDeviceToken() => _storage.delete(key: _keyDeviceToken);

  Future<String?> getUserId() => _storage.read(key: _keyUserId);
  Future<void> saveUserId(String userId) => _storage.write(key: _keyUserId, value: userId);

  Future<String?> getDisplayPseudo() => _storage.read(key: _keyDisplayPseudo);
  Future<void> saveDisplayPseudo(String pseudo) => _storage.write(key: _keyDisplayPseudo, value: pseudo);

  Future<String?> getLastBleRemoteId() => _storage.read(key: _keyLastBleRemoteId);
  Future<String?> getLastBleDeviceName() => _storage.read(key: _keyLastBleDeviceName);
  Future<void> saveLastBleDevice(String remoteId, String deviceName) async {
    await _storage.write(key: _keyLastBleRemoteId, value: remoteId);
    await _storage.write(key: _keyLastBleDeviceName, value: deviceName);
  }
  Future<void> clearLastBleDevice() async {
    await _storage.delete(key: _keyLastBleRemoteId);
    await _storage.delete(key: _keyLastBleDeviceName);
  }

  Future<String?> getCustomApiUrl() => _storage.read(key: _keyCustomApiUrl);
  Future<void> saveCustomApiUrl(String url) => _storage.write(key: _keyCustomApiUrl, value: url);

  /// Efface la session joueur (déconnexion)
  Future<void> clearUserSession() async {
    await _storage.delete(key: _keyJwtToken);
    await _storage.delete(key: _keyDeviceToken);
    await _storage.delete(key: _keyUserId);
    await _storage.delete(key: _keyDisplayPseudo);
  }
}
