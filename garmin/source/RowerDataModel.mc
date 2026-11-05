import Toybox.Lang;
import Toybox.Math;
import Toybox.StringUtil;

class RowerDataModel {

    // Connection states (aligned with rower.iq)
    public static const STATE_DISCONNECTED       = 0;
    public static const STATE_SCANNING           = 1;
    public static const STATE_CONNECTING         = 2;
    public static const STATE_CONNECTED_FTMS     = 3;
    public static const STATE_CONNECTED_SMARTROW = 4;

    public var connectionState as Number = STATE_DISCONNECTED;
    public var deviceName as String = "Scan BLE...";

    // Unified real-time & session rowing metrics
    public var strokeRate as Float = 0.0f;       // strokes/min (SPM)
    public var strokeCount as Number = 0;        // tared session strokes
    public var avgStrokeRate as Float = 0.0f;    // strokes/min
    public var totalDistance as Number = 0;      // tared session distance in meters
    public var instantPace as Number = 0;        // seconds per 500m
    public var avgPace as Number = 0;            // seconds per 500m
    public var instantPower as Number = 0;       // Watts
    public var avgPower as Number = 0;           // Watts
    public var maxPower as Number = 0;           // Watts
    public var work as Float = 0.0f;             // Joules (J)
    public var force as Number = 0;              // Newtons (N)
    public var avgForce as Number = 0;           // Newtons (N)
    public var handleLengthCm as Number = 0;     // cm
    public var resistanceLevel as Number = 0;
    public var totalEnergy as Number = 0;        // kcal
    public var energyPerHour as Number = 0;
    public var energyPerMinute as Number = 0;
    public var heartRate as Number = 0;          // bpm (watch sensor or BLE)
    public var bleHeartRate as Number = 0;       // bpm from BLE rower
    public var metabolicEq as Float = 0.0f;      // METs
    public var elapsedTime as Number = 0;        // session seconds
    public var remainingTime as Number = 0;      // seconds
    public var rawFlags as Number = 0;
    public var speedCmS as Number = 0;           // cm/s

    // Session & movement flags
    public var workoutStarted as Boolean = false;
    public var isPaused as Boolean = false;
    public var hasStartedRowing as Boolean = false;
    public var isHalted as Boolean = true;
    // True when physical movement is detected on hardware before race start (false-start guard)
    public var liveMovementDetected as Boolean = false;

    // Hardware tare, Merach decimeter scaling & dead-reckoning accumulators (ported from rower.iq)
    private var _hasHardwareDistance as Boolean = false;
    private var _accumulatedDistanceMetersFloat as Float = 0.0f;
    private var _isDecimeterDistance as Boolean = false;
    private var _baselineRawDistance as Number = 0;
    private var _baselineRawStrokes as Number = 0;
    private var _isFirstPacketAfterConnect as Boolean = true;
    private var _lastRawDistance as Number = 0;
    private var _distanceOffset as Number = 0;
    private var _lastRawStrokes as Number = 0;
    private var _strokesOffset as Number = 0;
    private var _haltedByTimeout as Boolean = false;
    private var _secondsSinceLastStrokeOrDist as Number = 0;
    private var _secondsSinceLastPacket as Number = 0;
    private var _sessionTimerSec as Number = 0;

    // Running session average accumulators
    private var _wattsSum as Long = 0L;
    private var _wattsSamples as Number = 0;
    private var _avgWattsFloat as Float = 0.0f;
    private var _paceSum as Long = 0L;
    private var _paceSamples as Number = 0;
    private var _spmSum as Float = 0.0f;
    private var _spmSamples as Number = 0;
    private var _forceSum as Long = 0L;
    private var _forceSamples as Number = 0;

    public function initialize() {
        resetMetrics();
    }

    public function isConnected() as Boolean {
        return (connectionState == STATE_CONNECTED_FTMS || connectionState == STATE_CONNECTED_SMARTROW);
    }

    public function isMerachRower() as Boolean {
        var upper = deviceName.toUpper();
        return (upper.find("MERACH") != null || upper.find("MRK") != null || upper.find("MR-") != null || upper.find("NOVAROW") != null);
    }

    public function resetMetrics() as Void {
        strokeRate = 0.0f;
        strokeCount = 0;
        avgStrokeRate = 0.0f;
        totalDistance = 0;
        instantPace = 0;
        avgPace = 0;
        instantPower = 0;
        avgPower = 0;
        maxPower = 0;
        work = 0.0f;
        force = 0;
        avgForce = 0;
        handleLengthCm = 0;
        resistanceLevel = 0;
        totalEnergy = 0;
        energyPerHour = 0;
        energyPerMinute = 0;
        bleHeartRate = 0;
        metabolicEq = 0.0f;
        elapsedTime = 0;
        remainingTime = 0;
        rawFlags = 0;
        speedCmS = 0;

        workoutStarted = false;
        isPaused = false;
        hasStartedRowing = false;
        isHalted = true;
        liveMovementDetected = false;

        _hasHardwareDistance = false;
        _accumulatedDistanceMetersFloat = 0.0f;
        _isDecimeterDistance = false;
        _baselineRawDistance = 0;
        _baselineRawStrokes = 0;
        _isFirstPacketAfterConnect = true;
        _lastRawDistance = 0;
        _distanceOffset = 0;
        _lastRawStrokes = 0;
        _strokesOffset = 0;
        _haltedByTimeout = false;
        _secondsSinceLastStrokeOrDist = 0;
        _secondsSinceLastPacket = 0;
        _sessionTimerSec = 0;

        _wattsSum = 0L;
        _wattsSamples = 0;
        _avgWattsFloat = 0.0f;
        _paceSum = 0L;
        _paceSamples = 0;
        _spmSum = 0.0f;
        _spmSamples = 0;
        _forceSum = 0L;
        _forceSamples = 0;
    }

