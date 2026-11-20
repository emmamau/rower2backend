import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../models/rowing_metrics.dart';
import 'ble_ftms_decoder.dart';

export 'ble_ftms_decoder.dart';

final bleFtmsServiceProvider = Provider<BleFtmsService>((ref) {
  final storage = ref.watch(secureStorageServiceProvider);
  final service = BleFtmsService(storage);
  ref.onDispose(() => service.dispose());
  return service;
});

final bleConnectionStatusProvider = StreamProvider<BleConnectionStatus>((ref) {
  final service = ref.watch(bleFtmsServiceProvider);
  return service.statusStream;
});

final connectedDeviceNameProvider = Provider<String?>((ref) {
  final service = ref.watch(bleFtmsServiceProvider);
  ref.watch(bleConnectionStatusProvider);
  return service.deviceName;
});

final rowingMetricsStreamProvider = StreamProvider<RowingMetrics>((ref) {
  final service = ref.watch(bleFtmsServiceProvider);
  return service.metricsStream;
});

class BleFtmsService {
  final SecureStorageService _storage;
  final BleFtmsDecoder _decoder = BleFtmsDecoder();

  // UUIDs Bluetooth SIG FTMS standard
  static final Guid ftmsServiceUuid = Guid('00001826-0000-1000-8000-00805f9b34fb');
  static final Guid rowerDataCharUuid = Guid('00002ad1-0000-1000-8000-00805f9b34fb');
  static final Guid controlPointCharUuid = Guid('00002ad9-0000-1000-8000-00805f9b34fb');

  BluetoothDevice? _connectedDevice;
  StreamSubscription? _adapterStateSub;
  StreamSubscription? _scanResultsSub;
  StreamSubscription? _connectionStateSub;
  StreamSubscription? _charNotificationsSub;

  final _statusController = StreamController<BleConnectionStatus>.broadcast();
  final _metricsController = StreamController<RowingMetrics>.broadcast();
  final _scanResultsController = StreamController<List<ScanResult>>.broadcast();

  Stream<BleConnectionStatus> get statusStream => _statusController.stream;
  Stream<RowingMetrics> get metricsStream => _metricsController.stream;
  Stream<List<ScanResult>> get scanResultsStream => _scanResultsController.stream;

  BleConnectionStatus _currentStatus = BleConnectionStatus.disconnected;
  BleConnectionStatus get currentStatus => _currentStatus;

  String? _deviceName;
  String? get deviceName => _deviceName;

  RowingMetrics _currentMetrics = const RowingMetrics();
  RowingMetrics get currentMetrics => _currentMetrics;

  BleFtmsService(this._storage) {
    _statusController.add(BleConnectionStatus.disconnected);
  }

  /// Lance le scan BLE pour découvrir les rameurs compatibles FTMS
  Future<void> startScan() async {
    if (_currentStatus == BleConnectionStatus.scanning) return;

    _setStatus(BleConnectionStatus.scanning);

    try {
      if (await FlutterBluePlus.adapterState.first != BluetoothAdapterState.on) {
        _setStatus(BleConnectionStatus.disconnected);
        return;
      }

      _scanResultsSub?.cancel();
      _scanResultsSub = FlutterBluePlus.scanResults.listen((results) {
        final filtered = results.where((r) {
          final name = r.device.platformName.toUpperCase();
          final hasFtms = r.advertisementData.serviceUuids.any(
            (u) => u.toString().toLowerCase().contains('1826'),
          );
          final matchesRowerName = name.contains('ROW') ||
              name.contains('ERG') ||
              name.contains('PM5') ||
              name.contains('CONCEPT') ||
              name.contains('WATER') ||
              name.contains('MERACH') ||
              name.contains('DOMYOS') ||
              name.contains('SKILLROW') ||
              name.contains('SMART') ||
              name.contains('FTMS');
          return hasFtms || matchesRowerName;
        }).toList();

        _scanResultsController.add(filtered);
      });

      await FlutterBluePlus.startScan(
        timeout: const Duration(seconds: 15),
      );
    } catch (_) {
      _setStatus(BleConnectionStatus.disconnected);
    }
  }

  /// Arrête le scan BLE
  Future<void> stopScan() async {
    try {
      await FlutterBluePlus.stopScan();
    } catch (_) {}
    if (_currentStatus == BleConnectionStatus.scanning) {
      _setStatus(BleConnectionStatus.disconnected);
    }
  }

