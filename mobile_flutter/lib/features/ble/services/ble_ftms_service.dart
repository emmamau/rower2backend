import 'dart:async';
import 'package:flutter/foundation.dart';
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

final rowingMetricsStreamProvider = StreamProvider<RowingMetrics>((ref) async* {
  final service = ref.watch(bleFtmsServiceProvider);
  yield service.currentMetrics;
  yield* service.metricsStream;
});

void _bleLog(String msg) {
  if (kDebugMode) debugPrint('[BLE] $msg');
}

String _hex(List<int> v) => v.map((b) => (b & 0xFF).toRadixString(16).padLeft(2, '0')).join(' ');

class BleFtmsService {
  final SecureStorageService _storage;
  final BleFtmsDecoder _decoder = BleFtmsDecoder();

  // UUIDs Bluetooth SIG FTMS standard (0x1826, 0x2AD1, 0x2AD9) - inclut le broadcast EXR de SmartRow
  static final Guid ftmsServiceUuid = Guid('00001826-0000-1000-8000-00805f9b34fb');
  static final Guid rowerDataCharUuid = Guid('00002ad1-0000-1000-8000-00805f9b34fb');
  static final Guid controlPointCharUuid = Guid('00002ad9-0000-1000-8000-00805f9b34fb');

  // UUIDs Poulie matérielle directe WaterRower SmartRow (0x1234, 0x1235 Write, 0x1236 Notify)
  static final Guid smartRowServiceUuid = Guid('00001234-0000-1000-8000-00805f9b34fb');
  static final Guid smartRowWriteCharUuid = Guid('00001235-0000-1000-8000-00805f9b34fb');
  static final Guid smartRowDataCharUuid = Guid('00001236-0000-1000-8000-00805f9b34fb');

  BluetoothDevice? _connectedDevice;
  BluetoothCharacteristic? _srWriteChar;
  StreamSubscription? _adapterStateSub;
  StreamSubscription? _scanResultsSub;
  StreamSubscription? _connectionStateSub;
  StreamSubscription? _charNotificationsSub;
  Timer? _watchdogTimer;

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

  bool _isSmartRowDirect = false;
  bool get isSmartRowDirect => _isSmartRowDirect;

  RowingMetrics _currentMetrics = const RowingMetrics();
  RowingMetrics get currentMetrics => _currentMetrics;

  // État du handshake V2/V3 et file d'écriture SmartRow Direct
  final List<List<int>> _srWriteQueue = <List<int>>[];
  bool _srWriteBusy = false;
  int _srHandshakeState = 0; // 0 = non initialisé, 1 = init envoyée, 2 = challenge demandé, 3 = déverrouillé
  bool _srChallengeRequested = false;
  String _srRxBuffer = '';
  int _srV3LockTicks = 0;
  int _secondsWithoutData = 0;

  BleFtmsService(this._storage) {
    _statusController.add(BleConnectionStatus.disconnected);
  }

  /// Extrait le meilleur nom lisible d'un résultat de scan BLE (`platformName` ou `advName`)
  static String resolveScanResultName(ScanResult r) {
    final pName = r.device.platformName.trim();
    final aName = r.advertisementData.advName.trim();
    if (pName.isNotEmpty) return pName;
    if (aName.isNotEmpty) return aName;
    if (isSmartRowDirectScanResult(r)) return 'WaterRower SmartRow';
    if (isFtmsOrExrScanResult(r)) return 'Rameur FTMS / EXR';
    return 'Rameur BLE';
  }

  /// Détecte si un résultat de scan correspond à une poulie WaterRower SmartRow directe (0x1234 / Mfg 0x1235)
  static bool isSmartRowDirectScanResult(ScanResult r) {
    final hasSrService = r.advertisementData.serviceUuids.any(
      (u) => u.toString().toLowerCase().contains('1234'),
    );
    final hasSrServiceData = r.advertisementData.serviceData.keys.any(
      (u) => u.toString().toLowerCase().contains('1234'),
    );
    final hasSrMfgData = r.advertisementData.manufacturerData.keys.any(
      (id) => id == 0x1235 || id == 0x1234 || id == 0x3512 || id == 0x3412,
    );
    if (hasSrService || hasSrServiceData || hasSrMfgData) {
      return true;
    }

    final combinedName = '${r.device.platformName} ${r.advertisementData.advName}'.toUpperCase();
    final hasFtmsUuid = r.advertisementData.serviceUuids.any(
      (u) => u.toString().toLowerCase().contains('1826'),
    );
    if (!hasFtmsUuid &&
        (combinedName.contains('SMARTROW') ||
            combinedName.contains('PULLEY') ||
            combinedName.contains('POULIE') ||
            combinedName.startsWith('SR-') ||
            combinedName.startsWith('SR_') ||
            combinedName.startsWith('SR '))) {
      return true;
    }
    return false;
  }

