import Toybox.Lang;
import Toybox.Test;

//! Regression test 1: FTMS multi-packet BLE split frame (Bit 0 = 1 "More Data")
//! must NOT wipe instantPower, instantPace, or strokeRate back to 0.
(:test)
function testFtmsSplitContinuationPreservesWatts(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();

    // Initial idle tare packet (0m, 0 strokes)
    model.parseFtmsRowerData([0x2C, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]b);
    model.startWorkout();

    // Packet 1 (20-byte primary frame): Flags 0x002C (SPM+Strokes, Distance, Pace=115s, Power=210W)
    var primaryFrame = [
        0x2C, 0x00,
        56,             // 28.0 SPM
        1, 0,           // 1 stroke
        10, 0, 0,       // 10m distance
        115, 0,         // 115 sec/500m
        210, 0          // 210 Watts
    ]b;
    model.parseFtmsRowerData(primaryFrame);
    Test.assertEqual(210, model.instantPower);

    // Packet 2 (continuation frame 20ms later): Flags 0x0B01 (Bit 0=1 More Data, Bit 8=Energy, Bit 9=HR, Bit 11=Elapsed)
    var continuationFrame = [
        0x01, 0x0B,
        12, 0, 194, 1, 8, // 12 kcal, 450 kcal/h, 8 kcal/min
        154,              // 154 bpm
        30, 0             // 30s elapsed
    ]b;
    model.parseFtmsRowerData(continuationFrame);

    // Continuation frame has NO Power/Pace/SPM fields; previous stroke's 210W MUST be preserved!
    Test.assertEqual(210, model.instantPower);
    Test.assertEqual(115, model.instantPace);
    Test.assertEqual(28.0f, model.strokeRate);
    Test.assertEqual(12, model.totalEnergy);
    Test.assertEqual(154, model.bleHeartRate);
    return true;
}

//! Regression test 2: FTMS rowers setting Bit 5 (0x0020 Power flag) while hardcoding 0 Watts
//! must derive accurate mechanical power (W = 2.80 / (pace/500)^3) from Instantaneous Pace.
(:test)
function testFtmsZeroWattsFlagDerivesPowerFromPace(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();

    model.parseFtmsRowerData([0x2C, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]b);
    model.startWorkout();

    // Rower sets Flags = 0x002C (includes Bit 5 = 0x0020), sends Pace = 100s (1:40/500m), but rawWatts = 0
    var zeroWattsPacket = [
        0x2C, 0x00,
        50,             // 25.0 SPM
        1, 0,           // 1 stroke
        10, 0, 0,       // 10m
        100, 0,         // 100s / 500m -> 2.80 / (0.2)^3 = 350W
        0, 0            // 0 Watts hardcoded by rower firmware
    ]b;
    model.parseFtmsRowerData(zeroWattsPacket);

    Test.assertEqual(350, model.instantPower);
    Test.assertEqual(350, model.avgPower);
    return true;
}

//! Regression test 3: SmartRow stroke burst order ('a' -> 'b' -> 'c' -> 'd' -> 'e')
//! after startWorkout() must NOT wipe 'c'-frame Watts to 0 before 'd' increments stroke count.
(:test)
function testSmartRowFirstStrokeOrderPreservesWatts(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();

    // Idle SmartRow status before workout starts (at 100m odometer)
    model.parseSmartRowString("a001000005");
    model.parseSmartRowString("d001000000010");
    model.startWorkout();

    // Idle '$' poll arrives at 100m before first pull completes
    model.parseSmartRowString("a001000005");

    // First pull completes: SmartRow sends b -> c -> d -> e in alphabetical order
    model.parseSmartRowString("b00100 3500105");
    model.parseSmartRowString("c0010022502250");
    Test.assertEqual(225, model.instantPower);

    model.parseSmartRowString("d001082400011");
    model.parseSmartRowString("e00108152152");

    Test.assertEqual(225, model.instantPower);
    Test.assertEqual(225, model.avgPower);
    Test.assertEqual(8, model.totalDistance);
    Test.assertEqual(1, model.strokeCount);
    return true;
}

//! Regression test 4: Captured SmartRow V3 locked 'c' packet ("c@@@BF  0  441F4\r")
//! sends rawWatts = 0 while locked, whereas 'b', 'd', 'e' send live Work, SPM, and Pace.
//! Model must derive real non-zero Watts instead of staying stuck at 0W.
(:test)
function testSmartRowV3LockedPacketDerivesWatts(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();
    model.parseSmartRowBytes([0x61, 0x40, 0x40, 0x40, 0x40, 0x40, 0x20, 0x20, 0x20, 0x30, 0x0D]b);
    model.startWorkout();

    // SmartRow V3 sends Work = 350.0J ('b'), Cadence = 24.0 SPM ('d'), Pace = 2:05 ('e'),
    // and locked 'c' frame "c@@@BF  0  441F4\r" where rawWatts is masked to "  0"!
    model.parseSmartRowString("b00026 3500105");
    model.parseSmartRowString("d000262400003");
    var lockedV3CFrame = [
        0x63, 0x40, 0x40, 0x40, 0x42, 0x46, 0x20, 0x20, 0x30, 0x20, 0x20, 0x34, 0x34, 0x31, 0x46, 0x34, 0x0D
    ]b;
    model.parseSmartRowBytes(lockedV3CFrame);
    model.parseSmartRowString("e00026205205");

    // Mechanical power = 350.0 J * 24.0 SPM / 60 = 140 W (must NOT be 0!)
    Test.assertEqual(140, model.instantPower);
    Test.assert(model.avgPower > 0);
    return true;
}

//! Regression test 5: BleDelegate must detect V3-locked SmartRow frames (0x40..0x49 in bytes 1..5)
//! so it does NOT prematurely mark handshake state unlocked, and must compute exact KEYLOCK response.
(:test)
function testSmartRowV3LockDetectionAndKeylockMath(logger as Logger) as Boolean {
    var lockedFrame = [
        0x63, 0x40, 0x40, 0x40, 0x42, 0x46, 0x20, 0x20, 0x30, 0x20, 0x20, 0x34, 0x34, 0x31, 0x46, 0x34, 0x0D
    ]b;
    var unlockedFrame = [
        0x63, 0x20, 0x31, 0x32, 0x35, 0x30, 0x32, 0x32, 0x35, 0x30, 0x31, 0x39, 0x38, 0x35, 0x0D
    ]b;

    Test.assertEqual(true, BleDelegate.isSmartRowV3LockedFrame(lockedFrame));
    Test.assertEqual(false, BleDelegate.isSmartRowV3LockedFrame(unlockedFrame));

    // Verify KEYLOCK=C2D70BB1 checksum (0xB1) and response calculation
    var resp = BleDelegate.computeSmartRowKeylockResponse("KEYLOCK=C2D70BB1");
    Test.assert(resp != null);
    var bytes = resp as ByteArray;
    Test.assertEqual(6, bytes.size());
    Test.assertEqual(0x0D, bytes[0]);
    Test.assertEqual(0x0D, bytes[5]);
    return true;
}

