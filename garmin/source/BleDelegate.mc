import Toybox.Activity;
import Toybox.Attention;
import Toybox.BluetoothLowEnergy;
import Toybox.Lang;
import Toybox.StringUtil;
import Toybox.System;
import Toybox.ActivityRecording;
import Toybox.Time;
import Toybox.WatchUi;

class BleDelegate extends BluetoothLowEnergy.BleDelegate {

    // Standard Bluetooth SIG FTMS Service & Characteristics (0x1826, 0x2AD1, 0x2AD9)
    // Covers Concept2 PM5, WaterRower ComModule/S4, Merach, VOWVIT, Domyos, Skillrow, EXR, RP3, etc.
    public static const FTMS_SERVICE_UUID       = BluetoothLowEnergy.stringToUuid("00001826-0000-1000-8000-00805F9B34FB");
    public static const FTMS_ROWER_DATA_UUID    = BluetoothLowEnergy.stringToUuid("00002AD1-0000-1000-8000-00805F9B34FB");
    public static const FTMS_CONTROL_POINT_UUID = BluetoothLowEnergy.stringToUuid("00002AD9-0000-1000-8000-00805F9B34FB");

    // WaterRower SmartRow Direct Pulley Service & Characteristics (0x1234, 0x1235 Write, 0x1236 Notify)
    public static const SMARTROW_SERVICE_UUID   = BluetoothLowEnergy.stringToUuid("00001234-0000-1000-8000-00805F9B34FB");
    public static const SMARTROW_WRITE_UUID     = BluetoothLowEnergy.stringToUuid("00001235-0000-1000-8000-00805F9B34FB");
    public static const SMARTROW_DATA_UUID      = BluetoothLowEnergy.stringToUuid("00001236-0000-1000-8000-00805F9B34FB");

    private const _ftmsProfileDef = {
        :uuid => FTMS_SERVICE_UUID,
        :characteristics => [{
            :uuid => FTMS_ROWER_DATA_UUID,
            :descriptors => [BluetoothLowEnergy.cccdUuid()]
        }, {
            :uuid => FTMS_CONTROL_POINT_UUID
        }]
    };

    private const _smartRowProfileDef = {
        :uuid => SMARTROW_SERVICE_UUID,
        :characteristics => [{
            :uuid => SMARTROW_DATA_UUID,
            :descriptors => [BluetoothLowEnergy.cccdUuid()]
        }, {
            :uuid => SMARTROW_WRITE_UUID
        }]
    };

    private static var _profilesRegistered as Boolean = false;

    private var _model as RowerDataModel;
    private var _view as RowerView?;
    private var _syncManager as RestSyncManager;

    // BLE GATT & SmartRow Direct state (ported from rower.iq)
    private var _device as BluetoothLowEnergy.Device?;
    private var _srWriteChar as BluetoothLowEnergy.Characteristic?;
    private var _ftmsCtrlChar as BluetoothLowEnergy.Characteristic?;
    private var _activeDataChar as BluetoothLowEnergy.Characteristic?;
    private var _isManualDisconnect as Boolean = false;
    private var _lastPairedName as String? = null;
    private var _bleWriteBusy as Boolean = false;
    private var _bleBusyTicks as Number = 0;
    private var _cccdSubscribed as Boolean = false;
    private var _secondsWithoutData as Number = 0;
    private var _stateWatchdogTicks as Number = 0;
    private var _pendingProfiles as Number = 0;
    private var _profileWaitTicks as Number = 0;
    private var _noCharTicks as Number = 0;

    // SmartRow V3 handshake & TX packet queue
    private var _srPacketQueue as Array<ByteArray> = [] as Array<ByteArray>;
    private var _srHandshakeState as Number = 0; // 0=uninit, 1=init sent, 2=challenge requested, 3=unlocked
    private var _srChallengeRequested as Boolean = false;
    private var _srRxBuffer as String = "";
    private var _srV3LockTicks as Number = 0;

    // Race & FIT Session State
    private var _session as ActivityRecording.Session?;
    private var _userId as String = "";
    private var _activityId as String = "";
    private var _raceMode as String = "race"; // "race" or "solo"
    private var _activityStatus as String = "waiting"; // "waiting", "in_progress", "paused", "completed", "abandoned"
    private var _targetDistance as Number = 10000;
    private var _progressPercent as Float = 0.0f;
    private var _lastSentStrokeCount as Number = 0;
    private var _pendingStrokeSync as Boolean = false;
    private var _lastFallbackSendSec as Number = 0;
    private var _tickCounter as Number = 0;
    private var _lastVibeSecond as Number = -1;

    public function initialize(model as RowerDataModel) {
        BleDelegate.initialize();
        _model = model;
        _syncManager = new RestSyncManager(self);
        _userId = UserManager.getUserId();
    }

    public function setView(view as RowerView) as Void {
        _view = view;
    }

    public function getModel() as RowerDataModel {
        return _model;
    }

    public function getSyncManager() as RestSyncManager {
        return _syncManager;
    }

    public function getRaceMode() as String {
        return _raceMode;
    }

    // =========================================================================
    // 1. BLE PROFILE REGISTRATION, SCANNING & SMARTROW V3 HANDSHAKE (rower.iq)
    // =========================================================================

    //! Register FTMS (0x1826) and SmartRow Direct (0x1234) BLE profiles (2 profiles max)
    public function registerProfiles() as Void {
        if (_profilesRegistered) {
            if (_model.connectionState == RowerDataModel.STATE_DISCONNECTED && !_isManualDisconnect) {
                startScan();
            }
            return;
        }
        _pendingProfiles = 2;
        _profileWaitTicks = 0;
        try {
            BluetoothLowEnergy.registerProfile(_ftmsProfileDef);
        } catch (e) {
            System.println("BLE registerProfile FTMS error: " + e.getErrorMessage());
            _pendingProfiles -= 1;
        }
        try {
            BluetoothLowEnergy.registerProfile(_smartRowProfileDef);
        } catch (e) {
            System.println("BLE registerProfile SmartRow error: " + e.getErrorMessage());
            _pendingProfiles -= 1;
        }
        _profilesRegistered = true;
    }

    //! Start scanning only after GATT profiles are registered
    public function onProfileRegister(uuid as BluetoothLowEnergy.Uuid, status as BluetoothLowEnergy.Status) as Void {
        if (_pendingProfiles > 0) {
            _pendingProfiles -= 1;
        }
        if (_pendingProfiles <= 0 && _model.connectionState == RowerDataModel.STATE_DISCONNECTED && !_isManualDisconnect) {
            startScan();
        }
    }

