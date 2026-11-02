import Toybox.BluetoothLowEnergy;
import Toybox.Lang;
import Toybox.System;
import Toybox.ActivityRecording;
import Toybox.Time;

class BleDelegate extends BluetoothLowEnergy.BleDelegate {

    // Bluetooth SIG standard FTMS Service UUID: 0x1826
    private static const FTMS_SERVICE_UUID = BluetoothLowEnergy.stringToUuid("00001826-0000-1000-8000-00805F9B34FB");
    // FTMS Rower Data Characteristic UUID: 0x2AD1
    private static const ROWER_DATA_CHAR_UUID = BluetoothLowEnergy.stringToUuid("00002AD1-0000-1000-8000-00805F9B34FB");

    private var _view as RowerView?;
    private var _device as BluetoothLowEnergy.Device?;
    private var _syncManager as RestSyncManager;
    private var _deviceName as String? = null;

    // Race & Session State
    private var _session as ActivityRecording.Session?;
    private var _userId as String = "";
    private var _activityId as String = "";
    private var _raceMode as String = "race"; // "race" or "solo"
    private var _activityStatus as String = "in_progress"; // "in_progress", "paused", "completed"
    private var _targetDistance as Number = 10000;
    private var _initialDistance as Number = -1; // -1 means uninitialized
    private var _netDistance as Number = 0;
    private var _progressPercent as Float = 0.0;
    private var _lastModel as RowerDataModel?;

    function initialize() {
        BleDelegate.initialize();
        _syncManager = new RestSyncManager(self);
        _userId = UserManager.getUserId();
        registerProfiles();
    }

    function setView(view as RowerView) as Void {
        _view = view;
    }

    function getSyncManager() as RestSyncManager {
        return _syncManager;
    }

    function getRaceMode() as String {
        return _raceMode;
    }

    function setRaceMode(mode as String) as Void {
        _raceMode = mode;
    }

    private function registerProfiles() as Void {
        var profile = {
            :uuid => FTMS_SERVICE_UUID,
            :characteristics => [
                {
                    :uuid => ROWER_DATA_CHAR_UUID,
                    :descriptors => [
                        BluetoothLowEnergy.cccdUuid()
                    ]
                }
            ]
        };
        BluetoothLowEnergy.registerProfile(profile);
    }

    function startScan() as Void {
        BluetoothLowEnergy.setScanState(BluetoothLowEnergy.SCAN_STATE_SCANNING);
        if (_view != null) {
            _view.setStatus("Recherche Rameur FTMS...");
        }
    }

    function stopScan() as Void {
        BluetoothLowEnergy.setScanState(BluetoothLowEnergy.SCAN_STATE_OFF);
    }

    function disconnect() as Void {
        if (_device != null) {
            BluetoothLowEnergy.unpairDevice(_device as BluetoothLowEnergy.Device);
            _device = null;
        }
    }

    function onScanResults(scanResults as BluetoothLowEnergy.Iterator) as Void {
        for (var result = scanResults.next(); result != null; result = scanResults.next()) {
            var iter = (result as BluetoothLowEnergy.ScanResult).getServiceUuids();
            for (var uuid = iter.next(); uuid != null; uuid = iter.next()) {
                if (uuid.equals(FTMS_SERVICE_UUID)) {
                    stopScan();
                    _deviceName = (result as BluetoothLowEnergy.ScanResult).getDeviceName();
                    if (_view != null) {
                        _view.setStatus("Connexion en cours...");
                    }
                    _device = BluetoothLowEnergy.pairDevice(result as BluetoothLowEnergy.ScanResult);
                    return;
                }
            }
        }
    }

    function onConnectedStateChanged(device as BluetoothLowEnergy.Device, state as BluetoothLowEnergy.ConnectionState) as Void {
        if (state == BluetoothLowEnergy.CONNECTION_STATE_CONNECTED) {
            if (_view != null) {
                _view.setStatus("Rameur Connecte !");
            }
            // Subscribe to Rower Data notifications
            var service = device.getService(FTMS_SERVICE_UUID);
            if (service != null) {
                var char = service.getCharacteristic(ROWER_DATA_CHAR_UUID);
                if (char != null) {
                    var cccd = char.getDescriptor(BluetoothLowEnergy.cccdUuid());
                    if (cccd != null) {
                        cccd.requestWrite([0x01, 0x00]b);
                    }
                }
            }

            // Fetch Next Race info from backend to initialize Lobby
            fetchLobbyRace();
        } else {
            if (_view != null) {
                _view.setStatus("Rameur Deconnecte");
            }
            startScan();
        }
    }

