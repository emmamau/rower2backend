import 'dart:math' as math;
import '../models/rowing_metrics.dart';

/// Décodeur binaire et ASCII pur et autonome pour :
/// 1. La caractéristique Bluetooth SIG FTMS Rower Data (0x2AD1) - incluant le broadcast EXR de SmartRow.
/// 2. La caractéristique directe de la poulie WaterRower SmartRow (0x1236) - protocole V2 & V3 (avec KEYLOCK).
/// Totalement découplé des API Bluetooth pour permettre des tests unitaires rapides et fiables.
class BleFtmsDecoder {
  String? deviceName;

  int _baselineRawDistance = 0;
  int _baselineRawStrokes = 0;
  int _lastRawDistance = 0;
  int _lastRawStrokes = 0;
  int _distanceOffset = 0;
  int _strokesOffset = 0;
  bool _isDecimeterDistance = false;

  bool _pendingInitialDistanceTare = false;
  bool _pendingInitialStrokesTare = false;

  int _wattsSum = 0;
  int _wattsCount = 0;
  double _spmSum = 0.0;
  int _spmCount = 0;

  // État spécifique SmartRow Direct (0x1236)
  double _lastSmartRowWork = 0.0;
  int _lastSmartRowHandleCm = 0;
  bool _hasNativeSmartRowWatts = false;
  final List<int> _srRxFrameBytes = <int>[];
  bool _srRxIsRecord = false;

  bool get isDecimeterDistance => _isDecimeterDistance;
  int get baselineRawDistance => _baselineRawDistance;
  int get lastRawDistance => _lastRawDistance;
  double get lastSmartRowWork => _lastSmartRowWork;
  int get lastSmartRowHandleCm => _lastSmartRowHandleCm;

  bool get isFirstPacket => _pendingInitialDistanceTare || _pendingInitialStrokesTare;
  set isFirstPacket(bool value) {
    _pendingInitialDistanceTare = value;
    _pendingInitialStrokesTare = value;
  }

  BleFtmsDecoder({this.deviceName});

  void reset() {
    _baselineRawDistance = 0;
    _baselineRawStrokes = 0;
    _lastRawDistance = 0;
    _lastRawStrokes = 0;
    _distanceOffset = 0;
    _strokesOffset = 0;
    _isDecimeterDistance = false;
    _pendingInitialDistanceTare = false;
    _pendingInitialStrokesTare = false;
    _wattsSum = 0;
    _wattsCount = 0;
    _spmSum = 0.0;
    _spmCount = 0;
    _lastSmartRowWork = 0.0;
    _lastSmartRowHandleCm = 0;
    _hasNativeSmartRowWatts = false;
    _srRxFrameBytes.clear();
    _srRxIsRecord = false;
  }

  void reTareToZero() {
    _baselineRawDistance = _lastRawDistance;
    _baselineRawStrokes = _lastRawStrokes;
    _distanceOffset = 0;
    _strokesOffset = 0;
    // Si aucun paquet n'a encore ete recu, on conserve la tare initiale en attente :
    // le premier paquet fixera la base (sinon la valeur cumulee de la poulie fausse tout).
  }

  void alignDistance(int authoritativeDistance, int currentDistance) {
    if (authoritativeDistance <= 0) {
      reTareToZero();
      return;
    }
    if (authoritativeDistance > currentDistance) {
      _distanceOffset = authoritativeDistance - (_lastRawDistance - _baselineRawDistance);
    }
  }

  // ===========================================================================
  // 1. DÉCODEUR FTMS STANDARD & BROADCAST EXR SMARTROW (UUID 0x2AD1)
  // ===========================================================================

  /// Décode une trame binaire reçue selon la spécification Bluetooth SIG FTMS §4.14 (0x2AD1)
  RowingMetrics decode(List<int> bytes, [RowingMetrics current = const RowingMetrics()]) {
    if (bytes.length < 2) return current;

    final int flags = (bytes[0] & 0xFF) | ((bytes[1] & 0xFF) << 8);
    int offset = 2;

    int rawStrokes = _lastRawStrokes;
    int rawDistance = _lastRawDistance;
    double packetSpm = 0.0;
    int packetPace = 0;
    int packetWatts = 0;
    int packetAvgPace = current.avgPace;
    int packetAvgWatts = 0;
    double packetAvgSpm = 0.0;
    int calories = current.calories;
    int heartRate = current.heartRate;

    bool hasPacketSpm = false;
    bool hasPacketDistance = false;
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
      final rawAvgSpm = bytes[offset] & 0xFF;
      if (rawAvgSpm > 0) {
        packetAvgSpm = rawAvgSpm * 0.5;
      }
      offset += 1;
    }