  /// Tente une reconnexion immédiate en 1 tap au dernier rameur enregistré
  Future<bool> reconnectLastDevice() async {
    final remoteId = await _storage.getLastBleRemoteId();
    final savedName = await _storage.getLastBleDeviceName();
    if (remoteId == null || remoteId.isEmpty) return false;

    final device = BluetoothDevice.fromId(remoteId);
    return connectToDevice(device, knownName: savedName);
  }

  /// Connexion et abonnement aux notifications FTMS d'un rameur
  Future<bool> connectToDevice(BluetoothDevice device, {String? knownName}) async {
    await stopScan();
    _setStatus(BleConnectionStatus.connecting);

    try {
      await device.connect(autoConnect: false, timeout: const Duration(seconds: 12));
      _connectedDevice = device;
      _deviceName = device.platformName.isNotEmpty ? device.platformName : (knownName ?? 'Rameur BLE');
      _decoder.deviceName = _deviceName;
      _decoder.reset();
      _decoder.isFirstPacket = true;

      // Sauvegarde pour reconnexion 1-tap ultérieure
      await _storage.saveLastBleDevice(device.remoteId.str, _deviceName!);

      _connectionStateSub?.cancel();
      _connectionStateSub = device.connectionState.listen((state) {
        if (state == BluetoothConnectionState.disconnected) {
          _handleDisconnection();
        }
      });

      // Découverte des services GATT
      final services = await device.discoverServices();
      BluetoothCharacteristic? rowerDataChar;
      BluetoothCharacteristic? controlPointChar;

      for (final s in services) {
        if (s.uuid.toString().toLowerCase().contains('1826')) {
          for (final c in s.characteristics) {
            final cu = c.uuid.toString().toLowerCase();
            if (cu.contains('2ad1')) {
              rowerDataChar = c;
            } else if (cu.contains('2ad9')) {
              controlPointChar = c;
            }
          }
        }
      }

      if (rowerDataChar == null) {
        await device.disconnect();
        _setStatus(BleConnectionStatus.disconnected);
        return false;
      }

      // Initialisation du contrôle de flux si présent
      if (controlPointChar != null) {
        try {
          await controlPointChar.write([0x01], withoutResponse: false);
        } catch (_) {}
      }

      // Abonnement aux notifications de la caractéristique Rower Data
      await rowerDataChar.setNotifyValue(true);
      _charNotificationsSub?.cancel();
      _charNotificationsSub = rowerDataChar.onValueReceived.listen((value) {
        _currentMetrics = _decoder.decode(value, _currentMetrics);
        _metricsController.add(_currentMetrics);
      });

      _setStatus(BleConnectionStatus.connected);
      return true;
    } catch (_) {
      _setStatus(BleConnectionStatus.disconnected);
      return false;
    }
  }

  /// Déconnexion manuelle
  Future<void> disconnect() async {
    _charNotificationsSub?.cancel();
    _connectionStateSub?.cancel();
    try {
      await _connectedDevice?.disconnect();
    } catch (_) {}
    _connectedDevice = null;
    _setStatus(BleConnectionStatus.disconnected);
  }

  void _handleDisconnection() {
    _charNotificationsSub?.cancel();
    _connectedDevice = null;
    _setStatus(BleConnectionStatus.disconnected);
  }

  void _setStatus(BleConnectionStatus s) {
    _currentStatus = s;
    _statusController.add(s);
  }

  /// Réinitialise la tare matérielle à zéro (au départ de course T=0 ou après alerte faux départ)
  void reTareToZero() {
    _decoder.reTareToZero();
    _currentMetrics = _currentMetrics.copyWith(
      totalDistance: 0,
      strokeCount: 0,
      elapsedTime: 0,
    );
    _metricsController.add(_currentMetrics);
  }

  /// Aligne la distance avec une valeur officielle renvoyée par le serveur
  void alignDistance(int authoritativeDistance) {
    _decoder.alignDistance(authoritativeDistance, _currentMetrics.totalDistance);
    if (authoritativeDistance > _currentMetrics.totalDistance) {
      _currentMetrics = _currentMetrics.copyWith(totalDistance: authoritativeDistance);
      _metricsController.add(_currentMetrics);
    }
  }

  void dispose() {
    stopScan();
    disconnect();
    _adapterStateSub?.cancel();
    _scanResultsSub?.cancel();
    _connectionStateSub?.cancel();
    _charNotificationsSub?.cancel();
    _statusController.close();
    _metricsController.close();
    _scanResultsController.close();
  }
}