    function fetchLobbyRace() as Void {
        _syncManager.fetchNextRace();
    }

    function onLobbyDataReceived(data as Dictionary?) as Void {
        if (data != null && _view != null) {
            var countdown = (data.hasKey("countdownSeconds")) ? (data.get("countdownSeconds") as Number) : 600;
            var players = (data.hasKey("totalParticipants")) ? (data.get("totalParticipants") as Number) : 1;
            var dist = (data.hasKey("targetDistance")) ? (data.get("targetDistance") as Number) : 10000;
            _targetDistance = dist;
            _view.setLobbyInfo(countdown, players, dist);
            _view.setAppState(RowerView.STATE_LOBBY);
        } else if (_view != null) {
            // Default 15m lobby fallback
            _view.setLobbyInfo(900, 1, 10000);
            _view.setAppState(RowerView.STATE_LOBBY);
        }
    }

    // --- FIT Activity Recording & Race Lifecycle ---

    function startRaceSession(mode as String) as Void {
        _raceMode = mode;
        _activityStatus = "in_progress";
        _initialDistance = -1; // Will reset to first received BLE distance
        _netDistance = 0;
        _progressPercent = 0.0;
        
        // Generate unique activity ID
        var nowSec = Time.now().value();
        _activityId = "act_" + nowSec;

        // Start Garmin FIT Activity recording
        try {
            _session = ActivityRecording.createSession({
                :name => "Rower Race - " + _raceMode,
                :sport => ActivityRecording.SPORT_ROWING,
                :subSport => ActivityRecording.SUB_SPORT_INDOOR_ROWING
            });
            _session.start();
            System.println("FIT Activity Session started: " + _activityId);
        } catch (ex) {
            System.println("ActivityRecording start error: " + ex.getErrorMessage());
        }

        if (_view != null) {
            _view.setAppState(RowerView.STATE_RACING);
        }
    }

    function pauseSession() as Void {
        if (_session != null && _session.isRecording()) {
            _session.stop();
        }
        _activityStatus = "paused";
        if (_view != null) {
            _view.setAppState(RowerView.STATE_PAUSED);
        }
    }

    function resumeSession() as Void {
        if (_session != null && !_session.isRecording()) {
            _session.start();
        }
        _activityStatus = "in_progress";
        if (_view != null) {
            _view.setAppState(RowerView.STATE_RACING);
        }
    }

    function saveAndExitSession() as Void {
        if (_session != null) {
            _session.save();
            _session = null;
            System.println("FIT Activity Session saved to Garmin.");
        }
        _activityStatus = "completed";

        // Push final update to backend
        if (_lastModel != null) {
            _syncManager.syncActivity(_activityId, _userId, _userId, _raceMode,
                                      _activityStatus, _targetDistance, _lastModel as RowerDataModel,
                                      _deviceName, true);
        } else {
            if (_view != null) {
                _view.setFinishResults(1, []);
            }
        }
    }

    function discardSession() as Void {
        if (_session != null) {
            _session.discard();
            _session = null;
            System.println("FIT Activity Session discarded.");
        }
        _activityStatus = "discarded";
        if (_view != null) {
            _view.setAppState(RowerView.STATE_LOBBY);
        }
    }

    function onFinalSyncResponse(data as Dictionary?) as Void {
        var rank = 1;
        var podium = [] as Array<Dictionary>;
        if (data != null) {
            if (data.hasKey("finalRank")) {
                rank = data.get("finalRank") as Number;
            }
            if (data.hasKey("podium") && data.get("podium") instanceof Array) {
                podium = data.get("podium") as Array<Dictionary>;
            }
        }
        if (_view != null) {
            _view.setFinishResults(rank, podium);
        }
    }

    function onCharacteristicChanged(characteristic as BluetoothLowEnergy.Characteristic, value as ByteArray) as Void {
        if (characteristic.getUuid().equals(ROWER_DATA_CHAR_UUID)) {
            parseRowerData(value);
        }
    }