    public function startScan() as Void {
        _isManualDisconnect = false;
        _bleWriteBusy = false;
        _bleBusyTicks = 0;
        _cccdSubscribed = false;
        _secondsWithoutData = 0;
        _stateWatchdogTicks = 0;
        if (_device != null) {
            try {
                BluetoothLowEnergy.unpairDevice(_device as BluetoothLowEnergy.Device);
            } catch (e) {
            }
            _device = null;
            _srWriteChar = null;
            _ftmsCtrlChar = null;
            _activeDataChar = null;
        }
        _model.connectionState = RowerDataModel.STATE_SCANNING;
        _model.deviceName = I18n.getText("PRE_SEARCH_SUB");
        try {
            BluetoothLowEnergy.setScanState(BluetoothLowEnergy.SCAN_STATE_SCANNING);
        } catch (e) {
            System.println("BLE startScan error: " + e.getErrorMessage());
        }
        WatchUi.requestUpdate();
    }

    public function stopScan() as Void {
        try {
            BluetoothLowEnergy.setScanState(BluetoothLowEnergy.SCAN_STATE_OFF);
        } catch (e) {
        }
    }

    public function disconnect() as Void {
        _isManualDisconnect = true;
        _lastPairedName = null;
        _bleWriteBusy = false;
        _bleBusyTicks = 0;
        _cccdSubscribed = false;
        stopScan();
        if (_device != null) {
            try {
                BluetoothLowEnergy.unpairDevice(_device as BluetoothLowEnergy.Device);
            } catch (e) {
            }
            _device = null;
            _srWriteChar = null;
            _ftmsCtrlChar = null;
            _activeDataChar = null;
        }
        _model.connectionState = RowerDataModel.STATE_DISCONNECTED;
    }

    public function onScanResults(scanResults as BluetoothLowEnergy.Iterator) as Void {
        var firstMatch = null;
        for (var res = scanResults.next(); res != null; res = scanResults.next()) {
            if (res instanceof BluetoothLowEnergy.ScanResult) {
                var sr = res as BluetoothLowEnergy.ScanResult;
                if (isMatchingRower(sr)) {
                    var name = sr.getDeviceName();
                    if (_lastPairedName != null && name != null && name.equals(_lastPairedName)) {
                        connectToScanResult(sr);
                        return;
                    }
                    if (firstMatch == null) {
                        firstMatch = sr;
                    }
                }
            }
        }
        if (firstMatch != null) {
            connectToScanResult(firstMatch as BluetoothLowEnergy.ScanResult);
        }
    }

    private function connectToScanResult(sr as BluetoothLowEnergy.ScanResult) as Void {
        stopScan();
        var name = sr.getDeviceName();
        _model.deviceName = (name != null && name.length() > 0) ? name : "BLE Rower";
        _lastPairedName = _model.deviceName;
        _model.connectionState = RowerDataModel.STATE_CONNECTING;
        _stateWatchdogTicks = 0;
        try {
            _device = BluetoothLowEnergy.pairDevice(sr);
        } catch (e) {
            System.println("BLE pairDevice error: " + e.getErrorMessage());
            startScan();
        }
        WatchUi.requestUpdate();
    }

    //! Universal BLE Rower detection (ported from rower.iq): FTMS (0x1826), SmartRow (0x1234), and 50+ brands
    public function isMatchingRower(sr as BluetoothLowEnergy.ScanResult) as Boolean {
        var uuids = sr.getServiceUuids();
        if (uuids != null) {
            for (var uuid = uuids.next(); uuid != null; uuid = uuids.next()) {
                if (uuid instanceof BluetoothLowEnergy.Uuid) {
                    var u = uuid as BluetoothLowEnergy.Uuid;
                    var uStr = u.toString().toUpper();
                    if (u.equals(FTMS_SERVICE_UUID) || u.equals(SMARTROW_SERVICE_UUID) ||
                        uStr.find("1826") != null || uStr.find("1234") != null) {
                        return true;
                    }
                }
            }
        }

        var name = sr.getDeviceName();
        if (name != null) {
            var upper = name.toUpper();
            if (upper.find("ROW") != null ||
                upper.find("ERG") != null ||
                upper.find("FTMS") != null ||
                upper.find("SMARTROW") != null ||
                upper.find("WATERROWER") != null ||
                upper.find("WATER") != null ||
                upper.find("S4") != null ||
                upper.find("PM5") != null ||
                upper.find("CONCEPT") != null ||
                upper.find("VOWVIT") != null ||
                upper.find("V-W") != null ||
                upper.find("VW3") != null ||
                upper.find("MERACH") != null ||
                upper.find("MRK") != null ||
                upper.find("MR-") != null ||
                upper.find("NOVAROW") != null ||
                upper.find("DOMYOS") != null ||
                upper.find("SKILLROW") != null ||
                upper.find("EXR") != null ||
                upper.find("FITSHOW") != null ||
                upper.find("FS-") != null ||
                upper.find("ICONSOLE") != null ||
                upper.find("KINOMAP") != null ||
                upper.find("KINO") != null ||
                upper.find("SPAX") != null ||
                upper.find("JOROTO") != null ||
                upper.find("YESOUL") != null ||
                upper.find("RP3") != null ||
                upper.find("XEBEX") != null ||
                upper.find("FDF") != null ||
                upper.find("ROGUE") != null ||
                upper.find("PIROWFLO") != null ||
                upper.find("COXSWAIN") != null ||
                upper.find("WHIPR") != null ||
                upper.find("KETTLER") != null ||
                upper.find("TUNTURI") != null ||
                upper.find("SCHWINN") != null ||
                upper.find("PROFORM") != null ||
                upper.find("NORDIC") != null ||
                upper.find("AVIRON") != null ||
                upper.find("HYDROW") != null ||
                upper.find("SKANDIKA") != null ||
                upper.find("SPORTPLUS") != null ||
                upper.find("CHRISTOPEIT") != null ||
                upper.find("FINNLO") != null ||
                upper.find("HAMMER") != null ||
                upper.find("MAXXUS") != null ||
                upper.find("TAURUS") != null ||
                upper.find("YOSUDA") != null ||
                upper.find("DRIPEX") != null ||
                upper.find("KINGSMITH") != null ||
                upper.find("MOBI") != null ||
                upper.find("TOORX") != null ||
                upper.find("INSPORTLINE") != null ||
                upper.find("HEUBOZEN") != null) {
                return true;
            }
        }
        return false;
    }

    public function onConnectedStateChanged(device as BluetoothLowEnergy.Device, state as BluetoothLowEnergy.ConnectionState) as Void {
        if (state == BluetoothLowEnergy.CONNECTION_STATE_CONNECTED) {
            stopScan();
            _device = device;
            _bleWriteBusy = false;
            _bleBusyTicks = 0;
            _cccdSubscribed = false;
            _secondsWithoutData = 0;
            _stateWatchdogTicks = 0;
            _noCharTicks = 0;
            _model.onBleConnected();
            setupConnectedDevice(device);

            // Pre-fetch next race info & user career profile
            fetchLobbyRace();
            _syncManager.fetchUserProfile(_userId);
        } else {
            _device = null;
            _srWriteChar = null;
            _ftmsCtrlChar = null;
            _activeDataChar = null;
            _bleWriteBusy = false;
            _bleBusyTicks = 0;
            _cccdSubscribed = false;
            _srPacketQueue = [] as Array<ByteArray>;
            _srHandshakeState = 0;
            _srChallengeRequested = false;
            _srRxBuffer = "";
            _srV3LockTicks = 0;
            _model.connectionState = RowerDataModel.STATE_DISCONNECTED;
            if (!_isManualDisconnect) {
                startScan();
            }
        }
        WatchUi.requestUpdate();
    }