    // Bit 2 : Total Distance (uint24 Little Endian, mètres)
    if ((flags & 0x0004) != 0 && offset + 3 <= bytes.length) {
      rawDistance = (bytes[offset] & 0xFF) |
          ((bytes[offset + 1] & 0xFF) << 8) |
          ((bytes[offset + 2] & 0xFF) << 16);
      hasPacketDistance = true;
      offset += 3;
    }

    // Bit 3 : Instantaneous Pace (uint16 Little Endian, secondes / 500m)
    if ((flags & 0x0008) != 0 && offset + 2 <= bytes.length) {
      final rawPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
      hasPacketPace = true;
      if (rawPace != 0xFFFF && rawPace > 0) {
        packetPace = rawPace;
      }
      offset += 2;
    }

    // Bit 4 : Average Pace (uint16)
    if ((flags & 0x0010) != 0 && offset + 2 <= bytes.length) {
      final rawAvgPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
      if (rawAvgPace != 0xFFFF && rawAvgPace > 0) {
        packetAvgPace = rawAvgPace;
      }
      offset += 2;
    }

    // Bit 5 : Instantaneous Power (sint16 Little Endian, Watts)
    if ((flags & 0x0020) != 0 && offset + 2 <= bytes.length) {
      int rawWatts = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
      if (rawWatts > 32767) rawWatts -= 65536;
      hasPacketWatts = true;
      if (rawWatts > 0) {
        packetWatts = rawWatts;
      }
      offset += 2;
    }

    // Bit 6 : Average Power (sint16)
    if ((flags & 0x0040) != 0 && offset + 2 <= bytes.length) {
      int rawAvgW = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
      if (rawAvgW > 32767) rawAvgW -= 65536;
      if (rawAvgW > 0) {
        packetAvgWatts = rawAvgW;
      }
      offset += 2;
    }

    // Bit 7 : Resistance Level (sint16)
    if ((flags & 0x0080) != 0 && offset + 2 <= bytes.length) {
      offset += 2;
    }

    // Bit 8 : Expended Energy (Total Energy uint16 kcal + Per Hour uint16 + Per Min uint8)
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
    // Ne s'exécute sur un delta que si la tare initiale de distance a déjà été acquise
    if (hasPacketDistance && rawDistance > 0) {
      if (!_isDecimeterDistance && !_pendingInitialDistanceTare && _lastRawDistance > 0) {
        final dDist = rawDistance > _lastRawDistance ? rawDistance - _lastRawDistance : 0;
        final dStrokes = rawStrokes > _lastRawStrokes ? rawStrokes - _lastRawStrokes : 0;
        final isMerach = (deviceName ?? '').toUpperCase().contains('MERACH') ||
            (deviceName ?? '').toUpperCase().contains('MRK');
        if (dDist > 1000 || (dStrokes > 0 && (dDist / dStrokes) >= (isMerach ? 20.0 : 35.0))) {
          _isDecimeterDistance = true;
          _baselineRawDistance = (_baselineRawDistance + 5) ~/ 10;
          _lastRawDistance = (_lastRawDistance + 5) ~/ 10;
        }
      }
      if (_isDecimeterDistance) {
        rawDistance = (rawDistance + 5) ~/ 10;
      }
    }

    // Tare initiale dissociée par champ pour supporter les trames FTMS fragmentées (More Data / EXR Broadcast)
    if (hasPacketDistance && _pendingInitialDistanceTare) {
      _pendingInitialDistanceTare = false;
      _baselineRawDistance = rawDistance;
      _lastRawDistance = rawDistance;
      _distanceOffset = 0;
    } else if (hasPacketDistance && _lastRawDistance >= 20 && rawDistance <= 5) {
      // Détection remise à zéro matérielle en cours de session
      _distanceOffset += (_lastRawDistance >= _baselineRawDistance) ? (_lastRawDistance - _baselineRawDistance) : 0;
      _baselineRawDistance = rawDistance;
    }

