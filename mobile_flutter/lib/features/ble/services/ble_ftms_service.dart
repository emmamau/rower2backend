import 'dart:async';
import 'dart:math' as math;
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../models/rowing_metrics.dart';

final bleFtmsServiceProvider = Provider<BleFtmsService>((ref) {
  final storage = ref.watch(secureStorageServiceProvider);
  final service = BleFtmsService(storage);
  ref.onDispose(() => service.dispose());
  return service;
});

class BleFtmsService {
  final SecureStorageService _storage;

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

  // Variables de tare matérielle et de détection décimétrique (alignement Garmin RowerDataModel.mc)
  int _baselineRawDistance = 0;
  int _baselineRawStrokes = 0;
  int _lastRawDistance = 0;
  int _lastRawStrokes = 0;
  int _distanceOffset = 0;
  int _strokesOffset = 0;
  bool _isDecimeterDistance = false;
  bool _isFirstPacket = true;

  // Cumul moyenne puissance et cadence
  int _wattsSum = 0;
  int _wattsCount = 0;
  double _spmSum = 0.0;
  int _spmCount = 0;

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
        // Filtrer les périphériques exposant FTMS ou ayant un nom évocateur de rameur
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
        _parseFtmsRowerData(value);
      });

      _isFirstPacket = true;
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
    _baselineRawDistance = _lastRawDistance;
    _baselineRawStrokes = _lastRawStrokes;
    _distanceOffset = 0;
    _strokesOffset = 0;
    _currentMetrics = _currentMetrics.copyWith(
      totalDistance: 0,
      strokeCount: 0,
      elapsedTime: 0,
    );
    _metricsController.add(_currentMetrics);
  }

  /// Aligne la distance avec une valeur officielle renvoyée par le serveur
  void alignDistance(int authoritativeDistance) {
    if (authoritativeDistance <= 0) {
      reTareToZero();
      return;
    }
    if (authoritativeDistance > _currentMetrics.totalDistance) {
      _distanceOffset = authoritativeDistance - (_lastRawDistance - _baselineRawDistance);
      _currentMetrics = _currentMetrics.copyWith(totalDistance: authoritativeDistance);
      _metricsController.add(_currentMetrics);
    }
  }

  // =========================================================================
  // DÉCODEUR BINAIRE FTMS ROWER DATA (0x2AD1) - Porté de RowerDataModel.mc
  // =========================================================================
  void _parseFtmsRowerData(List<int> bytes) {
    if (bytes.length < 2) return;

    final int flags = (bytes[0] & 0xFF) | ((bytes[1] & 0xFF) << 8);
    int offset = 2;

    int rawStrokes = _lastRawStrokes;
    int rawDistance = _lastRawDistance;
    double packetSpm = 0.0;
    int packetPace = 0;
    int packetWatts = 0;
    int calories = _currentMetrics.calories;
    int heartRate = _currentMetrics.heartRate;

    bool hasPacketSpm = false;
    bool hasPacketPace = false;
    bool hasPacketWatts = false;

    // Bit 0 : More Data (0 = Stroke Rate [uint8 0.5 spm] + Stroke Count [uint16] présents)
    if ((flags & 0x0001) == 0 && offset + 3 <= bytes.length) {
      final rawSpm = bytes[offset] & 0xFF;
      packetSpm = rawSpm * 0.5;
      rawStrokes = (bytes[offset + 1] & 0xFF) | ((bytes[offset + 2] & 0xFF) << 8);
      hasPacketSpm = true;
      offset += 3;
    }

    // Bit 1 : Average Stroke Rate (uint8, 0.5 spm)
    if ((flags & 0x0002) != 0 && offset + 1 <= bytes.length) {
      offset += 1;
    }

    // Bit 2 : Total Distance (uint24 Little Endian, mètres)
    if ((flags & 0x0004) != 0 && offset + 3 <= bytes.length) {
      rawDistance = (bytes[offset] & 0xFF) |
          ((bytes[offset + 1] & 0xFF) << 8) |
          ((bytes[offset + 2] & 0xFF) << 16);
      offset += 3;
    }

    // Bit 3 : Instantaneous Pace (uint16 Little Endian, secondes / 500m)
    if ((flags & 0x0008) != 0 && offset + 2 <= bytes.length) {
      final rawPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
      if (rawPace != 0xFFFF && rawPace > 0) {
        packetPace = rawPace;
        hasPacketPace = true;
      }
      offset += 2;
    }

    // Bit 4 : Average Pace (uint16)
    if ((flags & 0x0010) != 0 && offset + 2 <= bytes.length) {
      offset += 2;
    }

    // Bit 5 : Instantaneous Power (sint16 Little Endian, Watts)
    if ((flags & 0x0020) != 0 && offset + 2 <= bytes.length) {
      int rawWatts = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
      if (rawWatts > 32767) rawWatts -= 65536;
      if (rawWatts > 0) {
        packetWatts = rawWatts;
        hasPacketWatts = true;
      }
      offset += 2;
    }

    // Bit 6 : Average Power (sint16)
    if ((flags & 0x0040) != 0 && offset + 2 <= bytes.length) {
      offset += 2;
    }

    // Bit 7 : Resistance Level (sint16)
    if ((flags & 0x0080) != 0 && offset + 2 <= bytes.length) {
      offset += 2;
    }

    // Bit 8 : Expended Energy (Total Energy uint16 kcal)
    if ((flags & 0x0100) != 0) {
      if (offset + 2 <= bytes.length) {
        final rawKcal = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
        if (rawKcal != 0xFFFF) calories = rawKcal;
        offset += (offset + 5 <= bytes.length) ? 5 : 2;
      }
    }

    // Bit 9 : Heart Rate (uint8, bpm)
    if ((flags & 0x0200) != 0 && offset + 1 <= bytes.length) {
      heartRate = bytes[offset] & 0xFF;
      offset += 1;
    }

    // Détection et correction décimètres (Merach / NovaRow : envoi de 0.1m)
    if (rawDistance > 0) {
      if (!_isDecimeterDistance) {
        final dDist = rawDistance > _lastRawDistance ? rawDistance - _lastRawDistance : 0;
        final dStrokes = rawStrokes > _lastRawStrokes ? rawStrokes - _lastRawStrokes : 0;
        final isMerach = (_deviceName ?? '').toUpperCase().contains('MERACH') ||
            (_deviceName ?? '').toUpperCase().contains('MRK');
        if (dStrokes > 0 && (dDist / dStrokes) >= (isMerach ? 20.0 : 35.0)) {
          _isDecimeterDistance = true;
          _baselineRawDistance = (_baselineRawDistance + 5) ~/ 10;
        }
      }
      if (_isDecimeterDistance) {
        rawDistance = (rawDistance + 5) ~/ 10;
      }
    }

    if (_isFirstPacket) {
      _isFirstPacket = false;
      _baselineRawDistance = rawDistance;
      _baselineRawStrokes = rawStrokes;
      _lastRawDistance = rawDistance;
      _lastRawStrokes = rawStrokes;
      _distanceOffset = 0;
      _strokesOffset = 0;
      return;
    }

    // Dérivation Allure <-> Puissance Concept2 : P = 2.80 * (500 / Pace)^3
    if (packetWatts <= 0 && packetPace > 0 && packetPace < 600) {
      final splitRatio = packetPace / 500.0;
      final denom = splitRatio * splitRatio * splitRatio;
      if (denom > 0) {
        packetWatts = ((2.80 / denom) + 0.5).toInt();
      }
    } else if (packetWatts > 0 && packetPace <= 0) {
      final v = math.pow(packetWatts / 2.80, 1.0 / 3.0);
      if (v > 0) {
        packetPace = (500.0 / v).round();
      }
    }

    // Calcul de la distance réelle tarée
    final curRelD = rawDistance >= _baselineRawDistance ? rawDistance - _baselineRawDistance : 0;
    final curRelS = rawStrokes >= _baselineRawStrokes ? rawStrokes - _baselineRawStrokes : 0;

    int totalDist = _distanceOffset + curRelD;
    int totalStr = _strokesOffset + curRelS;

    // Protection anti-recul local
    if (totalDist < _currentMetrics.totalDistance) {
      totalDist = _currentMetrics.totalDistance;
    }

    _lastRawDistance = rawDistance;
    _lastRawStrokes = rawStrokes;

    if (packetWatts > 0) {
      _wattsSum += packetWatts;
      _wattsCount++;
    }
    if (packetSpm > 0) {
      _spmSum += packetSpm;
      _spmCount++;
    }

    final avgW = _wattsCount > 0 ? (_wattsSum / _wattsCount).round() : 0;
    final avgS = _spmCount > 0 ? (_spmSum / _spmCount) : 0.0;

    final isMoving = packetWatts > 10 || packetSpm > 8.0 || (hasPacketPace && packetPace > 0);

    _currentMetrics = RowingMetrics(
      instantPower: hasPacketWatts ? packetWatts : _currentMetrics.instantPower,
      avgPower: avgW,
      instantPace: hasPacketPace ? packetPace : _currentMetrics.instantPace,
      avgPace: _currentMetrics.avgPace,
      strokeRate: hasPacketSpm ? packetSpm : _currentMetrics.strokeRate,
      avgStrokeRate: avgS,
      totalDistance: totalDist,
      strokeCount: totalStr,
      elapsedTime: _currentMetrics.elapsedTime,
      calories: calories,
      heartRate: heartRate,
      isMoving: isMoving,
    );

    _metricsController.add(_currentMetrics);
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