    //! Start active race/solo session: tare hardware counters to zero cleanly
    public function startWorkout() as Void {
        workoutStarted = true;
        isPaused = false;
        hasStartedRowing = false;
        isHalted = false;
        liveMovementDetected = false;
        _secondsSinceLastStrokeOrDist = 0;
        _secondsSinceLastPacket = 0;
        _sessionTimerSec = 0;

        if (_lastRawDistance > 0) {
            _baselineRawDistance = _lastRawDistance;
        }
        if (_lastRawStrokes > 0) {
            _baselineRawStrokes = _lastRawStrokes;
        }
        _distanceOffset = 0;
        _strokesOffset = 0;
        totalDistance = 0;
        strokeCount = 0;
        _accumulatedDistanceMetersFloat = 0.0f;
        elapsedTime = 0;
        instantPace = 0;
        avgPace = 0;
        instantPower = 0;
        avgPower = 0;
        maxPower = 0;
        strokeRate = 0.0f;
        avgStrokeRate = 0.0f;
        work = 0.0f;
        force = 0;
        avgForce = 0;
        totalEnergy = 0;

        _wattsSum = 0L;
        _wattsSamples = 0;
        _avgWattsFloat = 0.0f;
        _paceSum = 0L;
        _paceSamples = 0;
        _spmSum = 0.0f;
        _spmSamples = 0;
        _forceSum = 0L;
        _forceSamples = 0;
    }

    //! Re-tare current hardware counters (e.g. after false start penalty unlock)
    public function reTareToZero() as Void {
        _baselineRawDistance = _lastRawDistance;
        _baselineRawStrokes = _lastRawStrokes;
        _distanceOffset = 0;
        _strokesOffset = 0;
        totalDistance = 0;
        strokeCount = 0;
        _accumulatedDistanceMetersFloat = 0.0f;
    }

    //! Called by BleDelegate when BLE connection is established
    public function onBleConnected() as Void {
        _secondsSinceLastPacket = 0;
        _secondsSinceLastStrokeOrDist = 0;
        _haltedByTimeout = false;
        if (!workoutStarted || !hasStartedRowing) {
            _isFirstPacketAfterConnect = true;
            _distanceOffset = 0;
            _strokesOffset = 0;
        } else {
            // Reconnection mid-race: preserve session distance & stroke offsets!
            _isFirstPacketAfterConnect = false;
        }
    }

    private function applyIdleState() as Void {
        totalDistance = 0;
        strokeCount = 0;
        _accumulatedDistanceMetersFloat = 0.0f;
        instantPace = 0;
        avgPace = 0;
        instantPower = 0;
        avgPower = 0;
        strokeRate = 0.0f;
        avgStrokeRate = 0.0f;
        speedCmS = 0;
        work = 0.0f;
        force = 0;
        totalEnergy = 0;
        isHalted = true;
        hasStartedRowing = false;
    }

    private function onActiveRowingDetected() as Void {
        hasStartedRowing = true;
        isHalted = false;
        _haltedByTimeout = false;
        _secondsSinceLastStrokeOrDist = 0;
    }

    private function onRowingHalted(byTimeout as Boolean) as Void {
        isHalted = true;
        _haltedByTimeout = byTimeout;
        instantPower = 0;
        strokeRate = 0.0f;
        instantPace = 0;
        speedCmS = 0;
        liveMovementDetected = false;
    }

    //! Called once per second by app timer
    public function onOneSecondTick() as Void {
        _secondsSinceLastPacket += 1;

        if (_secondsSinceLastPacket >= 3) {
            liveMovementDetected = false;
        }

        if (!workoutStarted || isPaused) {
            return;
        }

        // Advance authoritative race session timer
        _sessionTimerSec += 1;
        elapsedTime = _sessionTimerSec;

        if (!hasStartedRowing || isHalted) {
            return;
        }

        // Dead-reckoning fallback when rower omits hardware distance or during transient BLE drop
        var isPacketDrop = (_secondsSinceLastPacket >= 2);
        if (!_hasHardwareDistance || totalDistance == 0 || isPacketDrop) {
            if (speedCmS > 0) {
                _accumulatedDistanceMetersFloat += (speedCmS.toFloat() / 100.0f);
                totalDistance = _accumulatedDistanceMetersFloat.toNumber();
            } else if (instantPace > 0 && instantPace < 600) {
                _accumulatedDistanceMetersFloat += (500.0f / instantPace.toFloat());
                totalDistance = _accumulatedDistanceMetersFloat.toNumber();
            }
        }

        _secondsSinceLastStrokeOrDist += 1;
        if (_secondsSinceLastStrokeOrDist >= 10 || _secondsSinceLastPacket >= 12) {
            onRowingHalted(true);
        }
    }