    if (hasPacketSpm && _pendingInitialStrokesTare) {
      _pendingInitialStrokesTare = false;
      _baselineRawStrokes = rawStrokes;
      _lastRawStrokes = rawStrokes;
      _strokesOffset = 0;
    } else if (hasPacketSpm && _lastRawStrokes >= 10 && rawStrokes <= 2) {
      _strokesOffset += (_lastRawStrokes >= _baselineRawStrokes) ? (_lastRawStrokes - _baselineRawStrokes) : 0;
      _baselineRawStrokes = rawStrokes;
    }

    final bool distanceProgressed = hasPacketDistance && rawDistance > _lastRawDistance;
    final bool strokesProgressed = hasPacketSpm && rawStrokes > _lastRawStrokes;

    // Calcul de la distance et des coups réels tarés
    final curRelD = rawDistance >= _baselineRawDistance ? rawDistance - _baselineRawDistance : 0;
    final curRelS = rawStrokes >= _baselineRawStrokes ? rawStrokes - _baselineRawStrokes : 0;

    final int totalDist = _distanceOffset + curRelD;
    final int totalStr = _strokesOffset + curRelS;

    if (hasPacketDistance) {
      _lastRawDistance = rawDistance;
    }
    if (hasPacketSpm) {
      _lastRawStrokes = rawStrokes;
    }

    // Dérivation Allure <-> Puissance Concept2 : P = 2.80 * (500 / Pace)^3
    // Gère aussi les rameurs/broadcasts qui activent le bit 5 (Power) avec 0W mais envoient l'allure
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

    // Résolution des métriques instantanées avec préservation sur trames FTMS scindées (Bit 0 = 1 More Data)
    final double resolvedSpm = hasPacketSpm ? packetSpm : current.strokeRate;
    int resolvedWatts;
    int resolvedPace;

    final bool isExplicitStopFrame = hasPacketSpm &&
        packetSpm <= 0.0 &&
        !distanceProgressed &&
        !strokesProgressed &&
        (!hasPacketWatts || packetWatts <= 0) &&
        (!hasPacketPace || packetPace <= 0);

    if (isExplicitStopFrame) {
      resolvedWatts = 0;
      resolvedPace = 0;
    } else {
      if (packetWatts > 0) {
        resolvedWatts = packetWatts;
      } else if (hasPacketWatts && hasPacketSpm && packetSpm <= 0.0) {
        resolvedWatts = 0;
      } else {
        resolvedWatts = current.instantPower;
      }

      if (packetPace > 0) {
        resolvedPace = packetPace;
      } else if (hasPacketPace && hasPacketSpm && packetSpm <= 0.0) {
        resolvedPace = 0;
      } else {
        resolvedPace = current.instantPace;
      }
    }

    if (packetWatts > 0) {
      _wattsSum += packetWatts;
      _wattsCount++;
    }
    if (packetSpm > 0) {
      _spmSum += packetSpm;
      _spmCount++;
    }

    final int avgW = packetAvgWatts > 0
        ? packetAvgWatts
        : (_wattsCount > 0 ? (_wattsSum / _wattsCount).round() : current.avgPower);
    final double avgS = packetAvgSpm > 0.0
        ? packetAvgSpm
        : (_spmCount > 0 ? (_spmSum / _spmCount) : current.avgStrokeRate);

    final bool isMoving = resolvedWatts > 10 ||
        resolvedSpm > 8.0 ||
        (resolvedPace > 0 && resolvedPace < 600) ||
        distanceProgressed ||
        strokesProgressed;