    // FTMS 0x2AD1 Rower Data parser
    private function parseRowerData(bytes as ByteArray) as Void {
        if (bytes.size() < 3) {
            return;
        }

        var model = new RowerDataModel();
        var flags = (bytes[0] & 0xFF) | ((bytes[1] & 0xFF) << 8);
        model.rawFlags = flags;

        // Mandatory fields: Stroke Rate (0.5 spm) & Stroke Count
        model.strokeRate = (bytes[2] & 0xFF) * 0.5;
        if (bytes.size() >= 5) {
            model.strokeCount = (bytes[3] & 0xFF) | ((bytes[4] & 0xFF) << 8);
        }

        var offset = 5;

        // Bit 1: Average Stroke Rate Present
        if ((flags & (1 << 1)) != 0 && (offset + 1) <= bytes.size()) {
            model.avgStrokeRate = (bytes[offset] & 0xFF) * 0.5;
            offset += 1;
        }

        // Bit 2: Total Distance Present
        if ((flags & (1 << 2)) != 0 && (offset + 3) <= bytes.size()) {
            model.totalDistance = (bytes[offset] & 0xFF) |
                                  ((bytes[offset + 1] & 0xFF) << 8) |
                                  ((bytes[offset + 2] & 0xFF) << 16);
            offset += 3;
        }

        // Bit 3: Instantaneous Pace Present
        if ((flags & (1 << 3)) != 0 && (offset + 2) <= bytes.size()) {
            model.instantPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        // Bit 4: Average Pace Present
        if ((flags & (1 << 4)) != 0 && (offset + 2) <= bytes.size()) {
            model.avgPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        // Bit 5: Instantaneous Power Present
        if ((flags & (1 << 5)) != 0 && (offset + 2) <= bytes.size()) {
            var rawPow = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawPow > 32767) {
                rawPow -= 65536;
            }
            model.instantPower = rawPow;
            offset += 2;
        }

        // Bit 6: Average Power Present
        if ((flags & (1 << 6)) != 0 && (offset + 2) <= bytes.size()) {
            var rawAvgPow = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawAvgPow > 32767) {
                rawAvgPow -= 65536;
            }
            model.avgPower = rawAvgPow;
            offset += 2;
        }

        // Bit 7: Resistance Level
        if ((flags & (1 << 7)) != 0 && (offset + 2) <= bytes.size()) {
            var rawRes = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawRes > 32767) {
                rawRes -= 65536;
            }
            model.resistanceLevel = rawRes;
            offset += 2;
        }

        // Bit 8: Total Energy / kcal
        if ((flags & (1 << 8)) != 0 && (offset + 5) <= bytes.size()) {
            model.totalEnergy = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            model.energyPerHour = (bytes[offset + 2] & 0xFF) | ((bytes[offset + 3] & 0xFF) << 8);
            model.energyPerMinute = (bytes[offset + 4] & 0xFF);
            offset += 5;
        }

        // Bit 9: Heart Rate
        if ((flags & (1 << 9)) != 0 && (offset + 1) <= bytes.size()) {
            model.heartRate = (bytes[offset] & 0xFF);
            offset += 1;
        }

        // Bit 10: Metabolic Equivalent
        if ((flags & (1 << 10)) != 0 && (offset + 1) <= bytes.size()) {
            model.metabolicEq = (bytes[offset] & 0xFF) * 0.1;
            offset += 1;
        }

        // Bit 11: Elapsed Time
        if ((flags & (1 << 11)) != 0 && (offset + 2) <= bytes.size()) {
            model.elapsedTime = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        // Bit 12: Remaining Time
        if ((flags & (1 << 12)) != 0 && (offset + 2) <= bytes.size()) {
            model.remainingTime = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        _lastModel = model;

        // Calculate Net Distance = currentDistance - initialDistance
        if (_initialDistance < 0) {
            _initialDistance = model.totalDistance;
        }
        _netDistance = model.totalDistance - _initialDistance;
        if (_netDistance < 0) {
            _netDistance = 0;
        }

        if (_targetDistance > 0) {
            _progressPercent = (_netDistance * 1.0) / _targetDistance;
            if (_progressPercent > 1.0) {
                _progressPercent = 1.0;
            }
        }

        // Check race completion
        if (_activityStatus.equals("in_progress") && _view != null && _view.getAppState() == RowerView.STATE_RACING) {
            if (_netDistance >= _targetDistance) {
                saveAndExitSession();
                return;
            }
        }

        // Update the Watch UI
        if (_view != null) {
            _view.updateRowerData(model, _netDistance, _progressPercent);
        }

        // Transmit stroke data to Render Backend API (only if session active)
        if (_activityStatus.equals("in_progress") && _activityId.length() > 0) {
            _syncManager.syncActivity(_activityId, _userId, _userId, _raceMode,
                                      _activityStatus, _targetDistance, model,
                                      _deviceName, false);
        }
    }
}