    // =========================================================================
    // 1. FTMS ROWER DATA PARSER (0x2AD1) - Ported directly from rower.iq
    // =========================================================================
    public function parseFtmsRowerData(bytes as ByteArray) as Void {
        var size = bytes.size();
        if (size < 2) {
            return;
        }

        var flags = (bytes[0] & 0xFF) | ((bytes[1] & 0xFF) << 8);
        rawFlags = flags;
        var offset = 2;

        var rawStrokes = _lastRawStrokes;
        var rawDistance = _lastRawDistance;
        var rawRemaining = remainingTime;

        var hasPacketSpm = false;
        var hasPacketWatts = false;
        var hasPacketPace = false;
        var hasPacketAvgSpm = false;
        var hasPacketAvgPace = false;
        var hasPacketAvgWatts = false;

        var packetSpm = 0.0f;
        var packetPace = 0;
        var packetWatts = 0;

        // Bit 0: More Data (0 = Stroke Rate uint8 [0.5 spm] + Stroke Count uint16 present)
        if ((flags & 0x0001) == 0) {
            if (offset + 3 <= size) {
                var rawSpm = bytes[offset] & 0xFF;
                packetSpm = rawSpm.toFloat() * 0.5f;
                rawStrokes = (bytes[offset + 1] & 0xFF) | ((bytes[offset + 2] & 0xFF) << 8);
                hasPacketSpm = true;
                offset += 3;
            }
        }

        // Bit 1: Average Stroke Rate present (uint8, 0.5 spm)
        if ((flags & 0x0002) != 0 && (offset + 1) <= size) {
            var parsedAvgSpm = (bytes[offset] & 0xFF).toFloat() * 0.5f;
            if (parsedAvgSpm > 0.0f) {
                avgStrokeRate = parsedAvgSpm;
                hasPacketAvgSpm = true;
            }
            offset += 1;
        }

        // Bit 2: Total Distance present (uint24, meters)
        if ((flags & 0x0004) != 0 && (offset + 3) <= size) {
            rawDistance = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8) | ((bytes[offset + 2] & 0xFF) << 16);
            if (rawDistance > 0) {
                _hasHardwareDistance = true;
            }
            offset += 3;
        }

        // Bit 3: Instantaneous Pace present (uint16, seconds/500m)
        if ((flags & 0x0008) != 0 && (offset + 2) <= size) {
            var rawPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            hasPacketPace = true;
            if (rawPace != 0xFFFF && rawPace > 0) {
                packetPace = rawPace;
            }
            offset += 2;
        }

