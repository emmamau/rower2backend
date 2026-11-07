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

//! Regression test 6: SmartRow pulley pull BEFORE startWorkout() (in G1 connection screen / warm-up)
//! must parse live Watts, SPM, and Pace so athlete gets instant visual confirmation, while keeping distance at 0.
(:test)
function testSmartRowLivePreviewBeforeWorkoutStarted(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();

    // Athlete pulls pulley while on connection screen (workoutStarted == false)
    model.parseSmartRowString("b00000 3500105");
    model.parseSmartRowString("d000002600001");
    model.parseSmartRowString("c00000  0  441F4");
    model.parseSmartRowString("e00000155155");

    // Live metrics must be visible for connection test
    Test.assertEqual(true, model.liveMovementDetected);
    Test.assertEqual(26.0f, model.strokeRate);
    Test.assertEqual(115, model.instantPace);
    // 350.0 J * 26.0 SPM / 60 = 152 Watts
    Test.assertEqual(152, model.instantPower);
    // Distance must NOT start accumulating before startWorkout()
    Test.assertEqual(0, model.totalDistance);
    Test.assertEqual(0, model.strokeCount);
    return true;
}

//! Regression test 7: SmartRow burst order 'b' -> 'c' (with masked rawWatts=0) -> 'd' -> 'e'
//! during active workout must derive mechanical Watts immediately without deadlocking at 0W.
(:test)
function testSmartRowBurstOrderDerivesWattsWithoutDeadlock(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();
    model.startWorkout();

    // Pulley sends 'b' (work) first
    model.parseSmartRowString("b00001 3200105");
    Test.assertEqual(320.0f, model.work);

    // Pulley sends 'd' (cadence = 25.0 SPM)
    model.parseSmartRowString("d000052500002");
    Test.assertEqual(25.0f, model.strokeRate);

    // Pulley sends 'c' (locked rawWatts = 0)
    model.parseSmartRowString("c00005  0  441F4");

    // 320.0 J * 25.0 SPM / 60 = 133 Watts
    Test.assertEqual(133, model.instantPower);
    Test.assertEqual(true, model.hasStartedRowing);
    Test.assertEqual(false, model.isHalted);
    return true;
}

//! Regression test 8: Alphanumeric PIN entry (5 characters: 0..9 and A..Z)
//! Tests character cycling, advance, backspace, and PIN string formatting.
(:test)
function testAlphanumericPinEntry(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);

    // Initial PIN must be "00000"
    view.resetPinDigits();
    Test.assertEqual("00000", view.getFormattedPin());

    // Increment digit 0: 0 -> 1
    view.incrementPinDigit();
    Test.assertEqual("10000", view.getFormattedPin());

    // Decrement digit 0: 1 -> 0 -> Z (wrap around 35)
    view.decrementPinDigit();
    Test.assertEqual("00000", view.getFormattedPin());
    view.decrementPinDigit();
    Test.assertEqual("Z0000", view.getFormattedPin());

    // Advance to digit 1, set to 'A' (index 10)
    var finished = view.advancePinDigit();
    Test.assertEqual(false, finished);
    for (var i = 0; i < 10; i++) {
        view.incrementPinDigit();
    }
    Test.assertEqual("ZA000", view.getFormattedPin());

    // Advance through remaining digits
    Test.assertEqual(false, view.advancePinDigit()); // to digit 2
    Test.assertEqual(false, view.advancePinDigit()); // to digit 3
    Test.assertEqual(false, view.advancePinDigit()); // to digit 4
    Test.assertEqual(true, view.advancePinDigit());  // 5th character reached, returns true for submission!

    // Backspace test
    Test.assertEqual(false, view.backspacePinDigit()); // back to digit 3
    return true;
}

//! Regression test 9: User login display and pending approval state constants
(:test)
function testUserLoginAndPendingState(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);

    // User login must be non-empty
    var login = view.getUserLogin();
    Test.assert(login.length() > 0);

    // State transition to STATE_PENDING_APPROVAL
    view.setAppState(RowerView.STATE_PENDING_APPROVAL);
    Test.assertEqual(RowerView.STATE_PENDING_APPROVAL, view.getAppState());
    return true;
}

