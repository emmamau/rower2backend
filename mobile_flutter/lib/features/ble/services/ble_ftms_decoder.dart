import 'dart:math' as math;
import '../models/rowing_metrics.dart';

/// Décodeur binaire pur et autonome pour la caractéristique Rower Data FTMS (0x2AD1).
/// Totalement découplé des API Bluetooth, ce qui permet des tests unitaires rapides et fiables.
class BleFtmsDecoder {
  String? deviceName;

  int _baselineRawDistance = 0;
  int _baselineRawStrokes = 0;
  int _lastRawDistance = 0;
  int _lastRawStrokes = 0;
  int _distanceOffset = 0;
  int _strokesOffset = 0;
  bool _isDecimeterDistance = false;
  bool isFirstPacket = false;

  int _wattsSum = 0;
  int _wattsCount = 0;
  double _spmSum = 0.0;
  int _spmCount = 0;

  bool get isDecimeterDistance => _isDecimeterDistance;
  int get baselineRawDistance => _baselineRawDistance;
  int get lastRawDistance => _lastRawDistance;

  BleFtmsDecoder({this.deviceName});

  void reset() {
    _baselineRawDistance = 0;
    _baselineRawStrokes = 0;
    _lastRawDistance = 0;
    _lastRawStrokes = 0;
    _distanceOffset = 0;
    _strokesOffset = 0;
    _isDecimeterDistance = false;
    isFirstPacket = false;
    _wattsSum = 0;
    _wattsCount = 0;
    _spmSum = 0.0;
    _spmCount = 0;
  }

  void reTareToZero() {
    _baselineRawDistance = _lastRawDistance;
    _baselineRawStrokes = _lastRawStrokes;
    _distanceOffset = 0;
    _strokesOffset = 0;
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
    int calories = current.calories;
    int heartRate = current.heartRate;

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
      if (!_isDecimeterDistance && _lastRawDistance > 0) {
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

    if (isFirstPacket) {
      isFirstPacket = false;
      _baselineRawDistance = rawDistance;
      _baselineRawStrokes = rawStrokes;
      _lastRawDistance = rawDistance;
      _lastRawStrokes = rawStrokes;
      _distanceOffset = 0;
      _strokesOffset = 0;
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

    return RowingMetrics(
      instantPower: hasPacketWatts ? packetWatts : (packetWatts > 0 ? packetWatts : current.instantPower),
      avgPower: avgW > 0 ? avgW : current.avgPower,
      instantPace: hasPacketPace ? packetPace : (packetPace > 0 ? packetPace : current.instantPace),
      avgPace: current.avgPace,
      strokeRate: hasPacketSpm ? packetSpm : current.strokeRate,
      avgStrokeRate: avgS > 0 ? avgS : current.avgStrokeRate,
      totalDistance: totalDist,
      strokeCount: totalStr,
      elapsedTime: current.elapsedTime,
      calories: calories,
      heartRate: heartRate,
      isMoving: isMoving,
    );
  }
}