    return RowingMetrics(
      instantPower: resolvedWatts,
      avgPower: avgW,
      instantPace: resolvedPace,
      avgPace: packetAvgPace,
      strokeRate: resolvedSpm,
      avgStrokeRate: avgS,
      totalDistance: totalDist,
      strokeCount: totalStr,
      elapsedTime: current.elapsedTime,
      calories: calories,
      heartRate: heartRate,
      isMoving: isMoving,
    );
  }

  // ===========================================================================
  // 2. DÉCODEUR DIRECT POULIE WATERROWER SMARTROW (UUID 0x1236) - V2 & V3
  // ===========================================================================

  /// Détecte si une trame brute SmartRow contient encore des chiffres de distance V3 obfusqués (0x40..0x49 '@'-'I')
  static bool isSmartRowV3LockedFrame(List<int> bytes) {
    final int size = bytes.length;
    if (size < 6) return false;
    int i = 0;
    while (i <= size - 6) {
      final int b0 = bytes[i] & 0xFF;
      final bool isRec = (b0 == 0x61 ||
          b0 == 0x62 ||
          b0 == 0x63 ||
          b0 == 0x64 ||
          b0 == 0x65 ||
          b0 == 0x66 ||
          b0 == 0x78 ||
          b0 == 0x79 ||
          b0 == 0x7A);
      if (isRec && (i == 0 || bytes[i - 1] == 0x0D || bytes[i - 1] == 0x0A)) {
        for (int k = 1; k <= 5; k++) {
          final int dk = bytes[i + k] & 0xFF;
          if (dk >= 0x40 && dk <= 0x49) {
            return true;
          }
        }
        return false;
      }
      i++;
    }
    return false;
  }

  /// Valide le checksum du challenge SmartRow V3 (ex: "KEYLOCK=C2D70BB1")
  /// et calcule la réponse de déverrouillage `\r<4 hex>\r` ([0x0D, h0, h1, h2, h3, 0x0D]).
  static List<int>? computeSmartRowKeylockResponse(String challenge) {
    final int idx = challenge.indexOf('KEYLOCK=');
    final String clean = idx >= 0 ? challenge.substring(idx) : challenge;
    if (clean.length < 16) {
      return null;
    }

    final String sub14 = clean.substring(0, 14);
    final String checksumStr = clean.substring(14, 16);

    int sum = 0;
    for (int i = 0; i < sub14.length; i++) {
      sum += sub14.codeUnitAt(i);
    }
    final int expectedChecksum = sum & 0xFF;
    final int actualChecksum = parseHex(checksumStr);
    if (actualChecksum < 0 || actualChecksum != expectedChecksum) {
      return null;
    }

    final String seedStr = clean.substring(10, 14);
    final int seed = parseHex(seedStr);
    if (seed < 0) {
      return null;
    }

    // Formule officielle de réponse au challenge V3 : ((seed * 17923) ~/ 256) & 0xFFFF
    int respVal = ((seed * 17923) ~/ 256) & 0xFFFF;
    final List<int> r = List<int>.filled(4, 0);
    for (int j = 3; j >= 0; j--) {
      final int nib = respVal & 0x0F;
      r[j] = (nib < 10) ? (48 + nib) : (87 + nib); // '0'-'9' ou 'a'-'f'
      respVal = respVal >> 4;
    }
    return <int>[0x0D, r[0], r[1], r[2], r[3], 0x0D];
  }

  static int parseHex(String str) {
    final String upper = str.toUpperCase();
    int val = 0;
    for (int i = 0; i < upper.length; i++) {
      final int c = upper.codeUnitAt(i);
      final int d = (c >= 48 && c <= 57) ? (c - 48) : ((c >= 65 && c <= 70) ? (c - 55) : -1);
      if (d < 0) return -1;
      val = (val << 4) | d;
    }
    return val;
  }

  static int _expectedSmartRowMinLength(int firstByte) {
    switch (firstByte) {
      case 0x61: // 'a' energy
        return 10;
      case 0x62: // 'b' work & stroke length
        return 13;
      case 0x63: // 'c' power
        return 14;
      case 0x64: // 'd' stroke rate & count
        return 13;
      case 0x65: // 'e' pace
        return 12;
      case 0x66: // 'f' force
      case 0x78: // 'x'
      case 0x79: // 'y'
      case 0x7A: // 'z'
        return 11;
      default:
        return 6;
    }
  }

  /// Décode un flux d'octets provenant de la caractéristique SmartRow Data (0x1236).
  /// Supporte les trames fragmentées sur plusieurs notifications BLE, les paquets multi-trames
  /// séparés par `\r` / `\n`, et désembrouille automatiquement les octets de distance V3.
  RowingMetrics decodeSmartRowBytes(List<int> bytes, [RowingMetrics current = const RowingMetrics()]) {
    if (bytes.isEmpty) return current;

    RowingMetrics updated = current;
    bool sawTerminator = false;

    for (int i = 0; i < bytes.length; i++) {
      int b = bytes[i] & 0xFF;
      if (b == 0x0D || b == 0x0A) {
        sawTerminator = true;
        if (_srRxFrameBytes.length >= 6) {
          final String frame = String.fromCharCodes(_srRxFrameBytes);
          updated = decodeSmartRowString(frame, updated);
        }
        _srRxFrameBytes.clear();
        _srRxIsRecord = false;
      } else {
        if (_srRxFrameBytes.isEmpty) {
          _srRxIsRecord = (b == 0x61 ||
              b == 0x62 ||
              b == 0x63 ||
              b == 0x64 ||
              b == 0x65 ||
              b == 0x66 ||
              b == 0x78 ||
              b == 0x79 ||
              b == 0x7A);
          if (!_srRxIsRecord) {
            continue;
          }
        } else if (_srRxIsRecord && _srRxFrameBytes.length >= 1 && _srRxFrameBytes.length <= 5) {
          // Désembrouillage des chiffres de distance V3 : (b & 0x0F) | 0x30 produit '0'..'9'
          b = (b & 0x0F) | 0x30;
        }
        if (b >= 0x20 && b <= 0x7E) {
          if (_srRxFrameBytes.length < 48) {
            _srRxFrameBytes.add(b);
          } else {
            _srRxFrameBytes.clear();
            _srRxIsRecord = false;
          }
        }
      }
    }

    // Si une trame complète a été transmise sans '\r' final (ex. notification exacte non terminée par CR)
    if (!sawTerminator &&
        _srRxFrameBytes.isNotEmpty &&
        _srRxFrameBytes.length >= _expectedSmartRowMinLength(_srRxFrameBytes[0])) {
      final String frame = String.fromCharCodes(_srRxFrameBytes);
      updated = decodeSmartRowString(frame, updated);
      _srRxFrameBytes.clear();
      _srRxIsRecord = false;
    }

    return updated;
  }

  /// Décode une trame ASCII unitaire de la poulie SmartRow (`a`, `b`, `c`, `d`, `e`, `f`, `x`, `y`, `z`)
  RowingMetrics decodeSmartRowString(String event, [RowingMetrics current = const RowingMetrics()]) {
    final int len = event.length;
    if (len < 6) return current;

    final String normalized = _normalizeSmartRowField(event);
    final String msgType = normalized.substring(0, 1);

    int totalDist = current.totalDistance;
    int totalStr = current.strokeCount;
    int instantPower = current.instantPower;
    int avgPower = current.avgPower;
    int instantPace = current.instantPace;
    int avgPace = current.avgPace;
    double strokeRate = current.strokeRate;
    double avgStrokeRate = current.avgStrokeRate;
    int calories = current.calories;
    bool isMoving = current.isMoving;

    // 1. Extraction de la distance en mètres (caractères [1..6) sur toutes les trames a..f, x..z)
    if (msgType == 'a' ||
        msgType == 'b' ||
        msgType == 'c' ||
        msgType == 'd' ||
        msgType == 'e' ||
        msgType == 'f' ||
        msgType == 'x' ||
        msgType == 'y' ||
        msgType == 'z') {
      final int rawDistance = _safeParseInt(normalized.substring(1, 6));

      if (_pendingInitialDistanceTare) {
        _pendingInitialDistanceTare = false;
        _baselineRawDistance = rawDistance;
        _lastRawDistance = rawDistance;
        _distanceOffset = 0;
      } else if (_lastRawDistance >= 20 && rawDistance <= 5) {
        _distanceOffset += (_lastRawDistance >= _baselineRawDistance) ? (_lastRawDistance - _baselineRawDistance) : 0;
        _baselineRawDistance = rawDistance;
      }

      final int curRelD = (rawDistance >= _baselineRawDistance) ? (rawDistance - _baselineRawDistance) : 0;
      final int candDist = _distanceOffset + curRelD;
      if (candDist >= totalDist) {
        totalDist = candDist;
      }
      if (rawDistance > _lastRawDistance) {
        isMoving = true;
      }
      _lastRawDistance = rawDistance;
    }

    // 2. Décodage spécifique selon le type de trame SmartRow
    if (msgType == 'a' && len >= 10) {
      // Énergie : [6..10) total kcal
      calories = _safeParseInt(normalized.substring(6, 10));
    } else if (msgType == 'b' && len >= 13) {
      // Travail (0.1 J) [7..11) & Longueur de coup (cm) [11..14)
      final double parsedWork = _safeParseInt(normalized.substring(7, 11)) / 10.0;
      final int endLenIdx = (len >= 14) ? 14 : len;
      int parsedHandleCm = _safeParseInt(_normalizeSmartRowField(event.substring(11, endLenIdx)));
      if (parsedHandleCm <= 0) {
        parsedHandleCm = 105;
      }
      _lastSmartRowWork = parsedWork;
      _lastSmartRowHandleCm = parsedHandleCm;
      if (parsedWork > 0.0) {
        isMoving = true;
      }
      if (!_hasNativeSmartRowWatts) {
        final int fallbackW = _deriveSmartRowFallbackPower(strokeRate, instantPace, 0.0);
        if (fallbackW > 0) {
          instantPower = fallbackW;
          _wattsSum += fallbackW;
          _wattsCount++;
          avgPower = (_wattsSum / _wattsCount).round();
          if (instantPace <= 0) {
            instantPace = _paceFromWatts(instantPower);
          }
        }
      }
    } else if (msgType == 'c' && len >= 9) {
      // Puissance : [6..9) Watts instantanés, [9..14) Watts moyens (0.1 W)
      final int rawWatts = _safeParseInt(normalized.substring(6, 9));
      double srAvgWatts = 0.0;
      if (len >= 13) {
        final int endAvgIdx = (len >= 14) ? 14 : len;
        srAvgWatts = _safeParseInt(normalized.substring(9, endAvgIdx)) / 10.0;
      }

      if (rawWatts > 0) {
        _hasNativeSmartRowWatts = true;
        instantPower = rawWatts;
        isMoving = true;
        _wattsSum += rawWatts;
        _wattsCount++;
        final int derivedPace = _paceFromWatts(instantPower);
        if (derivedPace >= 60 && derivedPace < 600) {
          instantPace = derivedPace;
        }
      } else if (_hasNativeSmartRowWatts) {
        instantPower = 0;
      } else {
        // Trame 'c' SmartRow V3 verrouillée ("  0") : dérivation mécanique P = Work * SPM / 60
        final int fallbackW = _deriveSmartRowFallbackPower(strokeRate, instantPace, srAvgWatts);
        if (fallbackW > 0) {
          instantPower = fallbackW;
          isMoving = true;
          _wattsSum += fallbackW;
          _wattsCount++;
          if (instantPace <= 0) {
            instantPace = _paceFromWatts(instantPower);
          }
        }
      }

      if (srAvgWatts > 0.0) {
        avgPower = srAvgWatts.round();
      } else if (_wattsCount > 0) {
        avgPower = (_wattsSum / _wattsCount).round();
      }
    } else if (msgType == 'd' && len >= 13) {
      // Cadence & Coups : [6..9) dixièmes de SPM (ex: "254" = 25.4 SPM), [9..13) total coups
      final double rawSpm = _safeParseInt(normalized.substring(6, 9)) / 10.0;
      final int rawStrokes = _safeParseInt(normalized.substring(9, 13));

      if (_pendingInitialStrokesTare) {
        _pendingInitialStrokesTare = false;
        _baselineRawStrokes = rawStrokes;
        _lastRawStrokes = rawStrokes;
        _strokesOffset = 0;
      } else if (_lastRawStrokes >= 4 && rawStrokes < (_lastRawStrokes - 2)) {
        _strokesOffset += (_lastRawStrokes >= _baselineRawStrokes) ? (_lastRawStrokes - _baselineRawStrokes) : 0;
        _baselineRawStrokes = 0;
      }

      final int curRelS = (rawStrokes >= _baselineRawStrokes) ? (rawStrokes - _baselineRawStrokes) : 0;
      totalStr = _strokesOffset + curRelS;
      if (rawStrokes > _lastRawStrokes || rawSpm > 8.0) {
        isMoving = true;
      }
      _lastRawStrokes = rawStrokes;

      strokeRate = rawSpm;
      if (strokeRate > 0.0) {
        _spmSum += strokeRate;
        _spmCount++;
        avgStrokeRate = _spmSum / _spmCount;
      }

      if (!_hasNativeSmartRowWatts) {
        final int fallbackW = _deriveSmartRowFallbackPower(strokeRate, instantPace, 0.0);
        if (fallbackW > 0) {
          instantPower = fallbackW;
          isMoving = true;
          _wattsSum += fallbackW;
          _wattsCount++;
          if (avgPower <= 0) {
            avgPower = (_wattsSum / _wattsCount).round();
          }
          if (instantPace <= 0) {
            instantPace = _paceFromWatts(instantPower);
          }
        }
      }
    } else if (msgType == 'e' && len >= 12) {
      // Allure (/500m) : [6..7) min, [7..9) sec, [9..10) avg_min, [10..12) avg_sec
      final int pMin = _safeParseInt(normalized.substring(6, 7));
      final int pSec = _safeParseInt(normalized.substring(7, 9));
      final int paceInst = pMin * 60 + pSec;

      if (paceInst > 0 && paceInst < 600) {
        instantPace = paceInst;
        isMoving = true;
        if (!_hasNativeSmartRowWatts && instantPower <= 0) {
          final int fallbackW = _deriveSmartRowFallbackPower(strokeRate, instantPace, 0.0);
          if (fallbackW > 0) {
            instantPower = fallbackW;
            _wattsSum += fallbackW;
            _wattsCount++;
            if (avgPower <= 0) {
              avgPower = (_wattsSum / _wattsCount).round();
            }
          }
        }
      } else {
        instantPace = 0;
      }

      final int avgMin = _safeParseInt(normalized.substring(9, 10));
      final int avgSec = _safeParseInt(normalized.substring(10, 12));
      final int srAvgPace = avgMin * 60 + avgSec;
      if (srAvgPace > 0 && srAvgPace < 600) {
        avgPace = srAvgPace;
      }
    } else if ((msgType == 'f' || msgType == 'x' || msgType == 'y' || msgType == 'z') && len >= 7) {
      int fVal = 0;
      if (len >= 11) {
        fVal = _safeParseInt(normalized.substring(7, 11));
      }
      if (fVal <= 0 && len >= 10) {
        fVal = _safeParseInt(normalized.substring(6, 10));
      }
      if (fVal <= 0 && len >= 9) {
        fVal = _safeParseInt(normalized.substring(6, 9));
      }
      final String? haltChar = (len >= 12) ? normalized.substring(11, 12) : null;
      if (haltChar == '!' && fVal == 0) {
        // Signal d'arrêt explicite SmartRow ('!')
        instantPower = 0;
        instantPace = 0;
        strokeRate = 0.0;
        isMoving = false;
      } else if (fVal > 15) {
        isMoving = true;
      }
    }

    return RowingMetrics(
      instantPower: instantPower,
      avgPower: avgPower,
      instantPace: instantPace,
      avgPace: avgPace,
      strokeRate: strokeRate,
      avgStrokeRate: avgStrokeRate,
      totalDistance: totalDist,
      strokeCount: totalStr,
      elapsedTime: current.elapsedTime,
      calories: calories,
      heartRate: current.heartRate,
      isMoving: isMoving,
    );
  }

  int _deriveSmartRowFallbackPower(double spm, int paceSec, double srAvgWatts) {
    if (_lastSmartRowWork > 0.0 && spm > 0.0) {
      // Identité mécanique exacte de la poulie SmartRow : P (W) = Work (J) * SPM / 60
      return ((_lastSmartRowWork * spm) / 60.0).round();
    }
    if (paceSec > 0 && paceSec < 600) {
      final double sr = paceSec / 500.0;
      final double denom = sr * sr * sr;
      if (denom > 0.0) {
        return ((2.80 / denom) + 0.5).toInt();
      }
    }
    if (srAvgWatts > 0.0) {
      return srAvgWatts.round();
    }
    return 0;
  }

  int _paceFromWatts(int watts) {
    if (watts <= 0) return 0;
    final num v = math.pow(watts / 2.80, 1.0 / 3.0);
    if (v <= 0) return 0;
    return (500.0 / v).round();
  }

  static String _normalizeSmartRowField(String field) {
    return field.replaceAll(' ', '0');
  }

  static int _safeParseInt(String str) {
    int acc = 0;
    bool hasDigits = false;
    for (int i = 0; i < str.length; i++) {
      final int c = str.codeUnitAt(i);
      if (c >= 48 && c <= 57) {
        acc = (acc * 10) + (c - 48);
        hasDigits = true;
      } else if (c != 32) {
        break;
      }
    }
    return hasDigits ? acc : 0;
  }
}