//! Regression test 10: SmartRow telemetry frame split across 2 BLE notifications
//! (e.g. 10 bytes chunk 1: "b00026 350" + 5 bytes chunk 2: "0105\r") must be reassembled
//! without being dropped or corrupted.
(:test)
function testSmartRowSplitPacketReassembly(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();
    model.startWorkout();

    // Chunk 1: first 10 bytes of 'b' frame (Work = 350.0 J, Handle = 105 cm)
    var chunk1 = [
        0x62, 0x30, 0x30, 0x30, 0x32, 0x36, 0x20, 0x33, 0x35, 0x30
    ]b; // "b00026 350"
    model.parseSmartRowBytes(chunk1);

    // Frame is not terminated yet: work must remain 0
    Test.assertEqual(0.0f, model.work);

    // Chunk 2: remaining 5 bytes including '\r'
    var chunk2 = [
        0x30, 0x31, 0x30, 0x35, 0x0D
    ]b; // "0105\r"
    model.parseSmartRowBytes(chunk2);

    // Reassembled frame must be parsed completely!
    Test.assertEqual(35.0f, model.work);
    Test.assertEqual(105, model.handleLengthCm);
    return true;
}

//! Regression test 11: Multiple SmartRow telemetry frames packed back-to-back in a single BLE notification
//! (e.g. 'b' work frame + 'd' cadence frame) must both be parsed sequentially.
(:test)
function testSmartRowMultiFrameInSinglePacket(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();
    model.startWorkout();

    var multiPacket = [
        0x62, 0x30, 0x30, 0x30, 0x32, 0x36, 0x20, 0x33, 0x35, 0x30, 0x30, 0x31, 0x30, 0x35, 0x0D, // "b00026 3500105\r"
        0x64, 0x30, 0x30, 0x30, 0x32, 0x36, 0x32, 0x34, 0x30, 0x30, 0x30, 0x30, 0x33, 0x0D        // "d000262400003\r"
    ]b;
    model.parseSmartRowBytes(multiPacket);

    Test.assertEqual(35.0f, model.work);
    Test.assertEqual(105, model.handleLengthCm);
    Test.assertEqual(24.0f, model.strokeRate);
    Test.assertEqual(3, model.strokeCount);
    return true;
}

//! Regression test 12: SmartRow frame with leading delimiters ('\r\n') must be accepted and parsed cleanly.
(:test)
function testSmartRowPreambleNoiseDelimiterReassembly(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();
    model.startWorkout();

    var noisyPacket = [
        0x0D, 0x0A, 0x20,                                                                           // Preamble noise
        0x64, 0x30, 0x30, 0x30, 0x35, 0x30, 0x32, 0x38, 0x30, 0x30, 0x30, 0x31, 0x32, 0x0D        // "d000502800012\r"
    ]b;
    model.parseSmartRowBytes(noisyPacket);

    Test.assertEqual(28.0f, model.strokeRate);
    Test.assertEqual(12, model.strokeCount);
    Test.assertEqual(50, model.totalDistance);
    return true;
}

//! Regression test 13: Reconnecting or starting workout resets defragmentation buffer
//! so incomplete stale fragments from previous sessions cannot contaminate fresh packets.
(:test)
function testSmartRowDefragmentationBufferResetOnConnect(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    model.onBleConnected();
    model.startWorkout();

    // Partial corrupt fragment without terminator
    var partialCorrupt = [0x62, 0x30, 0x30]b;
    model.parseSmartRowBytes(partialCorrupt);

    // Reconnection occurs
    model.onBleConnected();
    model.startWorkout();

    // Clean valid frame arrives
    var cleanFrame = [
        0x64, 0x30, 0x30, 0x30, 0x31, 0x30, 0x32, 0x30, 0x30, 0x30, 0x30, 0x30, 0x35, 0x0D
    ]b; // "d000102000005\r"
    model.parseSmartRowBytes(cleanFrame);

    Test.assertEqual(20.0f, model.strokeRate);
    Test.assertEqual(5, model.strokeCount);
    Test.assertEqual(10, model.totalDistance);
    return true;
}

//! Regression test 14: Web login authorization modal can be shown and toggled during active racing.
(:test)
function testWebAuthPromptDuringRacingState(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);
    view.setAppState(RowerView.STATE_RACING);

    // Initial state: no pending auth
    Test.assertEqual(false, view.hasPendingAuth());

    // Prompt arrives
    view.showAuthPrompt("REQ_TEST_99", "Coach_Pierre");
    Test.assertEqual(true, view.hasPendingAuth());
    Test.assertEqual("REQ_TEST_99", view.getAuthRequestId());
    Test.assertEqual(0, view.getAuthMenuIndex());

    // Toggle option (Approve <-> Reject)
    view.toggleAuthMenu();
    Test.assertEqual(1, view.getAuthMenuIndex());
    view.toggleAuthMenu();
    Test.assertEqual(0, view.getAuthMenuIndex());

    // Clearing prompt
    view.clearAuthPrompt();
    Test.assertEqual(false, view.hasPendingAuth());
    Test.assertEqual(RowerView.STATE_RACING, view.getAppState());
    return true;
}



