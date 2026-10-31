import Toybox.BluetoothLowEnergy;
import Toybox.Lang;
import Toybox.System;

class BleDelegate extends BluetoothLowEnergy.BleDelegate {

    // Bluetooth SIG standard FTMS Service UUID: 0x1826
    private static const FTMS_SERVICE_UUID = BluetoothLowEnergy.stringToUuid("00001826-0000-1000-8000-00805F9B34FB");
    // FTMS Rower Data Characteristic UUID: 0x2AD1
    private static const ROWER_DATA_CHAR_UUID = BluetoothLowEnergy.stringToUuid("00002AD1-0000-1000-8000-00805F9B34FB");

    private var _view as RowerView?;
    private var _device as BluetoothLowEnergy.Device?;
    private var _syncManager as RestSyncManager;
    private var _deviceName as String? = null;

    function initialize() {
        BleDelegate.initialize();
        _syncManager = new RestSyncManager();
        registerProfiles();
    }

    function setView(view as RowerView) as Void {
        _view = view;
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
            _view.setStatus("Scanning for FTMS...");
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
                        _view.setStatus("Connecting...");
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
                _view.setStatus("Connected!");
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
        } else {
            if (_view != null) {
                _view.setStatus("Disconnected");
            }
            startScan();
        }
    }

    function onCharacteristicChanged(characteristic as BluetoothLowEnergy.Characteristic, value as ByteArray) as Void {
        if (characteristic.getUuid().equals(ROWER_DATA_CHAR_UUID)) {
            parseRowerData(value);
        }
    }

    // FTMS 0x2AD1 Rower Data parser (Little Endian byte decoding)
    private function parseRowerData(bytes as ByteArray) as Void {
        if (bytes.size() < 3) {
            return;
        }

        var model = new RowerDataModel();
        var flags = (bytes[0] & 0xFF) | ((bytes[1] & 0xFF) << 8);
        model.rawFlags = flags;

        // Mandatory fields:
        // Stroke Rate: uint8, resolution 0.5 spm
        model.strokeRate = (bytes[2] & 0xFF) * 0.5;
        // Stroke Count: uint16
        if (bytes.size() >= 5) {
            model.strokeCount = (bytes[3] & 0xFF) | ((bytes[4] & 0xFF) << 8);
        }

        var offset = 5;

        // Bit 1: Average Stroke Rate Present (uint8, 0.5 resolution)
        if ((flags & (1 << 1)) != 0 && (offset + 1) <= bytes.size()) {
            model.avgStrokeRate = (bytes[offset] & 0xFF) * 0.5;
            offset += 1;
        }

        // Bit 2: Total Distance Present (uint24, meters)
        if ((flags & (1 << 2)) != 0 && (offset + 3) <= bytes.size()) {
            model.totalDistance = (bytes[offset] & 0xFF) |
                                  ((bytes[offset + 1] & 0xFF) << 8) |
                                  ((bytes[offset + 2] & 0xFF) << 16);
            offset += 3;
        }

        // Bit 3: Instantaneous Pace Present (uint16, sec/500m)
        if ((flags & (1 << 3)) != 0 && (offset + 2) <= bytes.size()) {
            model.instantPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        // Bit 4: Average Pace Present (uint16, sec/500m)
        if ((flags & (1 << 4)) != 0 && (offset + 2) <= bytes.size()) {
            model.avgPace = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        // Bit 5: Instantaneous Power Present (sint16, Watts)
        if ((flags & (1 << 5)) != 0 && (offset + 2) <= bytes.size()) {
            var rawPow = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawPow > 32767) {
                rawPow -= 65536;
            }
            model.instantPower = rawPow;
            offset += 2;
        }

        // Bit 6: Average Power Present (sint16, Watts)
        if ((flags & (1 << 6)) != 0 && (offset + 2) <= bytes.size()) {
            var rawAvgPow = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawAvgPow > 32767) {
                rawAvgPow -= 65536;
            }
            model.avgPower = rawAvgPow;
            offset += 2;
        }

        // Bit 7: Resistance Level Present (sint16)
        if ((flags & (1 << 7)) != 0 && (offset + 2) <= bytes.size()) {
            var rawRes = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            if (rawRes > 32767) {
                rawRes -= 65536;
            }
            model.resistanceLevel = rawRes;
            offset += 2;
        }

        // Bit 8: Expired Energy Present (Total Energy uint16, Energy/h uint16, Energy/m uint8)
        if ((flags & (1 << 8)) != 0 && (offset + 5) <= bytes.size()) {
            model.totalEnergy = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            model.energyPerHour = (bytes[offset + 2] & 0xFF) | ((bytes[offset + 3] & 0xFF) << 8);
            model.energyPerMinute = (bytes[offset + 4] & 0xFF);
            offset += 5;
        }

        // Bit 9: Heart Rate Present (uint8, bpm)
        if ((flags & (1 << 9)) != 0 && (offset + 1) <= bytes.size()) {
            model.heartRate = (bytes[offset] & 0xFF);
            offset += 1;
        }

        // Bit 10: Metabolic Equivalent Present (uint8, 0.1 METs)
        if ((flags & (1 << 10)) != 0 && (offset + 1) <= bytes.size()) {
            model.metabolicEq = (bytes[offset] & 0xFF) * 0.1;
            offset += 1;
        }

        // Bit 11: Elapsed Time Present (uint16, seconds)
        if ((flags & (1 << 11)) != 0 && (offset + 2) <= bytes.size()) {
            model.elapsedTime = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        // Bit 12: Remaining Time Present (uint16, seconds)
        if ((flags & (1 << 12)) != 0 && (offset + 2) <= bytes.size()) {
            model.remainingTime = (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8);
            offset += 2;
        }

        // Update the UI
        if (_view != null) {
            _view.updateRowerData(model);
        }

        // Transmit to Render Backend API
        _syncManager.sendRowerData(model, _deviceName);
    }
}