  /// Détecte si un résultat de scan expose explicitement le service FTMS (0x1826 - dont Broadcast EXR SmartRow)
  static bool isFtmsOrExrScanResult(ScanResult r) {
    final hasFtmsService = r.advertisementData.serviceUuids.any(
      (u) => u.toString().toLowerCase().contains('1826'),
    );
    final hasFtmsServiceData = r.advertisementData.serviceData.keys.any(
      (u) => u.toString().toLowerCase().contains('1826'),
    );
    if (hasFtmsService || hasFtmsServiceData) return true;

    final combinedName = '${r.device.platformName} ${r.advertisementData.advName}'.toUpperCase();
    return combinedName.contains('EXR') || combinedName.contains('FTMS');
  }

  /// Priorité de tri dans la liste de scan (3 = SmartRow Direct / FTMS UUID, 2 = Nom de rameur, 1 = Passerelle smartphone EXR, 0 = Non pertinent)
  static int getScanResultPriority(ScanResult r) {
    if (isSmartRowDirectScanResult(r) || isFtmsOrExrScanResult(r)) {
      return 3;
    }

    final combined = '${r.device.platformName} ${r.advertisementData.advName}'.toUpperCase().trim();
    if (combined.isEmpty) return 0;

    const rowerKeywords = <String>[
      'SMARTROW',
      'WATERROWER',
      'WATER',
      'EXR',
      'FTMS',
      'ROW',
      'ERG',
      'PM5',
      'CONCEPT',
      'S4',
      'COMMODULE',
      'PIROWFLO',
      'PULLEY',
      'POULIE',
      'SR-',
      'SR_',
      'SR ',
      'WR-',
      'WR_',
      'WR ',
      'MERACH',
      'MRK',
      'MR-',
      'NOVAROW',
      'DOMYOS',
      'SKILLROW',
      'RP3',
      'FITSHOW',
      'FS-',
      'ICONSOLE',
      'KINOMAP',
      'KINO',
      'QZ',
      'ZWIFT',
      'JOROTO',
      'YESOUL',
      'XEBEX',
      'FDF',
      'ROGUE',
      'COXSWAIN',
      'WHIPR',
      'KETTLER',
      'TUNTURI',
      'SCHWINN',
      'PROFORM',
      'NORDIC',
      'AVIRON',
      'HYDROW',
      'SKANDIKA',
      'SPORTPLUS',
      'CHRISTOPEIT',
      'FINNLO',
      'HAMMER',
      'MAXXUS',
      'TAURUS',
      'YOSUDA',
      'DRIPEX',
      'KINGSMITH',
      'MOBI',
      'TOORX',
      'INSPORTLINE',
      'HEUBOZEN',
      'VOWVIT',
      'VW3',
    ];

    for (final kw in rowerKeywords) {
      if (combined.contains(kw)) return 2;
    }
    if (combined == 'SR' || combined == 'WR') return 2;

    // Smartphones / Tablettes pouvant diffuser le broadcast EXR de l'application SmartRow
    const phoneBroadcasterKeywords = <String>[
      'GALAXY',
      'SAMSUNG',
      'S24',
      'S23',
      'S22',
      'IPHONE',
      'IPAD',
      'PIXEL',
      'XIAOMI',
      'REDMI',
      'ONEPLUS',
      'PHONE',
      'ANDROID',
    ];
    for (final kw in phoneBroadcasterKeywords) {
      if (combined.contains(kw)) return 1;
    }

    return 0;
  }

  static bool isMatchingRowerScanResult(ScanResult r) {
    return getScanResultPriority(r) > 0;
  }