        // Bit 4: Average Pace present (uint16, seconds/500m)
        if ((flags & 0x0010) != 0 && (offset + 2) <= size) {
            var rawAvgPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawAvgPace > 0 && rawAvgPace != 0xFFFF) {
                avgPace = rawAvgPace;
                hasPacketAvgPace = true;
            }
            offset += 2;
        }

        // Bit 5: Instantaneous Power present (sint16, Watts)
        if ((flags & 0x0020) != 0 && (offset + 2) <= size) {
            var rawWatts = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawWatts > 32767) {
                rawWatts -= 65536;
            }
            if (rawWatts > 0) {
                packetWatts = rawWatts;
            }
            hasPacketWatts = true;
            offset += 2;
        }

        // Bit 6: Average Power present (sint16, Watts)
        if ((flags & 0x0040) != 0 && (offset + 2) <= size) {
            var rawAvgWatts = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawAvgWatts > 32767) {
                rawAvgWatts -= 65536;
            }
            if (rawAvgWatts > 0) {
                _avgWattsFloat = rawAvgWatts.toFloat();
                avgPower = rawAvgWatts;
                hasPacketAvgWatts = true;
            }
            offset += 2;
        }

        // Bit 7: Resistance Level present (sint16)
        if ((flags & 0x0080) != 0 && (offset + 2) <= size) {
            var rawRes = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawRes > 32767) {
                rawRes -= 65536;
            }
            if (rawRes >= 0) {
                resistanceLevel = rawRes;
            }
            offset += 2;
        }

        // Bit 8: Expended Energy present (5 bytes or 2 bytes)
        if ((flags & 0x0100) != 0) {
            if (offset + 5 <= size) {
                var rawKcal = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
                if (rawKcal != 0xFFFF) {
                    totalEnergy = rawKcal;
                }
                energyPerHour = (bytes[offset + 2] & 0xFF) | ((bytes[offset + 3] & 0xFF) << 8);
                energyPerMinute = bytes[offset + 4] & 0xFF;
                offset += 5;
            } else if (offset + 2 <= size) {
                var rawKcal2 = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
                if (rawKcal2 != 0xFFFF) {
                    totalEnergy = rawKcal2;
                }
                offset += 2;
            }
        }

        // Bit 9: Heart Rate present (uint8, bpm)
        if ((flags & 0x0200) != 0 && (offset + 1) <= size) {
            bleHeartRate = bytes[offset] & 0xFF;
            if (heartRate == 0 && bleHeartRate > 0) {
                heartRate = bleHeartRate;
            }
            offset += 1;
        }

        // Bit 10: Metabolic Equivalent present (uint8)
        if ((flags & 0x0400) != 0 && (offset + 1) <= size) {
            metabolicEq = (bytes[offset] & 0xFF).toFloat() * 0.1f;
            offset += 1;
        }

        // Bit 11: Elapsed Time present (uint16, seconds)
        if ((flags & 0x0800) != 0 && (offset + 2) <= size) {
            offset += 2;
        }

        // Bit 12: Remaining Time present (uint16, seconds)
        if ((flags & 0x1000) != 0 && (offset + 2) <= size) {
            var parsedRem = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (parsedRem != 0xFFFF) {
                rawRemaining = parsedRem;
            }
            offset += 2;
        }

        // Detect and correct decimeter distance scaling (0.1m units) commonly sent by MERACH rowers
        if (_hasHardwareDistance && rawDistance > 0) {
            if (!_isDecimeterDistance) {
                var detectDecimeter = false;
                if (isMerachRower()) {
                    if (rawStrokes > 0) {
                        if ((rawDistance.toFloat() / rawStrokes.toFloat()) >= 20.0f) {
                            detectDecimeter = true;
                        }
                    } else if (rawDistance > 50) {
                        detectDecimeter = true;
                    }
                } else if (rawStrokes > 0) {
                    if ((rawDistance.toFloat() / rawStrokes.toFloat()) >= 30.0f) {
                        detectDecimeter = true;
                    }
                }

                if (detectDecimeter) {
                    _isDecimeterDistance = true;
                    if (_baselineRawDistance > 0) {
                        _baselineRawDistance = (_baselineRawDistance + 5) / 10;
                    }
                    if (_lastRawDistance > 0) {
                        _lastRawDistance = (_lastRawDistance + 5) / 10;
                    }
                }
            }
            if (_isDecimeterDistance) {
                rawDistance = (rawDistance + 5) / 10;
            }
        }

        _secondsSinceLastPacket = 0;

        var hasCounters = hasPacketSpm || ((flags & 0x0004) != 0);
        var hasActiveMovement = (!hasCounters) && (packetWatts > 10);

        if (_isFirstPacketAfterConnect) {
            _isFirstPacketAfterConnect = false;
            liveMovementDetected = false;
            if (!workoutStarted || !hasStartedRowing) {
                _baselineRawDistance = rawDistance;
                _baselineRawStrokes = rawStrokes;
                _lastRawDistance = rawDistance;
                _lastRawStrokes = rawStrokes;
                _distanceOffset = 0;
                _strokesOffset = 0;
                remainingTime = rawRemaining;
                applyIdleState();
                return;
            }
        }

        // Track live physical movement even before workout starts (for false-start guard)
        liveMovementDetected = (rawDistance > _lastRawDistance) || (rawStrokes > _lastRawStrokes) || (packetSpm > 0.0f && packetWatts > 10);

        if (!workoutStarted) {
            _baselineRawDistance = rawDistance;
            _baselineRawStrokes = rawStrokes;
            _lastRawDistance = rawDistance;
            _lastRawStrokes = rawStrokes;
            applyIdleState();
            return;
        }

        if (!hasStartedRowing) {
            if (_hasHardwareDistance && rawDistance < _baselineRawDistance) {
                _baselineRawDistance = rawDistance;
            }
            if (rawStrokes < _baselineRawStrokes) {
                _baselineRawStrokes = rawStrokes;
            }
            var deltaDist = _hasHardwareDistance ? (rawDistance - _baselineRawDistance) : 0;
            var deltaStrokes = rawStrokes - _baselineRawStrokes;
            var hasMovement = (deltaDist > 0) || (deltaStrokes > 0) || hasActiveMovement;

            _lastRawDistance = rawDistance;
            _lastRawStrokes = rawStrokes;

            if (!hasMovement) {
                return;
            }

            onActiveRowingDetected();
            if (_hasHardwareDistance) {
                totalDistance = deltaDist + _distanceOffset;
                _accumulatedDistanceMetersFloat = totalDistance.toFloat();
            } else {
                var firstStrokeDist = (packetPace > 0 && packetSpm > 0.0f) ? (30000.0f / (packetPace.toFloat() * packetSpm)) : 10.0f;
                if (firstStrokeDist < 4.0f) { firstStrokeDist = 4.0f; }
                if (firstStrokeDist > 16.0f) { firstStrokeDist = 16.0f; }
                var sCount = (deltaStrokes > 0) ? deltaStrokes : 1;
                _accumulatedDistanceMetersFloat = firstStrokeDist * sCount.toFloat();
                totalDistance = _accumulatedDistanceMetersFloat.toNumber();
            }
            strokeCount = deltaStrokes + _strokesOffset;
            remainingTime = rawRemaining;
            strokeRate = packetSpm;
            instantPower = packetWatts;
            instantPace = packetPace;
            speedCmS = (instantPace > 0) ? (50000 / instantPace).toNumber() : 0;
        } else {
            var distReset = _hasHardwareDistance && (_lastRawDistance >= 10) && (rawDistance < (_lastRawDistance - 5));
            var strokesReset = (_lastRawStrokes >= 4) && (rawStrokes < (_lastRawStrokes - 2));

            if (distReset || strokesReset) {
                if (distReset) {
                    _distanceOffset += (_lastRawDistance >= _baselineRawDistance) ? (_lastRawDistance - _baselineRawDistance) : _lastRawDistance;
                    _baselineRawDistance = 0;
                }
                if (strokesReset) {
                    _strokesOffset += (_lastRawStrokes >= _baselineRawStrokes) ? (_lastRawStrokes - _baselineRawStrokes) : _lastRawStrokes;
                    _baselineRawStrokes = 0;
                }
            }

            var curRelD = (rawDistance >= _baselineRawDistance) ? (rawDistance - _baselineRawDistance) : 0;
            var curRelS = (rawStrokes >= _baselineRawStrokes) ? (rawStrokes - _baselineRawStrokes) : 0;
            if (_hasHardwareDistance) {
                totalDistance = _distanceOffset + curRelD;
                _accumulatedDistanceMetersFloat = totalDistance.toFloat();
            } else if (strokeCount != (_strokesOffset + curRelS)) {
                var dS = (_strokesOffset + curRelS) - strokeCount;
                if (dS > 0) {
                    var effP = (packetPace > 0) ? packetPace : instantPace;
                    var effS = (packetSpm > 0.0f) ? packetSpm : strokeRate;
                    var sDist = (effP > 0 && effS > 0.0f) ? (30000.0f / (effP.toFloat() * effS)) : 10.0f;
                    if (sDist < 4.0f) { sDist = 4.0f; }
                    if (sDist > 16.0f) { sDist = 16.0f; }
                    _accumulatedDistanceMetersFloat += (sDist * dS.toFloat());
                    totalDistance = _accumulatedDistanceMetersFloat.toNumber();
                }
            }
            strokeCount = _strokesOffset + curRelS;
            remainingTime = rawRemaining;

            var progressed = (_hasHardwareDistance && rawDistance > _lastRawDistance) || (rawStrokes > _lastRawStrokes);
            if (progressed || packetWatts > 10 || packetSpm > 8.0f) {
                onActiveRowingDetected();
            }

            _lastRawDistance = rawDistance;
            _lastRawStrokes = rawStrokes;

            strokeRate = packetSpm;
            instantPower = packetWatts;
            instantPace = packetPace;
            speedCmS = (instantPace > 0) ? (50000 / instantPace).toNumber() : 0;
        }

        var effSpm = (strokeRate > 0.0f) ? strokeRate : avgStrokeRate;

        if (isHalted) {
            instantPower = 0;
            strokeRate = 0.0f;
            instantPace = 0;
            speedCmS = 0;
        } else {
            // Cross-derive Power <-> Pace for rowers omitting one field (e.g. VOWVIT V-W3, FitShow, Domyos)
            if (!hasPacketWatts && instantPace > 0 && instantPace < 600) {
                var splitRatio = instantPace.toFloat() / 500.0f;
                var denom = splitRatio * splitRatio * splitRatio;
                if (denom > 0.0f) {
                    instantPower = ((2.80f / denom) + 0.5f).toNumber();
                }
            } else if (!hasPacketPace && instantPower > 0) {
                var cubeRoot = Math.pow(2.80f / instantPower.toFloat(), 1.0f / 3.0f).toFloat();
                var derivedPace = ((500.0f * cubeRoot) + 0.5f).toNumber();
                if (derivedPace > 0 && derivedPace < 600) {
                    instantPace = derivedPace;
                    speedCmS = (50000 / instantPace).toNumber();
                }
            } else if (!hasPacketWatts && !hasPacketPace && effSpm > 8.0f) {
                var estPace = (185.0f - (2.5f * effSpm)).toNumber();
                if (estPace < 95) { estPace = 95; }
                if (estPace > 240) { estPace = 240; }
                instantPace = estPace;
                speedCmS = (50000 / instantPace).toNumber();
                var sr2 = instantPace.toFloat() / 500.0f;
                var dn2 = sr2 * sr2 * sr2;
                if (dn2 > 0.0f) {
                    instantPower = ((2.80f / dn2) + 0.5f).toNumber();
                }
            }

            if (instantPower > 0) {
                if (instantPower > maxPower) {
                    maxPower = instantPower;
                }
                _wattsSum += instantPower;
                _wattsSamples += 1;
                if (!hasPacketAvgWatts) {
                    _avgWattsFloat = _wattsSum.toFloat() / _wattsSamples.toFloat();
                    avgPower = (_avgWattsFloat + 0.5f).toNumber();
                }
            }

            if (effSpm > 0.0f && instantPower > 0) {
                work = (instantPower.toFloat() * 60.0f) / effSpm;
            }
            var dynHandleCm = (136.0f - (1.2f * effSpm)).toNumber();
            if (dynHandleCm < 80) { dynHandleCm = 80; }
            if (dynHandleCm > 135) { dynHandleCm = 135; }
            handleLengthCm = dynHandleCm;
            var effLenM = handleLengthCm.toFloat() / 100.0f;
            if (effLenM > 0.0f && work > 0.0f) {
                force = (work / effLenM).toNumber();
            }

            updateRunningAverages(hasPacketAvgPace, hasPacketAvgSpm);
        }
    }

    private function updateRunningAverages(hasPacketAvgPace as Boolean, hasPacketAvgSpm as Boolean) as Void {
        if (instantPace > 0 && instantPace < 600) {
            _paceSum += instantPace;
            _paceSamples += 1;
            if (!hasPacketAvgPace || avgPace <= 0) {
                avgPace = (_paceSum / _paceSamples).toNumber();
            }
        }
        if (strokeRate > 0.0f) {
            _spmSum += strokeRate;
            _spmSamples += 1;
            if (!hasPacketAvgSpm || avgStrokeRate <= 0.0f) {
                avgStrokeRate = _spmSum / _spmSamples.toFloat();
            }
        }
        if (force > 0) {
            _forceSum += force;
            _forceSamples += 1;
            avgForce = (_forceSum / _forceSamples).toNumber();
        }
    }

    // =========================================================================
    // 2. WATERROWER SMARTROW DIRECT PULLEY PARSER (0x1236) - Ported from rower.iq
    // =========================================================================
    public function parseSmartRowBytes(bytes as ByteArray) as Void {
        var size = bytes.size();
        if (size < 6) {
            return;
        }

        var frameChars = new [size] as Array<Char>;
        var frameLen = 0;
        var isRecord = false;

        for (var i = 0; i < size; i++) {
            var b = bytes[i];
            if (b == 0x0D || b == 0x0A) {
                if (frameLen >= 6) {
                    var slice = frameChars.slice(0, frameLen) as Array<Char>;
                    parseSmartRowString(StringUtil.charArrayToString(slice));
                }
                frameLen = 0;
                isRecord = false;
            } else {
                if (frameLen == 0) {
                    isRecord = (b == 0x61 || b == 0x62 || b == 0x63 || b == 0x64 ||
                                b == 0x65 || b == 0x66 || b == 0x78 || b == 0x79 || b == 0x7A);
                } else if (isRecord && frameLen >= 1 && frameLen <= 5) {
                    // Unscramble SmartRow V3 distance digits: (b & 0x0F) | 0x30 -> ASCII '0'..'9'
                    b = (b & 0x0F) | 0x30;
                }
                if (b >= 0x20 && b <= 0x7E) {
                    frameChars[frameLen] = b.toChar();
                    frameLen += 1;
                }
            }
        }
        if (frameLen >= 6) {
            var slice = frameChars.slice(0, frameLen) as Array<Char>;
            parseSmartRowString(StringUtil.charArrayToString(slice));
        }
    }

    public function parseSmartRowString(event as String) as Void {
        var len = event.length();
        if (len < 6) {
            return;
        }

        _secondsSinceLastPacket = 0;

        var normalized = normalizeSmartRowField(event);
        var msgType = normalized.substring(0, 1);
        if (msgType == null) {
            return;
        }

        // Distance is in characters [1..6) for messages a..f and force-curve frames x..z
        if (msgType.equals("a") || msgType.equals("b") || msgType.equals("c") ||
            msgType.equals("d") || msgType.equals("e") || msgType.equals("f") ||
            msgType.equals("x") || msgType.equals("y") || msgType.equals("z")) {
            var rawDistance = safeParseInt(normalized.substring(1, 6));

            if (!workoutStarted) {
                if (_isFirstPacketAfterConnect) {
                    _isFirstPacketAfterConnect = false;
                    liveMovementDetected = false;
                } else {
                    if (rawDistance > _lastRawDistance) {
                        liveMovementDetected = true;
                    }
                }
                if (msgType.equals("d") && len >= 13) {
                    var idleStrokes = safeParseInt(normalized.substring(9, 13));
                    if (idleStrokes > _lastRawStrokes && _lastRawStrokes > 0) {
                        liveMovementDetected = true;
                    }
                    _baselineRawStrokes = idleStrokes;
                    _lastRawStrokes = idleStrokes;
                }
                _baselineRawDistance = rawDistance;
                _lastRawDistance = rawDistance;
                _hasHardwareDistance = true;
                applyIdleState();
                return;
            }

            if (_isFirstPacketAfterConnect) {
                _isFirstPacketAfterConnect = false;
                _lastRawDistance = rawDistance;
                _hasHardwareDistance = true;
                if (!hasStartedRowing) {
                    _baselineRawDistance = rawDistance;
                    totalDistance = 0;
                    _accumulatedDistanceMetersFloat = 0.0f;
                }
            } else if (!hasStartedRowing) {
                if (rawDistance > _baselineRawDistance) {
                    onActiveRowingDetected();
                    totalDistance = rawDistance - _baselineRawDistance + _distanceOffset;
                    _accumulatedDistanceMetersFloat = totalDistance.toFloat();
                } else {
                    totalDistance = 0;
                    _accumulatedDistanceMetersFloat = 0.0f;
                }
                _lastRawDistance = rawDistance;
                _hasHardwareDistance = true;
            } else {
                var distReset = (_lastRawDistance >= 10) && (rawDistance < (_lastRawDistance - 5));
                if (distReset) {
                    _distanceOffset += (_lastRawDistance >= _baselineRawDistance) ? (_lastRawDistance - _baselineRawDistance) : _lastRawDistance;
                    _baselineRawDistance = 0;
                }
                var curRelD = (rawDistance >= _baselineRawDistance) ? (rawDistance - _baselineRawDistance) : 0;
                totalDistance = _distanceOffset + curRelD;
                _accumulatedDistanceMetersFloat = totalDistance.toFloat();
                _hasHardwareDistance = true;
                if (rawDistance > _lastRawDistance) {
                    onActiveRowingDetected();
                    liveMovementDetected = true;
                }
                _lastRawDistance = rawDistance;
            }
        }

        if (msgType.equals("a") && len >= 10) {
            totalEnergy = safeParseInt(normalized.substring(6, 10));
        } else if (msgType.equals("b") && len >= 13) {
            work = safeParseInt(normalized.substring(7, 11)).toFloat() / 10.0f;
            if (work > 0.0f && hasStartedRowing) {
                onActiveRowingDetected();
            }
            var endLenIdx = (len >= 14) ? 14 : len;
            handleLengthCm = safeParseInt(normalizeSmartRowField(event.substring(11, endLenIdx)));
            if (handleLengthCm <= 0) {
                handleLengthCm = 105;
            }
            var effLenM = handleLengthCm.toFloat() / 100.0f;
            if (effLenM > 0.0f && work > 0.0f) {
                var strokeAvgF = (work / effLenM).toNumber();
                if (force <= 0) {
                    force = strokeAvgF;
                }
                if (strokeAvgF > 0) {
                    _forceSum += strokeAvgF;
                    _forceSamples += 1;
                    avgForce = (_forceSum / _forceSamples).toNumber();
                }
            }
        } else if (msgType.equals("c") && len >= 14) {
            var rawWatts = safeParseInt(normalized.substring(6, 9));
            if (rawWatts > 0 && hasStartedRowing) {
                onActiveRowingDetected();
            }
            if (isHalted) {
                instantPower = 0;
            } else {
                instantPower = rawWatts;
                if (instantPower > maxPower) {
                    maxPower = instantPower;
                }
                if (instantPower > 0) {
                    _wattsSum += instantPower;
                    _wattsSamples += 1;
                    // Derive pace if e-frame hasn't arrived yet
                    if (instantPace <= 0 && instantPower > 15) {
                        var cr = Math.pow(2.80f / instantPower.toFloat(), 1.0f / 3.0f).toFloat();
                        var dp = ((500.0f * cr) + 0.5f).toNumber();
                        if (dp > 0 && dp < 600) {
                            instantPace = dp;
                            speedCmS = (50000 / instantPace).toNumber();
                        }
                    }
                }
            }
            var srAvgWatts = safeParseInt(normalized.substring(9, 14)).toFloat() / 10.0f;
            if (srAvgWatts > 0.0f) {
                _avgWattsFloat = srAvgWatts;
                avgPower = (srAvgWatts + 0.5f).toNumber();
            } else if (_wattsSamples > 0) {
                _avgWattsFloat = _wattsSum.toFloat() / _wattsSamples.toFloat();
                avgPower = (_avgWattsFloat + 0.5f).toNumber();
            }
        } else if (msgType.equals("d") && len >= 13) {
            // SmartRow cadence at [6..9) is in tenths of SPM (e.g. "254" = 25.4 SPM)
            var rawSpm = safeParseInt(normalized.substring(6, 9)).toFloat() / 10.0f;
            var rawStrokes = safeParseInt(normalized.substring(9, 13));
            if (!hasStartedRowing) {
                if (rawStrokes > _baselineRawStrokes || rawSpm > 8.0f) {
                    onActiveRowingDetected();
                    strokeCount = (rawStrokes >= _baselineRawStrokes) ? (rawStrokes - _baselineRawStrokes + _strokesOffset) : _strokesOffset;
                } else {
                    _baselineRawStrokes = rawStrokes;
                    strokeCount = 0;
                }
            } else {
                var strokesReset = (_lastRawStrokes >= 4) && (rawStrokes < (_lastRawStrokes - 2));
                if (strokesReset) {
                    _strokesOffset += (_lastRawStrokes >= _baselineRawStrokes) ? (_lastRawStrokes - _baselineRawStrokes) : _lastRawStrokes;
                    _baselineRawStrokes = 0;
                }
                var curRelS = (rawStrokes >= _baselineRawStrokes) ? (rawStrokes - _baselineRawStrokes) : 0;
                strokeCount = _strokesOffset + curRelS;
                if (rawStrokes > _lastRawStrokes || rawSpm > 8.0f) {
                    onActiveRowingDetected();
                }
            }
            _lastRawStrokes = rawStrokes;
            if (isHalted) {
                strokeRate = 0.0f;
            } else {
                strokeRate = rawSpm;
                if (strokeRate > 0.0f) {
                    _spmSum += strokeRate;
                    _spmSamples += 1;
                    avgStrokeRate = _spmSum / _spmSamples.toFloat();
                }
            }
        } else if (msgType.equals("e") && len >= 12) {
            var pMin = safeParseInt(normalized.substring(6, 7));
            var pSec = safeParseInt(normalized.substring(7, 9));
            var paceInst = pMin * 60 + pSec;
            if (paceInst > 0 && paceInst < 600 && !_haltedByTimeout && hasStartedRowing) {
                onActiveRowingDetected();
            }
            if (isHalted || paceInst <= 0) {
                instantPace = 0;
                speedCmS = 0;
            } else {
                instantPace = paceInst;
                speedCmS = (50000 / paceInst).toNumber();
                if (instantPace < 600) {
                    _paceSum += instantPace;
                    _paceSamples += 1;
                }
            }
            var avgMin = safeParseInt(normalized.substring(9, 10));
            var avgSec = safeParseInt(normalized.substring(10, 12));
            var srAvgPace = avgMin * 60 + avgSec;
            if (srAvgPace > 0) {
                avgPace = srAvgPace;
            } else if (_paceSamples > 0) {
                avgPace = (_paceSum / _paceSamples).toNumber();
            }
        } else if ((msgType.equals("f") || msgType.equals("x") || msgType.equals("y") || msgType.equals("z")) && len >= 7) {
            var fVal = 0;
            if (len >= 11) {
                fVal = safeParseInt(normalized.substring(7, 11));
            }
            if (fVal <= 0 && len >= 10) {
                fVal = safeParseInt(normalized.substring(6, 10));
            }
            if (fVal <= 0 && len >= 9) {
                fVal = safeParseInt(normalized.substring(6, 9));
            }
            if (fVal > 0) {
                force = fVal;
                _forceSum += force;
                _forceSamples += 1;
                avgForce = (_forceSum / _forceSamples).toNumber();
            }
            var haltChar = (len >= 12) ? normalized.substring(11, 12) : null;
            if (haltChar != null && haltChar.equals("!") && force == 0) {
                onRowingHalted(false);
            } else if (hasStartedRowing && force > 0) {
                onActiveRowingDetected();
            }
        }

        if (!hasStartedRowing) {
            applyIdleState();
        }
    }

    private function normalizeSmartRowField(field as String?) as String {
        if (field == null) {
            return "0";
        }
        var chars = field.toCharArray();
        for (var i = 0; i < chars.size(); i++) {
            if (chars[i] == ' ') {
                chars[i] = '0';
            }
        }
        return StringUtil.charArrayToString(chars);
    }

    private function safeParseInt(str as String?) as Number {
        if (str == null) {
            return 0;
        }
        var chars = str.toCharArray();
        var acc = 0;
        var hasDigits = false;
        for (var i = 0; i < chars.size(); i++) {
            var c = chars[i];
            if (c >= '0' && c <= '9') {
                acc = (acc * 10) + (c.toNumber() - '0'.toNumber());
                hasDigits = true;
            } else if (c != ' ') {
                break;
            }
        }
        return hasDigits ? acc : 0;
    }

    // =========================================================================
    // 3. FORMATTING & SERIALIZATION HELPERS
    // =========================================================================
    public function getEffectiveAvgPace(sessionElapsedSec as Number) as Number {
        if (avgPace > 0 && avgPace < 3600) {
            return avgPace;
        }
        if (_paceSamples > 0) {
            return (_paceSum / _paceSamples).toNumber();
        }
        if (totalDistance > 0) {
            var activeSec = (sessionElapsedSec > 0) ? sessionElapsedSec : elapsedTime;
            if (activeSec > 0) {
                var derived = ((activeSec.toLong() * 500L) / totalDistance.toLong()).toNumber();
                if (derived > 0 && derived < 3600) {
                    return derived;
                }
            }
        }
        if (instantPace > 0 && instantPace < 3600) {
            return instantPace;
        }
        return 0;
    }

    public function formatPace(sec as Number) as String {
        if (sec <= 0 || sec >= 3600) {
            return "-:--";
        }
        var mins = sec / 60;
        var rem = sec % 60;
        return mins.format("%d") + ":" + rem.format("%02d");
    }

    public function formatTime(sec as Number) as String {
        if (sec < 0) {
            sec = 0;
        }
        var hrs = sec / 3600;
        var mins = (sec % 3600) / 60;
        var rem = sec % 60;
        if (hrs > 0) {
            return hrs.format("%d") + ":" + mins.format("%02d") + ":" + rem.format("%02d");
        }
        return mins.format("%02d") + ":" + rem.format("%02d");
    }

    public function toDictionary() as Dictionary<Object, Object> {
        return {
            "strokeRate" => strokeRate,
            "strokeCount" => strokeCount,
            "avgStrokeRate" => avgStrokeRate,
            "totalDistance" => totalDistance,
            "instantPace" => instantPace,
            "avgPace" => avgPace,
            "instantPower" => instantPower,
            "avgPower" => avgPower,
            "resistanceLevel" => resistanceLevel,
            "totalEnergy" => totalEnergy,
            "energyPerHour" => energyPerHour,
            "energyPerMinute" => energyPerMinute,
            "heartRate" => heartRate,
            "metabolicEq" => metabolicEq,
            "elapsedTime" => elapsedTime,
            "remainingTime" => remainingTime,
            "rawFlags" => rawFlags
        };
    }
}