    private function setupConnectedDevice(device as BluetoothLowEnergy.Device) as Void {
        var ftmsService = device.getService(FTMS_SERVICE_UUID);
        var srService = device.getService(SMARTROW_SERVICE_UUID);

        if (ftmsService == null || srService == null) {
            try {
                var services = device.getServices();
                if (services != null) {
                    for (var s = services.next(); s != null; s = services.next()) {
                        if (s instanceof BluetoothLowEnergy.Service) {
                            var srv = s as BluetoothLowEnergy.Service;
                            var u = srv.getUuid();
                            if (u != null) {
                                var uStr = u.toString().toUpper();
                                if (u.equals(FTMS_SERVICE_UUID) || uStr.find("1826") != null) {
                                    ftmsService = srv;
                                } else if (u.equals(SMARTROW_SERVICE_UUID) || uStr.find("1234") != null) {
                                    srService = srv;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                System.println("BLE getServices iterate error: " + e.getErrorMessage());
            }
        }

        // 1. Process FTMS Service (0x1826)
        if (ftmsService != null) {
            _model.connectionState = RowerDataModel.STATE_CONNECTED_FTMS;
            var dataChar = ftmsService.getCharacteristic(FTMS_ROWER_DATA_UUID);
            if (dataChar == null) {
                try {
                    var chars = ftmsService.getCharacteristics();
                    if (chars != null) {
                        for (var c = chars.next(); c != null; c = chars.next()) {
                            if (c instanceof BluetoothLowEnergy.Characteristic) {
                                var ch = c as BluetoothLowEnergy.Characteristic;
                                var cu = ch.getUuid();
                                if (cu != null && (cu.equals(FTMS_ROWER_DATA_UUID) || cu.toString().toUpper().find("2AD1") != null)) {
                                    dataChar = ch;
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) {
                }
            }
            _activeDataChar = dataChar;
            _ftmsCtrlChar = ftmsService.getCharacteristic(FTMS_CONTROL_POINT_UUID);
            if (_activeDataChar != null) {
                enableDataNotifications();
            }
            return;
        }

        // 2. Process WaterRower SmartRow Direct Pulley Service (0x1234)
        if (srService != null) {
            _model.connectionState = RowerDataModel.STATE_CONNECTED_SMARTROW;
            _srWriteChar = srService.getCharacteristic(SMARTROW_WRITE_UUID);
            var srData = srService.getCharacteristic(SMARTROW_DATA_UUID);
            if (srData == null || _srWriteChar == null) {
                try {
                    var chars2 = srService.getCharacteristics();
                    if (chars2 != null) {
                        for (var c2 = chars2.next(); c2 != null; c2 = chars2.next()) {
                            if (c2 instanceof BluetoothLowEnergy.Characteristic) {
                                var ch2 = c2 as BluetoothLowEnergy.Characteristic;
                                var cu2 = ch2.getUuid();
                                if (cu2 != null) {
                                    var cuStr = cu2.toString().toUpper();
                                    if (cu2.equals(SMARTROW_DATA_UUID) || cuStr.find("1236") != null) {
                                        srData = ch2;
                                    } else if (cu2.equals(SMARTROW_WRITE_UUID) || cuStr.find("1235") != null) {
                                        _srWriteChar = ch2;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                }
            }
            _activeDataChar = srData;
            if (_activeDataChar != null) {
                enableDataNotifications();
            }
            return;
        }
    }

    private function enableDataNotifications() as Void {
        if (_activeDataChar == null || _bleWriteBusy) {
            return;
        }
        var cccd = (_activeDataChar as BluetoothLowEnergy.Characteristic).getDescriptor(BluetoothLowEnergy.cccdUuid());
        if (cccd == null) {
            try {
                var descs = (_activeDataChar as BluetoothLowEnergy.Characteristic).getDescriptors();
                if (descs != null) {
                    for (var d = descs.next(); d != null; d = descs.next()) {
                        if (d instanceof BluetoothLowEnergy.Descriptor) {
                            var desc = d as BluetoothLowEnergy.Descriptor;
                            var du = desc.getUuid();
                            if (du != null && (du.equals(BluetoothLowEnergy.cccdUuid()) || du.toString().toUpper().find("2902") != null)) {
                                cccd = desc;
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
            }
        }
        if (cccd != null) {
            try {
                _bleWriteBusy = true;
                _bleBusyTicks = 0;
                cccd.requestWrite([0x01, 0x00]b);
            } catch (e) {
                _bleWriteBusy = false;
                System.println("CCCD write error: " + e.getErrorMessage());
            }
        }
    }

    public function onDescriptorWrite(descriptor as BluetoothLowEnergy.Descriptor, status as BluetoothLowEnergy.Status) as Void {
        _bleWriteBusy = false;
        _bleBusyTicks = 0;
        if (status == BluetoothLowEnergy.STATUS_SUCCESS) {
            _cccdSubscribed = true;
            // Send initial SmartRow wake/init sequence once notifications are enabled (ported from rower.iq)
            if (_model.connectionState == RowerDataModel.STATE_CONNECTED_SMARTROW) {
                initSmartRowDirect();
            }
        } else {
            _cccdSubscribed = false;
        }
    }

    public function onCharacteristicWrite(char as BluetoothLowEnergy.Characteristic, status as BluetoothLowEnergy.Status) as Void {
        _bleWriteBusy = false;
        _bleBusyTicks = 0;
        if (_srPacketQueue.size() > 0) {
            var nextPacket = _srPacketQueue[0];
            _srPacketQueue = _srPacketQueue.slice(1, null) as Array<ByteArray>;
            executeSmartRowWrite(nextPacket);
        }
    }

    private function initSmartRowDirect() as Void {
        _srHandshakeState = 1;
        _srChallengeRequested = false;
        _srRxBuffer = "";
        _srV3LockTicks = 0;
        _srPacketQueue = [] as Array<ByteArray>;
        // Send SmartRow INIT_COMMAND "$\rV@\r" as a single atomic BLE write (ported from rower.iq)
        sendSmartRowPacket([0x24, 0x0D, 0x56, 0x40, 0x0D]b);
    }

    private function sendSmartRowPacket(bytes as ByteArray) as Void {
        if (_srWriteChar == null) {
            return;
        }
        if (_bleWriteBusy) {
            _srPacketQueue.add(bytes);
            return;
        }
        executeSmartRowWrite(bytes);
    }

    private function executeSmartRowWrite(bytes as ByteArray) as Void {
        if (_srWriteChar == null) {
            return;
        }
        try {
            _bleWriteBusy = true;
            _bleBusyTicks = 0;
            (_srWriteChar as BluetoothLowEnergy.Characteristic).requestWrite(bytes, {:writeType => BluetoothLowEnergy.WRITE_TYPE_DEFAULT});
        } catch (e) {
            _bleWriteBusy = false;
            System.println("SR write err: " + e.getErrorMessage());
        }
    }

    private function sendSmartRowWakePing() as Void {
        sendSmartRowPacket([0x24]b); // '$' single byte poll keep-alive (rower.iq)
    }

    public function resetRowerHardware() as Void {
        if (_model.connectionState == RowerDataModel.STATE_CONNECTED_SMARTROW && _srWriteChar != null) {
            _bleWriteBusy = false;
            sendSmartRowPacket([0x0D, 0x56, 0x40, 0x0D]b);
        } else if (_model.connectionState == RowerDataModel.STATE_CONNECTED_FTMS && _ftmsCtrlChar != null && !_bleWriteBusy) {
            try {
                _bleWriteBusy = true;
                _bleBusyTicks = 0;
                (_ftmsCtrlChar as BluetoothLowEnergy.Characteristic).requestWrite([0x01]b, {:writeType => BluetoothLowEnergy.WRITE_TYPE_DEFAULT});
            } catch (e) {
                _bleWriteBusy = false;
            }
        }
    }

    public function onCharacteristicChanged(char as BluetoothLowEnergy.Characteristic, value as ByteArray) as Void {
        _secondsWithoutData = 0;
        _cccdSubscribed = true;
        var uuid = char.getUuid();
        try {
            var uuidStr = (uuid != null) ? uuid.toString().toUpper() : "";
            if ((uuid != null && uuid.equals(FTMS_ROWER_DATA_UUID)) || uuidStr.find("2AD1") != null) {
                _model.parseFtmsRowerData(value);
                onModelUpdated();
            } else if ((uuid != null && uuid.equals(SMARTROW_DATA_UUID)) || uuidStr.find("1236") != null) {
                handleSmartRowNotification(value);
            }
        } catch (e) {
            System.println("BLE packet parse error: " + e.getErrorMessage());
        }
    }

    //! Detect whether a SmartRow telemetry frame still has V3-obfuscated distance bytes (0x40..0x49 '@'-'I')
    public static function isSmartRowV3LockedFrame(bytes as ByteArray) as Boolean {
        var size = bytes.size();
        if (size < 6) {
            return false;
        }
        var i = 0;
        while (i <= size - 6) {
            var b0 = bytes[i];
            var isRec = (b0 == 0x61 || b0 == 0x62 || b0 == 0x63 || b0 == 0x64 ||
                         b0 == 0x65 || b0 == 0x66 || b0 == 0x78 || b0 == 0x79 || b0 == 0x7A);
            if (isRec && (i == 0 || bytes[i - 1] == 0x0D || bytes[i - 1] == 0x0A)) {
                for (var k = 1; k <= 5; k++) {
                    var dk = bytes[i + k];
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

    //! Validate SmartRow V3 KEYLOCK=XXXXXXXX challenge checksum and compute \r<4 hex>\r unlock packet
    public static function computeSmartRowKeylockResponse(challenge as String) as ByteArray? {
        if (challenge.length() < 16) {
            return null;
        }
        var sub14 = challenge.substring(0, 14);
        var checksumStr = challenge.substring(14, 16);
        if (sub14 == null || checksumStr == null) {
            return null;
        }
        var keyChars = sub14.toCharArray();
        var sum = 0;
        for (var i = 0; i < keyChars.size(); i++) {
            sum += keyChars[i].toNumber();
        }
        var expectedChecksum = sum & 0xFF;
        var actualChecksum = parseHex(checksumStr);
        if (actualChecksum != expectedChecksum) {
            return null;
        }

        var seedStr = challenge.substring(10, 14);
        var seed = (seedStr != null) ? parseHex(seedStr) : -1;
        if (seed < 0) {
            return null;
        }

        // V3 challenge response: ((seed * 17923) / 256) & 0xFFFF
        var respVal = (((seed.toLong() * 17923L) / 256L).toNumber()) & 0xFFFF;
        var r = new [4] as Array<Number>;
        for (var j = 3; j >= 0; j--) {
            var nib = respVal & 0x0F;
            r[j] = (nib < 10) ? (48 + nib) : (87 + nib);
            respVal = respVal >> 4;
        }
        return [0x0D, r[0], r[1], r[2], r[3], 0x0D]b;
    }

    public static function parseHex(str as String) as Number {
        var chars = str.toUpper().toCharArray();
        var val = 0;
        for (var i = 0; i < chars.size(); i++) {
            var c = chars[i].toNumber();
            var d = (c >= 48 && c <= 57) ? (c - 48) : ((c >= 65 && c <= 70) ? (c - 55) : -1);
            if (d < 0) {
                return -1;
            }
            val = (val << 4) | d;
        }
        return val;
    }

    private function handleSmartRowNotification(value as ByteArray) as Void {
        var size = value.size();
        if (size <= 0) {
            return;
        }

        // Convert incoming value to ASCII string to inspect for version / KEYLOCK handshake (ported from rower.iq)
        var chars = new [size] as Array<Char>;
        var charLen = 0;
        for (var i = 0; i < size; i++) {
            var b = value[i];
            if (b >= 0x20 && b <= 0x7E) {
                chars[charLen] = b.toChar();
                charLen++;
            }
        }
        var msgStr = (charLen > 0) ? StringUtil.charArrayToString(chars.slice(0, charLen) as Array<Char>) : "";

        // 1. Version reply from pulley: e.g. "SmartRow 'V3.10'" -> request KEYLOCK challenge '#'
        if (msgStr.find("V3") != null && !_srChallengeRequested) {
            _srChallengeRequested = true;
            _srHandshakeState = 2;
            sendSmartRowPacket([0x23]b); // '#' = CHALLENGE_REQUEST
            return;
        }

        // 2. V3 KEYLOCK challenge: e.g. "KEYLOCK=C2D70BB1"
        var keylockIdx = msgStr.find("KEYLOCK=");
        if (keylockIdx != null) {
            var challenge = msgStr.substring(keylockIdx, msgStr.length());
            handleSmartRowKeylock(challenge);
            return;
        }

        // 3. Regular rowing telemetry packet (a..f, x..z)
        _srHandshakeState = 3; // Fully unlocked
        _model.parseSmartRowBytes(value);
        onModelUpdated();
    }

    private function handleSmartRowKeylock(challenge as String) as Void {
        var unlockPacket = computeSmartRowKeylockResponse(challenge);
        if (unlockPacket == null) {
            sendSmartRowPacket([0x23]b); // '#' = retry challenge
            return;
        }
        _srHandshakeState = 3;
        _srV3LockTicks = 0;
        sendSmartRowPacket(unlockPacket as ByteArray);
    }

    //! 1Hz BLE health & SmartRow keep-alive watchdog (ported from rower.iq)
    private function onBleWatchdogTick() as Void {
        if (_bleWriteBusy) {
            _bleBusyTicks += 1;
            if (_bleBusyTicks >= 2) {
                _bleWriteBusy = false;
                _bleBusyTicks = 0;
                if (_srPacketQueue.size() > 0) {
                    var nextPacket = _srPacketQueue[0];
                    _srPacketQueue = _srPacketQueue.slice(1, null) as Array<ByteArray>;
                    executeSmartRowWrite(nextPacket);
                }
            }
        }

        if (_pendingProfiles > 0) {
            _profileWaitTicks += 1;
            if (_profileWaitTicks >= 4) {
                _pendingProfiles = 0;
            }
        }
        if (_pendingProfiles <= 0 && _profilesRegistered && _device == null && !_isManualDisconnect &&
            _model.connectionState == RowerDataModel.STATE_DISCONNECTED) {
            startScan();
            return;
        }

        if (_device != null && _activeDataChar == null) {
            setupConnectedDevice(_device as BluetoothLowEnergy.Device);
            _noCharTicks += 1;
            if (_noCharTicks >= 12) {
                _noCharTicks = 0;
                startScan();
                return;
            }
        }

        if (_model.connectionState == RowerDataModel.STATE_CONNECTING) {
            _stateWatchdogTicks += 1;
            if (_device != null) {
                setupConnectedDevice(_device as BluetoothLowEnergy.Device);
            }
            if (_stateWatchdogTicks >= 15) {
                startScan();
            }
            return;
        } else if (_model.connectionState == RowerDataModel.STATE_SCANNING) {
            _stateWatchdogTicks += 1;
            if (_stateWatchdogTicks >= 20) {
                _stateWatchdogTicks = 0;
                stopScan();
                try {
                    BluetoothLowEnergy.setScanState(BluetoothLowEnergy.SCAN_STATE_SCANNING);
                } catch (e) {
                }
            }
            return;
        }

        if (_model.isConnected()) {
            _secondsWithoutData += 1;

            if ((_activeDataChar == null || (_model.connectionState == RowerDataModel.STATE_CONNECTED_SMARTROW && _srWriteChar == null)) && _device != null) {
                setupConnectedDevice(_device as BluetoothLowEnergy.Device);
            }

            if (!_cccdSubscribed && _activeDataChar != null && !_bleWriteBusy) {
                enableDataNotifications();
            }

            if (_model.connectionState == RowerDataModel.STATE_CONNECTED_SMARTROW) {
                if (_srHandshakeState < 3) {
                    if (_secondsWithoutData >= 2 && (_secondsWithoutData % 2 == 0) && _srPacketQueue.size() == 0 && !_bleWriteBusy) {
                        initSmartRowDirect();
                    }
                } else {
                    if (_secondsWithoutData >= 2 && (_secondsWithoutData % 2 == 0) && _srPacketQueue.size() == 0 && !_bleWriteBusy) {
                        sendSmartRowWakePing();
                    }
                }
            }

            if (_cccdSubscribed && _secondsWithoutData == 4 && !_bleWriteBusy && _model.hasStartedRowing) {
                enableDataNotifications();
            }
        }
    }

    // =========================================================================
    // 2. UNIFIED 1HZ TICK, RACE ORCHESTRATION & TELEMETRY SYNC
    // =========================================================================

    public function onOneSecondTick() as Void {
        _tickCounter += 1;
        _model.onOneSecondTick();
        onBleWatchdogTick();

        if (_view == null) {
            return;
        }
        var view = _view as RowerView;
        var state = view.getAppState();

        // Update race progress if dead-reckoning advanced distance
        if (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN) {
            if (!updateProgressAndCheckFinish()) {
                if (_activityStatus.equals("in_progress") && _raceMode.equals("race") && _activityId.length() > 0) {
                    var secSinceSend = _tickCounter - _lastFallbackSendSec;
                    if (_pendingStrokeSync || (secSinceSend >= 2 && (_model.totalDistance > 0 || _model.instantPower > 0))) {
                        _pendingStrokeSync = false;
                        _lastFallbackSendSec = _tickCounter;
                        _syncManager.syncActivity(
                            _activityId, _userId, _userId, _raceMode,
                            _activityStatus, _targetDistance, _model,
                            _model.deviceName, false
                        );
                    }
                }
            }
        }

        // Countdown & synchronous 5s start management
        if (state == RowerView.STATE_LOBBY || state == RowerView.STATE_WAITING_START || state == RowerView.STATE_COUNTDOWN_5S) {
            view.decrementCountdown();
            var cd = view.getCountdown();

            if (_tickCounter % 3 == 0) {
                _syncManager.fetchNextRace();
            }

            if (state == RowerView.STATE_WAITING_START && cd <= 5 && cd > 0) {
                view.set5sCountdown(cd);
                view.setAppState(RowerView.STATE_COUNTDOWN_5S);
                vibrateSingleTick(false);
            } else if (state == RowerView.STATE_COUNTDOWN_5S) {
                if (cd > 0) {
                    view.set5sCountdown(cd);
                    vibrateSingleTick(false);
                } else {
                    vibrateSingleTick(true);
                    launchRaceFromWaiting();
                }
            } else if ((state == RowerView.STATE_WAITING_START || state == RowerView.STATE_LOBBY) && cd <= 0) {
                vibrateSingleTick(true);
                launchRaceFromWaiting();
            }
        }

        // Poll pending web login authorization every 3s (active in all states, including during a race)
        if (_tickCounter % 3 == 0) {
            _syncManager.checkPendingLogin(_userId);
        }

        // Poll host approval status every 2s while in STATE_PENDING_APPROVAL
        if (state == RowerView.STATE_PENDING_APPROVAL) {
            if (_tickCounter % 2 == 0 && _activityId.length() > 0) {
                _syncManager.checkApprovalStatus(_activityId, _userId);
            }
        }

        WatchUi.requestUpdate();
    }

    private function triggerApprovalVibe() as Void {
        try {
            if (Attention has :vibrate) {
                Attention.vibrate([
                    new Attention.VibeProfile(80, 200),
                    new Attention.VibeProfile(0, 100),
                    new Attention.VibeProfile(100, 350)
                ]);
            }
        } catch (e) {
        }
    }

    private function triggerRejectVibe() as Void {
        try {
            if (Attention has :vibrate) {
                Attention.vibrate([
                    new Attention.VibeProfile(100, 400)
                ]);
            }
        } catch (e) {
        }
    }

    private function vibrateSingleTick(isGo as Boolean) as Void {
        var nowSec = System.getTimer() / 1000;
        if (nowSec == _lastVibeSecond) {
            return;
        }
        _lastVibeSecond = nowSec;
        if (isGo) {
            vibrateGo();
        } else {
            vibrateShort();
        }
    }

    private function vibrateShort() as Void {
        try {
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(65, 140)]);
            }
        } catch (e) {
        }
    }

    private function vibrateGo() as Void {
        try {
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(100, 450)]);
            }
        } catch (e) {
        }
    }

    public function vibrateVictory() as Void {
        try {
            if (Attention has :vibrate) {
                Attention.vibrate([
                    new Attention.VibeProfile(100, 250),
                    new Attention.VibeProfile(0, 100),
                    new Attention.VibeProfile(100, 350),
                    new Attention.VibeProfile(0, 100),
                    new Attention.VibeProfile(100, 600)
                ]);
            }
        } catch (e) {
        }
    }

    private function onModelUpdated() as Void {
        if (_view == null) {
            return;
        }
        var view = _view as RowerView;
        var state = view.getAppState();

        // 1. If race is already running or countdown reached 0, transition immediately to racing
        if ((_activityStatus.equals("in_progress") || view.getCountdown() <= 0) &&
            (state == RowerView.STATE_WAITING_START || state == RowerView.STATE_COUNTDOWN_5S || state == RowerView.STATE_LOBBY)) {
            view.setFalseStartLocked(false);
            launchRaceFromWaiting();
            state = view.getAppState();
        }

        // 2. Pre-start: tare distance to zero and do not accumulate race distance before green light
        if (state == RowerView.STATE_WAITING_START || state == RowerView.STATE_COUNTDOWN_5S || state == RowerView.STATE_LOBBY) {
            view.setFalseStartLocked(false);
            _model.reTareToZero();
            WatchUi.requestUpdate();
            return;
        }

        // 3. Active race progress, UI refresh & stroke-by-stroke HTTP telemetry
        if (_activityStatus.equals("in_progress") && (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN)) {
            if (updateProgressAndCheckFinish()) {
                return;
            }

            if (_raceMode.equals("race") && _activityId.length() > 0) {
                if (_model.strokeCount > _lastSentStrokeCount) {
                    _lastSentStrokeCount = _model.strokeCount;
                    _pendingStrokeSync = true;
                }
                var shouldSend = false;
                if (_pendingStrokeSync) {
                    shouldSend = true;
                    _pendingStrokeSync = false;
                    _lastFallbackSendSec = _tickCounter;
                } else if ((_model.instantPower > 0 || _model.totalDistance > 0) && (_tickCounter - _lastFallbackSendSec >= 2)) {
                    shouldSend = true;
                    _lastFallbackSendSec = _tickCounter;
                }

                if (shouldSend) {
                    _syncManager.syncActivity(
                        _activityId, _userId, _userId, _raceMode,
                        _activityStatus, _targetDistance, _model,
                        _model.deviceName, false
                    );
                }
            }
        }

        WatchUi.requestUpdate();
    }

    private function updateProgressAndCheckFinish() as Boolean {
        if (_view == null) {
            return false;
        }
        var view = _view as RowerView;
        var netDist = _model.totalDistance;
        if (_targetDistance > 0) {
            _progressPercent = netDist.toFloat() / _targetDistance.toFloat();
            if (_progressPercent > 1.0f) {
                _progressPercent = 1.0f;
            }
        } else {
            _progressPercent = 0.0f;
        }

        view.updateRowerData(_model, netDist, _progressPercent);

        if (_activityStatus.equals("in_progress") && _targetDistance > 0 && netDist >= _targetDistance) {
            vibrateVictory();
            saveAndExitSession();
            return true;
        }
        return false;
    }

    // =========================================================================
    // 3. LOBBY, SOLO, PRIVATE PIN, BOTS & AUTH HANDLERS
    // =========================================================================

    public function isInPrivateRace() as Boolean {
        return (_activityId != null && _activityId.find("PRIV_") != null);
    }

    public function getActivityId() as String {
        return _activityId;
    }

    public function fetchLobbyRace() as Void {
        _syncManager.fetchNextRace();
    }

    public function onLobbyDataReceived(data as Dictionary?) as Void {
        if (data != null && _view != null) {
            var countdown = (data.hasKey("secondsRemaining") && data.get("secondsRemaining") != null)
                ? (data.get("secondsRemaining") as Number) : 600;
            var players = (data.hasKey("totalParticipants") && data.get("totalParticipants") != null)
                ? (data.get("totalParticipants") as Number) : 1;
            var targetDist = _targetDistance;
            var isRunning = false;

            if (data.hasKey("status") && data.get("status") != null) {
                var st = data.get("status").toString();
                if (st.equals("in_progress") || st.equals("RUNNING")) {
                    isRunning = true;
                }
            }

            if (data.hasKey("race") && data.get("race") instanceof Dictionary) {
                var rDict = data.get("race") as Dictionary;
                if (rDict.hasKey("targetDistance") && rDict.get("targetDistance") != null) {
                    targetDist = rDict.get("targetDistance") as Number;
                }
                if (rDict.hasKey("id") && rDict.get("id") != null) {
                    _activityId = rDict.get("id").toString();
                }
                if (rDict.hasKey("hasBots") && rDict.get("hasBots") instanceof Boolean) {
                    (_view as RowerView).setBotsEnabled(rDict.get("hasBots") as Boolean);
                }
                if (rDict.hasKey("status") && rDict.get("status") != null) {
                    var rSt = rDict.get("status").toString();
                    if (rSt.equals("in_progress") || rSt.equals("RUNNING")) {
                        isRunning = true;
                    }
                }
            }
            if (data.hasKey("isRaceInProgress") && data.get("isRaceInProgress") == true) {
                isRunning = true;
            }

            if (data.hasKey("remainingSeconds") && data.get("remainingSeconds") != null) {
                (_view as RowerView).setGameRemainingSeconds(data.get("remainingSeconds") as Number);
            }

            _targetDistance = targetDist;
            (_view as RowerView).setLobbyInfo(countdown, players, targetDist);

            var view = _view as RowerView;
            var curState = view.getAppState();
            if ((isRunning || countdown <= 0) && (curState == RowerView.STATE_LOBBY || curState == RowerView.STATE_WAITING_START || curState == RowerView.STATE_PENDING_APPROVAL)) {
                vibrateGo();
                launchRaceFromWaiting();
            }
        }
    }

    public function joinNextRaceWaiting() as Void {
        _raceMode = "race";
        _activityStatus = "waiting";
        if (_view != null) {
            (_view as RowerView).setIsLateJoiner(false);
            (_view as RowerView).setAppState(RowerView.STATE_WAITING_START);
        }
        _syncManager.joinRace(_userId, _userId, "join");
        _syncManager.fetchUserProfile(_userId);
    }

    public function onJoinRaceReceived(data as Dictionary?) as Void {
        if (data != null && _view != null) {
            var view = _view as RowerView;
            if (data.hasKey("raceId") && data.get("raceId") != null) {
                _activityId = data.get("raceId").toString();
            }
            if (data.hasKey("race") && data.get("race") instanceof Dictionary) {
                var rDict = data.get("race") as Dictionary;
                if (rDict.hasKey("targetDistance") && rDict.get("targetDistance") != null) {
                    _targetDistance = rDict.get("targetDistance") as Number;
                }
            }
            if (data.hasKey("secondsRemaining") && data.get("secondsRemaining") != null) {
                var sec = data.get("secondsRemaining") as Number;
                var total = (data.hasKey("totalParticipants") && data.get("totalParticipants") != null)
                    ? (data.get("totalParticipants") as Number) : 1;
                view.setLobbyInfo(sec, total, _targetDistance);
            }

            if (data.hasKey("isRaceInProgress") && data.get("isRaceInProgress") == true) {
                var total2 = (data.hasKey("totalParticipants") && data.get("totalParticipants") != null)
                    ? (data.get("totalParticipants") as Number) : 0;
                if (total2 > 0 && _activityStatus.equals("waiting")) {
                    view.setAppState(RowerView.STATE_LATE_CHOICE);
                }
            }
        }
    }

    public function joinRaceLate() as Void {
        _raceMode = "race";
        if (_view != null) {
            (_view as RowerView).setIsLateJoiner(true);
        }
        _syncManager.joinRace(_userId, _userId, "join_late");
        launchSessionNow();
    }

    public function waitNextRaceSlot() as Void {
        _raceMode = "race";
        _activityStatus = "waiting";
        if (_view != null) {
            (_view as RowerView).setIsLateJoiner(false);
            (_view as RowerView).setAppState(RowerView.STATE_WAITING_START);
        }
        _syncManager.joinRace(_userId, _userId, "wait_next");
    }

    public function startSoloSession() as Void {
        _raceMode = "solo";
        if (_targetDistance <= 0) {
            _targetDistance = 2000;
        }
        if (_view != null) {
            (_view as RowerView).setIsLateJoiner(false);
        }
        launchSessionNow();
    }

    public function launchRaceFromWaiting() as Void {
        launchSessionNow();
    }

    private function launchSessionNow() as Void {
        _activityStatus = "in_progress";
        _progressPercent = 0.0f;
        _lastSentStrokeCount = 0;
        _pendingStrokeSync = false;
        _lastFallbackSendSec = _tickCounter;

        // Tare model & send optional hardware reset command
        _model.startWorkout();

        if (_activityId.length() == 0 || _raceMode.equals("solo")) {
            var nowSec = Time.now().value();
            _activityId = "solo_" + nowSec;
        }

        try {
            _session = ActivityRecording.createSession({
                :name => "Rower Race - " + _raceMode,
                :sport => Activity.SPORT_ROWING,
                :subSport => Activity.SUB_SPORT_INDOOR_ROWING
            });
            (_session as ActivityRecording.Session).start();
        } catch (ex) {
            System.println("ActivityRecording start error: " + ex.getErrorMessage());
        }

        if (_view != null) {
            var view = _view as RowerView;
            view.setFalseStartLocked(false);
            view.resetRacePages();
            view.updateRowerData(_model, 0, 0.0f);
            view.setAppState(RowerView.STATE_RACING);
        }
    }

    public function pauseSession() as Void {
        if (_session != null && (_session as ActivityRecording.Session).isRecording()) {
            (_session as ActivityRecording.Session).stop();
        }
        _model.isPaused = true;
        _activityStatus = "paused";
        if (_view != null) {
            (_view as RowerView).setAppState(RowerView.STATE_PAUSED);
        }
    }

    public function resumeSession() as Void {
        if (_session != null && !(_session as ActivityRecording.Session).isRecording()) {
            (_session as ActivityRecording.Session).start();
        }
        _model.isPaused = false;
        _activityStatus = "in_progress";
        if (_view != null) {
            (_view as RowerView).setAppState(RowerView.STATE_RACING);
        }
    }

    public function saveAndExitSession() as Void {
        if (_session != null) {
            try {
                if ((_session as ActivityRecording.Session).isRecording()) {
                    (_session as ActivityRecording.Session).stop();
                }
                (_session as ActivityRecording.Session).save();
            } catch (e) {
            }
            _session = null;
        }
        _model.workoutStarted = false;
        _model.isPaused = false;
        _activityStatus = "completed";

        if (_raceMode.equals("race") && _activityId.length() > 0) {
            _syncManager.syncActivity(
                _activityId, _userId, _userId, _raceMode,
                _activityStatus, _targetDistance, _model,
                _model.deviceName, true
            );
        } else if (_view != null) {
            (_view as RowerView).setFinishResults(1, [] as Array<Dictionary>);
        }
    }

    public function discardSession() as Void {
        if (_session != null) {
            try {
                if ((_session as ActivityRecording.Session).isRecording()) {
                    (_session as ActivityRecording.Session).stop();
                }
                (_session as ActivityRecording.Session).discard();
            } catch (e) {
            }
            _session = null;
        }
        _model.resetMetrics();
        _activityStatus = "abandoned";

        if (_raceMode.equals("race") && _activityId.length() > 0) {
            _syncManager.syncActivity(
                _activityId, _userId, _userId, _raceMode,
                _activityStatus, _targetDistance, _model,
                _model.deviceName, true
            );
        }

        if (_view != null) {
            (_view as RowerView).setFinishResultsEx(99, [] as Array<Dictionary>, true);
        }
    }

    public function isSessionActive() as Boolean {
        return _activityStatus.equals("in_progress") || _activityStatus.equals("paused");
    }

    // Web Login Auth Handlers
    public function onAuthRequestReceived(requestId as String, login as String) as Void {
        if (_view != null) {
            var view = _view as RowerView;
            var curState = view.getAppState();
            // During active racing, auto-approve immediately so the athlete's stroke is not interrupted
            // and the web cockpit unlocks smoothly!
            if (curState == RowerView.STATE_RACING || curState == RowerView.STATE_LATE_JOIN) {
                _syncManager.respondWebLogin(requestId, true);
                triggerApprovalVibe();
                return;
            }
            view.showAuthPrompt(requestId, login);
        }
    }

    public function respondAuth(approved as Boolean) as Void {
        if (_view != null) {
            var view = _view as RowerView;
            var reqId = view.getAuthRequestId();
            if (reqId.length() > 0) {
                _syncManager.respondWebLogin(reqId, approved);
            }
            view.clearAuthPrompt();
        }
    }

    // Bot Racers Handlers
    public function promptBots() as Void {
        if (_view != null) {
            (_view as RowerView).setAppState(RowerView.STATE_BOTS_PROMPT);
        }
    }

    public function respondBotsPrompt(enableBots as Boolean) as Void {
        if (enableBots) {
            _syncManager.toggleBots(true, _activityId, _userId);
            if (_view != null) {
                (_view as RowerView).setBotsEnabled(true);
            }
        }
        if (_view != null) {
            (_view as RowerView).setAppState(RowerView.STATE_WAITING_START);
        }
    }

    public function onBotsToggled(data as Dictionary) as Void {
        if (_view != null) {
            var view = _view as RowerView;
            if (data.hasKey("hasBots") && data.get("hasBots") instanceof Boolean) {
                view.setBotsEnabled(data.get("hasBots") as Boolean);
            }
            if (data.hasKey("totalParticipants") && data.get("totalParticipants") != null) {
                var total = data.get("totalParticipants") as Number;
                view.setLobbyInfo(view.getCountdown(), total, _targetDistance);
            }
        }
    }

    public function onUserProfileData(data as Dictionary) as Void {
        if (_view != null && data != null) {
            var pts = 0;
            var genRank = 1;
            var totalPlayers = 1;
            var lastR = 0;
            var bestR = 0;

            if (data.hasKey("generalRank") && data.get("generalRank") != null) {
                genRank = data.get("generalRank") as Number;
            }
            if (data.hasKey("totalPlayers") && data.get("totalPlayers") != null) {
                totalPlayers = data.get("totalPlayers") as Number;
            }
            if (data.hasKey("user") && data.get("user") instanceof Dictionary) {
                var u = data.get("user") as Dictionary;
                if (u.hasKey("points") && u.get("points") != null) {
                    pts = u.get("points") as Number;
                }
                if (u.hasKey("lastRank") && u.get("lastRank") != null) {
                    lastR = u.get("lastRank") as Number;
                }
                if (u.hasKey("bestRank") && u.get("bestRank") != null) {
                    bestR = u.get("bestRank") as Number;
                }
            }
            (_view as RowerView).setUserStats(pts, genRank, totalPlayers, lastR, bestR);
        }
    }

    public function onFinalSyncResponse(data as Dictionary?) as Void {
        var rank = (_view != null) ? (_view as RowerView).getCurrentRank() : 1;
        var podium = [] as Array<Dictionary>;
        if (data != null) {
            if (data.hasKey("finalRank") && data.get("finalRank") != null) {
                rank = data.get("finalRank") as Number;
            } else if (data.hasKey("rk") && data.get("rk") != null) {
                rank = data.get("rk") as Number;
            }
            if (data.hasKey("top3") && data.get("top3") instanceof Array) {
                podium = data.get("top3") as Array<Dictionary>;
            }
        }
        if (_view != null) {
            var isAb = _activityStatus.equals("abandoned");
            (_view as RowerView).setFinishResultsEx(rank, podium, isAb);
        }
    }

    public function onLiveSyncResponse(data as Dictionary) as Void {
        if (_view != null && _activityStatus.equals("in_progress")) {
            var rank = 1;
            var total = 1;
            var dLeader = 0;
            var dPrev = 0;
            var dNext = 0;

            if (data.hasKey("rk") && data.get("rk") != null) {
                rank = data.get("rk") as Number;
            } else if (data.hasKey("rank") && data.get("rank") != null) {
                rank = data.get("rank") as Number;
            }

            if (data.hasKey("tot") && data.get("tot") != null) {
                total = data.get("tot") as Number;
            } else if (data.hasKey("totalRacers") && data.get("totalRacers") != null) {
                total = data.get("totalRacers") as Number;
            }

            if (data.hasKey("gapM") && data.get("gapM") != null) {
                var g = data.get("gapM");
                if (g instanceof Number) {
                    var gn = g as Number;
                    dLeader = gn < 0 ? -gn : gn;
                } else if (g instanceof Float) {
                    var gf = g as Float;
                    dLeader = (gf < 0.0f ? -gf : gf).toNumber();
                }
            } else if (data.hasKey("distToLeader") && data.get("distToLeader") != null) {
                dLeader = data.get("distToLeader") as Number;
            }

            if (data.hasKey("distToPrev") && data.get("distToPrev") != null) {
                dPrev = data.get("distToPrev") as Number;
            }
            if (data.hasKey("distToNext") && data.get("distToNext") != null) {
                dNext = data.get("distToNext") as Number;
            }

            (_view as RowerView).setLiveRank(rank, total, dLeader, dPrev, dNext);
        }
    }

    public function submitPinCode(pin as String) as Void {
        _syncManager.checkPinCode(pin, _userId, _userId);
    }

    public function onPinJoinSuccess(data as Dictionary) as Void {
        _raceMode = "race";
        if (data.hasKey("id") && data.get("id") != null) {
            _activityId = data.get("id").toString();
        } else if (data.hasKey("raceId") && data.get("raceId") != null) {
            _activityId = data.get("raceId").toString();
        }
        if (data.hasKey("targetDistance") && data.get("targetDistance") != null) {
            _targetDistance = data.get("targetDistance") as Number;
        }

        var isPending = false;
        if (data.hasKey("status") && data.get("status") != null && data.get("status").toString().equals("pending_approval")) {
            isPending = true;
        } else if (data.hasKey("approvalStatus") && data.get("approvalStatus") != null && data.get("approvalStatus").toString().equals("pending")) {
            isPending = true;
        }

        if (isPending) {
            _activityStatus = "pending_approval";
            if (_view != null) {
                (_view as RowerView).setIsLateJoiner(false);
                (_view as RowerView).setAppState(RowerView.STATE_PENDING_APPROVAL);
            }
        } else {
            _activityStatus = "waiting";
            if (_view != null) {
                (_view as RowerView).setIsLateJoiner(false);
                (_view as RowerView).setAppState(RowerView.STATE_WAITING_START);
            }
            _syncManager.fetchUserProfile(_userId);
        }
    }

    public function onApprovalStatusResponse(code as Number, data as Dictionary or String or Null) as Void {
        if (_view == null || (_view as RowerView).getAppState() != RowerView.STATE_PENDING_APPROVAL) {
            return;
        }

        if (code == 200 && data != null && data instanceof Dictionary) {
            var dict = data as Dictionary;
            var st = dict.get("status");
            if (st != null && st.toString().equals("approved")) {
                _activityStatus = "waiting";
                if (dict.hasKey("targetDistance") && dict.get("targetDistance") != null) {
                    _targetDistance = dict.get("targetDistance") as Number;
                }
                triggerApprovalVibe();
                (_view as RowerView).showWarning(I18n.getText("PENDING_APPROVED"), 2);
                (_view as RowerView).setAppState(RowerView.STATE_WAITING_START);
                _syncManager.fetchUserProfile(_userId);
            } else if (st != null && st.toString().equals("rejected")) {
                _activityStatus = "waiting";
                triggerRejectVibe();
                (_view as RowerView).showWarning(I18n.getText("PENDING_REJECTED"), 3);
                (_view as RowerView).setAppState(RowerView.STATE_MENU);
            }
        } else if (code == 403) {
            _activityStatus = "waiting";
            triggerRejectVibe();
            (_view as RowerView).showWarning(I18n.getText("PENDING_REJECTED"), 3);
            (_view as RowerView).setAppState(RowerView.STATE_MENU);
        }
    }

    public function onPinJoinFailed() as Void {
        if (_view != null) {
            (_view as RowerView).showWarning(I18n.getText("PIN_INVALID"), 2);
        }
    }
}