  /// Lance le scan BLE pour découvrir les poulies WaterRower SmartRow (0x1234),
  /// les broadcasts EXR SmartRow (0x1826) et tous les rameurs FTMS.
  Future<void> startScan() async {
    if (_currentStatus == BleConnectionStatus.scanning) return;

    _setStatus(BleConnectionStatus.scanning);

    try {
      // Attente tolérante de l'état BluetoothAdapterState.on (évite l'échec sur l'état initial 'unknown')
      BluetoothAdapterState adapterState = FlutterBluePlus.adapterStateNow;
      if (adapterState != BluetoothAdapterState.on) {
        try {
          adapterState = await FlutterBluePlus.adapterState
              .where((s) => s != BluetoothAdapterState.unknown && s != BluetoothAdapterState.turningOn)
              .first
              .timeout(const Duration(seconds: 4));
        } catch (_) {
          adapterState = FlutterBluePlus.adapterStateNow;
        }
      }

      if (adapterState != BluetoothAdapterState.on) {
        _setStatus(BleConnectionStatus.disconnected);
        return;
      }

      _scanResultsSub?.cancel();
      _scanResultsSub = FlutterBluePlus.scanResults.listen((results) {
        final filtered = results.where(isMatchingRowerScanResult).toList();
        filtered.sort((a, b) {
          final prioCmp = getScanResultPriority(b).compareTo(getScanResultPriority(a));
          if (prioCmp != 0) return prioCmp;
          return b.rssi.compareTo(a.rssi);
        });
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

  /// Vérifie si un rameur précédent a été mémorisé (et retourne son nom)
  Future<String?> getSavedLastDeviceName() async {
    final remoteId = await _storage.getLastBleRemoteId();
    if (remoteId == null || remoteId.isEmpty) return null;
    return await _storage.getLastBleDeviceName();
  }

  /// Tente une reconnexion immédiate en 1 tap au dernier rameur enregistré
  Future<bool> reconnectLastDevice() async {
    final remoteId = await _storage.getLastBleRemoteId();
    final savedName = await _storage.getLastBleDeviceName();
    if (remoteId == null || remoteId.isEmpty) return false;

    final device = BluetoothDevice.fromId(remoteId);
    return connectToDevice(device, knownName: savedName);
  }

  /// Connexion et abonnement aux notifications d'une poulie WaterRower SmartRow (0x1234/0x1236)
  /// ou d'un rameur / broadcast EXR FTMS (0x1826/0x2AD1).
  Future<bool> connectToDevice(BluetoothDevice device, {String? knownName}) async {
    await stopScan();
    _stopWatchdogTimer();
    _charNotificationsSub?.cancel();
    _connectionStateSub?.cancel();
    _setStatus(BleConnectionStatus.connecting);

    try {
      // Connexion GATT avec 1 retry automatique en cas d'erreur transitoire Android GATT 133
      bool connected = false;
      for (int attempt = 0; attempt < 2; attempt++) {
        try {
          await device.connect(
            autoConnect: false,
            timeout: const Duration(seconds: 12),
          );
          connected = true;
          break;
        } catch (_) {
          if (attempt == 0) {
            try {
              await device.disconnect();
            } catch (_) {}
            await Future.delayed(const Duration(milliseconds: 450));
          }
        }
      }

      if (!connected) {
        _setStatus(BleConnectionStatus.disconnected);
        return false;
      }

      _connectedDevice = device;
      final resolvedName = device.platformName.trim().isNotEmpty
          ? device.platformName.trim()
          : (knownName?.trim().isNotEmpty == true ? knownName!.trim() : 'Rameur BLE');
      _deviceName = resolvedName;
      _decoder.deviceName = _deviceName;
      _decoder.reset();
      _decoder.isFirstPacket = true;

      // Négociation MTU étendue (optionnelle, évite la troncature des trames FTMS > 20 octets sur Android)
      try {
        await device.requestMtu(247).timeout(const Duration(seconds: 2));
      } catch (_) {}

      // Découverte des services GATT (avec second essai si le cache GATT tarde à répondre)
      BluetoothCharacteristic? rowerDataChar;
      BluetoothCharacteristic? controlPointChar;
      BluetoothCharacteristic? srDataChar;
      BluetoothCharacteristic? srWriteChar;

      for (int discAttempt = 0; discAttempt < 2; discAttempt++) {
        final services = await device.discoverServices();

        for (final s in services) {
          final su = s.uuid.toString().toLowerCase();
          if (su.contains('1234')) {
            for (final c in s.characteristics) {
              final cu = c.uuid.toString().toLowerCase();
              if (cu.contains('1236')) {
                srDataChar = c;
              } else if (cu.contains('1235')) {
                srWriteChar = c;
              }
            }
          } else if (su.contains('1826')) {
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

        if (srDataChar != null || rowerDataChar != null) {
          break;
        }
        if (discAttempt == 0) {
          await Future.delayed(const Duration(milliseconds: 350));
        }
      }

      if (srDataChar == null && rowerDataChar == null) {
        await device.disconnect();
        _connectedDevice = null;
        _setStatus(BleConnectionStatus.disconnected);
        return false;
      }

      // Sauvegarde pour reconnexion 1-tap ultérieure
      await _storage.saveLastBleDevice(device.remoteId.str, _deviceName!);

      _connectionStateSub?.cancel();
      _connectionStateSub = device.connectionState.listen((state) {
        if (state == BluetoothConnectionState.disconnected) {
          _handleDisconnection();
        }
      });

      _secondsWithoutData = 0;

      // =======================================================================
      // MODE 1 : POULIE WATERROWER SMARTROW DIRECTE (Service 0x1234 / Char 0x1236)
      // =======================================================================
      if (srDataChar != null) {
        _isSmartRowDirect = true;
        _srWriteChar = srWriteChar;
        _srWriteQueue.clear();
        _srWriteBusy = false;
        _srHandshakeState = 0;
        _srChallengeRequested = false;
        _srRxBuffer = '';
        _srV3LockTicks = 0;

        _charNotificationsSub?.cancel();
        _charNotificationsSub = srDataChar.onValueReceived.listen(_onSmartRowDataReceived);
        await _enableNotificationsWithRetry(srDataChar);

        // Séquence de réveil et demande de version SmartRow ("$\r" puis "V@\r")
        _initSmartRowDirect();
        _startWatchdogTimer();

        _setStatus(BleConnectionStatus.connected);
        _metricsController.add(_currentMetrics);
        _bleLog('SmartRow direct connecte, notifications actives');
        return true;
      }

      // =======================================================================
      // MODE 2 : RAMEUR FTMS STANDARD & BROADCAST EXR SMARTROW (Service 0x1826 / Char 0x2AD1)
      // =======================================================================
      _isSmartRowDirect = false;
      _srWriteChar = null;

      _charNotificationsSub?.cancel();
      _charNotificationsSub = rowerDataChar!.onValueReceived.listen(_onFtmsDataReceived);
      await _enableNotificationsWithRetry(rowerDataChar);

      // Initialisation non-bloquante du FTMS Control Point (0x2AD9) après abonnement à 0x2AD1
      if (controlPointChar != null) {
        unawaited(_initFtmsControlPoint(controlPointChar));
      }

      _startWatchdogTimer();
      _setStatus(BleConnectionStatus.connected);
      return true;
    } catch (_) {
      try {
        await device.disconnect();
      } catch (_) {}
      _connectedDevice = null;
      _setStatus(BleConnectionStatus.disconnected);
      return false;
    }
  }

  /// Active les notifications CCCD (0x2902) avec un second essai en cas de délai GATT
  Future<void> _enableNotificationsWithRetry(BluetoothCharacteristic characteristic) async {
    try {
      await characteristic.setNotifyValue(true);
    } catch (_) {
      await Future.delayed(const Duration(milliseconds: 300));
      await characteristic.setNotifyValue(true);
    }
  }

  /// Envoie Request Control (0x00) puis Start/Resume (0x07) sur le FTMS Control Point (0x2AD9)
  /// de façon non-bloquante afin de ne jamais perturber les broadcasts EXR / SmartRow.
  Future<void> _initFtmsControlPoint(BluetoothCharacteristic controlPointChar) async {
    try {
      final bool useWithoutResponse =
          !controlPointChar.properties.write && controlPointChar.properties.writeWithoutResponse;
      if (controlPointChar.properties.indicate || controlPointChar.properties.notify) {
        try {
          await controlPointChar.setNotifyValue(true).timeout(const Duration(seconds: 1));
        } catch (_) {}
      }
      await controlPointChar
          .write([0x00], withoutResponse: useWithoutResponse)
          .timeout(const Duration(seconds: 1));
      await Future.delayed(const Duration(milliseconds: 120));
      await controlPointChar
          .write([0x07], withoutResponse: useWithoutResponse)
          .timeout(const Duration(seconds: 1));
    } catch (_) {}
  }

  // ===========================================================================
  // PROTOCOLE SMARTROW DIRECT : HANDSHAKE V2/V3 KEYLOCK, KEEP-ALIVE & RÉCEPTION
  // ===========================================================================

  void _initSmartRowDirect() {
    _srHandshakeState = 1;
    _srChallengeRequested = false;
    _srRxBuffer = '';
    _srV3LockTicks = 0;
    _srWriteQueue.clear();
    // Envoi de "$\r" (wake ping) suivi de "V@\r" (version inquiry)
    _sendSmartRowPacket(const <int>[0x24, 0x0D]);
    _sendSmartRowPacket(const <int>[0x56, 0x40, 0x0D]);
  }

  void _sendSmartRowWakePing() {
    _sendSmartRowPacket(const <int>[0x24]); // '$' = 0x24
  }

  void _sendSmartRowPacket(List<int> bytes) {
    if (_srWriteChar == null) return;
    if (_srWriteBusy) {
      _srWriteQueue.add(bytes);
      return;
    }
    unawaited(_executeSmartRowWrite(bytes));
  }

  Future<void> _executeSmartRowWrite(List<int> bytes) async {
    final writeChar = _srWriteChar;
    if (writeChar == null) return;

    _srWriteBusy = true;
    try {
      final bool preferWithoutResponse =
          !writeChar.properties.write && writeChar.properties.writeWithoutResponse;
      try {
        await writeChar
            .write(bytes, withoutResponse: preferWithoutResponse)
            .timeout(const Duration(seconds: 2));
      } catch (_) {
        if (!preferWithoutResponse && writeChar.properties.writeWithoutResponse) {
          await writeChar
              .write(bytes, withoutResponse: true)
              .timeout(const Duration(seconds: 2));
        }
      }
    } catch (e) {
      _bleLog('SmartRow write error: $e');
    } finally {
      _srWriteBusy = false;
      if (_srWriteQueue.isNotEmpty) {
        final next = _srWriteQueue.removeAt(0);
        unawaited(_executeSmartRowWrite(next));
      }
    }
  }

  void _onFtmsDataReceived(List<int> value) {
    if (value.isEmpty) return;
    _secondsWithoutData = 0;
    _bleLog('FTMS rx: ${_hex(value)}');
    _currentMetrics = _decoder.decode(value, _currentMetrics);
    _metricsController.add(_currentMetrics);
  }

  void _onSmartRowDataReceived(List<int> value) {
    if (value.isEmpty) return;
    _secondsWithoutData = 0;
    _bleLog('SmartRow rx (hs=$_srHandshakeState): ${_hex(value)}');

    // 1. Accumulation ASCII imprimable pour détecter les messages de version V3 et KEYLOCK= fragmentés
    final StringBuffer chunkBuf = StringBuffer();
    for (final int b in value) {
      final int byte = b & 0xFF;
      if (byte >= 0x20 && byte <= 0x7E) {
        chunkBuf.writeCharCode(byte);
      }
    }
    final String msgStr = chunkBuf.toString();
    if (msgStr.isNotEmpty) {
      _srRxBuffer += msgStr;
      if (_srRxBuffer.length > 96) {
        _srRxBuffer = _srRxBuffer.substring(_srRxBuffer.length - 96);
      }
    }

    // 2. Défi SmartRow V3 KEYLOCK=XXXXXXXX (16 caractères)
    final int keylockIdx = _srRxBuffer.indexOf('KEYLOCK=');
    if (keylockIdx >= 0) {
      final String rem = _srRxBuffer.substring(keylockIdx);
      if (rem.length >= 16) {
        _srRxBuffer = rem.length > 16 ? rem.substring(16) : '';
        final List<int>? unlockPacket = BleFtmsDecoder.computeSmartRowKeylockResponse(rem);
        if (unlockPacket != null) {
          _srHandshakeState = 3;
          _srChallengeRequested = false;
          _srV3LockTicks = 0;
          _sendSmartRowPacket(unlockPacket);
        } else {
          _sendSmartRowPacket(const <int>[0x23]); // '#' = redemander le challenge
        }
        return;
      } else if (!rem.contains('\r') && !rem.contains('\n')) {
        // Attendre la notification BLE suivante pour compléter les 16 caractères du challenge KEYLOCK
        return;
      } else {
        _srRxBuffer = '';
        _sendSmartRowPacket(const <int>[0x23]);
        return;
      }
    }

    // 3. Réponse de version de la poulie (ex: "SmartRow 'V3.10'") -> demander le challenge '#' (0x23)
    if (_srRxBuffer.contains('V3') && !_srChallengeRequested) {
      _srChallengeRequested = true;
      _srHandshakeState = 2;
      _srRxBuffer = '';
      _sendSmartRowPacket(const <int>[0x23]); // '#' = CHALLENGE_REQUEST
      if (msgStr.contains('V3')) {
        return;
      }
    } else if (_srRxBuffer.contains('V2') && _srHandshakeState < 3) {
      _srHandshakeState = 3;
      _srRxBuffer = '';
    }

    // 4. Vérifier si la trame de télémétrie reçue est encore verrouillée V3 (octets 1..5 dans 0x40..0x49)
    if (BleFtmsDecoder.isSmartRowV3LockedFrame(value)) {
      _srHandshakeState = 2;
      if (!_srChallengeRequested) {
        _srChallengeRequested = true;
        _sendSmartRowPacket(const <int>[0x23]);
      }
    } else if (value.length >= 6) {
      for (int i = 0; i <= value.length - 6; i++) {
        final int vb = value[i] & 0xFF;
        final bool isRec = (vb == 0x61 ||
            vb == 0x62 ||
            vb == 0x63 ||
            vb == 0x64 ||
            vb == 0x65 ||
            vb == 0x66 ||
            vb == 0x78 ||
            vb == 0x79 ||
            vb == 0x7A);
        if (isRec && (i == 0 || value[i - 1] == 0x0D || value[i - 1] == 0x0A)) {
          _srHandshakeState = 3;
          _srV3LockTicks = 0;
          break;
        }
      }
    }

    // 5. Décodage temps réel de la télémétrie SmartRow
    _currentMetrics = _decoder.decodeSmartRowBytes(value, _currentMetrics);
    _metricsController.add(_currentMetrics);
  }

  /// Cadenceur 1 Hz de surveillance de liaison BLE, keep-alive SmartRow ('$') et retour au repos (4s)
  void _startWatchdogTimer() {
    _stopWatchdogTimer();
    _watchdogTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_currentStatus != BleConnectionStatus.connected) return;

      _secondsWithoutData++;

      // Remise à zéro des métriques instantanées après 4s de silence radio (arrêt du rameur)
      if (_secondsWithoutData >= 4 &&
          (_currentMetrics.instantPower > 0 ||
              _currentMetrics.strokeRate > 0.0 ||
              _currentMetrics.instantPace > 0 ||
              _currentMetrics.isMoving)) {
        _currentMetrics = _currentMetrics.copyWith(
          instantPower: 0,
          instantPace: 0,
          strokeRate: 0.0,
          isMoving: false,
        );
        _metricsController.add(_currentMetrics);
      }

      // Gestion du handshake V3 et du keep-alive '$' sur la poulie SmartRow directe
      if (_isSmartRowDirect && _srWriteChar != null) {
        if (_srHandshakeState < 3) {
          _srV3LockTicks++;
          if (_secondsWithoutData >= 3 &&
              (_secondsWithoutData % 3 == 0) &&
              _srWriteQueue.isEmpty &&
              !_srWriteBusy) {
            _initSmartRowDirect();
          } else if (_srV3LockTicks >= 3 &&
              (_srV3LockTicks % 3 == 0) &&
              _srWriteQueue.isEmpty &&
              !_srWriteBusy) {
            _srChallengeRequested = true;
            _srHandshakeState = 2;
            _sendSmartRowPacket(const <int>[0x23]);
          }
        } else {
          // Poulie déverrouillée : envoyer '$' toutes les 2s d'inactivité pour maintenir la poulie éveillée
          if (_secondsWithoutData >= 2 &&
              (_secondsWithoutData % 2 == 0) &&
              _srWriteQueue.isEmpty &&
              !_srWriteBusy) {
            _sendSmartRowWakePing();
          }
        }
      }
    });
  }

  void _stopWatchdogTimer() {
    _watchdogTimer?.cancel();
    _watchdogTimer = null;
  }

  /// Déconnexion manuelle
  Future<void> disconnect() async {
    _stopWatchdogTimer();
    _charNotificationsSub?.cancel();
    _connectionStateSub?.cancel();
    _srWriteQueue.clear();
    _srWriteBusy = false;
    _srWriteChar = null;
    _isSmartRowDirect = false;
    try {
      await _connectedDevice?.disconnect();
    } catch (_) {}
    _connectedDevice = null;
    _setStatus(BleConnectionStatus.disconnected);
  }

  void _handleDisconnection() {
    _stopWatchdogTimer();
    _charNotificationsSub?.cancel();
    _srWriteQueue.clear();
    _srWriteBusy = false;
    _srWriteChar = null;
    _isSmartRowDirect = false;
    _connectedDevice = null;
    _setStatus(BleConnectionStatus.disconnected);
  }

  void _setStatus(BleConnectionStatus s) {
    _currentStatus = s;
    if (!_statusController.isClosed) {
      _statusController.add(s);
    }
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
    _stopWatchdogTimer();
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
