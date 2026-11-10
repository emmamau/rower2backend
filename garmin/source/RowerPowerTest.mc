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
    Test.assertEqual(350.0f, model.work);
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

    Test.assertEqual(350.0f, model.work);
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
    model.parseSmartRowString("a000400000");
    model.startWorkout();

    var noisyPacket = [
        0x0D, 0x0A, 0x20,                                                                           // Preamble noise
        0x64, 0x30, 0x30, 0x30, 0x35, 0x30, 0x32, 0x38, 0x30, 0x30, 0x30, 0x31, 0x32, 0x0D        // "d000502800012\r"
    ]b;
    model.parseSmartRowBytes(noisyPacket);

    Test.assertEqual(28.0f, model.strokeRate);
    Test.assertEqual(12, model.strokeCount);
    Test.assertEqual(10, model.totalDistance);
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

//! Regression test 14: Garmin 6-character code pairing input cycle and slot navigation.
(:test)
function testGarminPairingInputAndStateNavigation(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);
    view.setAppState(RowerView.STATE_MENU);

    // Initial state: reset pairing slots
    view.resetPairingDigits();
    view.setAppState(RowerView.STATE_PAIRING_INPUT);
    Test.assertEqual(RowerView.STATE_PAIRING_INPUT, view.getAppState());
    Test.assertEqual(6, view.getPairingLength());

    // Cycle character on first slot (0 -> 1 -> 0)
    view.cyclePairingChar(1);
    Test.assertEqual("1", view.getCurrentPairingSlotChar());
    view.cyclePairingChar(-1);
    Test.assertEqual("0", view.getCurrentPairingSlotChar());

    // Advance 5 slots
    for (var i = 0; i < 5; i++) {
        var isDone = view.advancePairingSlot();
        Test.assertEqual(false, isDone);
    }
    // 6th slot advance finishes input
    var finished = view.advancePairingSlot();
    Test.assertEqual(true, finished);

    // Backspace navigation
    Test.assertEqual(false, view.backspacePairingSlot());

    // Pairing token persistence check in UserManager
    UserManager.setDeviceToken("test-uuid-v4-token");
    Test.assertEqual(true, UserManager.isPaired());
    Test.assertEqual("test-uuid-v4-token", UserManager.getDeviceToken());
    UserManager.clearPairing();
    Test.assertEqual(false, UserManager.isPaired());

    return true;
}

//! Regression test 15: UnifiedCodePickerView and UnifiedCodePickerDelegate
//! Validates identical behavior across 6-char Pairing ("APPAIRAGE") and 5-char Room PIN ("CODE SALON"),
//! circular wrap-around (0 <-> Z), prev/next carousel characters, slot dash '_', and backspace/cancel.
(:test)
function testUnifiedCodePickerComponent(logger as Logger) as Boolean {
    var pairingPicker = new UnifiedCodePickerView(6, "APPAIRAGE", null);
    var roomPicker = new UnifiedCodePickerView(5, "CODE SALON", null);

    Test.assertEqual(6, pairingPicker.getCodeLength());
    Test.assertEqual("APPAIRAGE", pairingPicker.getScreenTitle());
    Test.assertEqual(5, roomPicker.getCodeLength());
    Test.assertEqual("CODE SALON", roomPicker.getScreenTitle());

    // Initial state: slot 0 active ('0'), remaining slots show '_'
    Test.assertEqual(0, pairingPicker.getCurrentSlot());
    Test.assertEqual("0", pairingPicker.getCurrentChar());
    Test.assertEqual("Z", pairingPicker.getPrevChar());
    Test.assertEqual("1", pairingPicker.getNextChar());
    Test.assertEqual("0", pairingPicker.getSlotDisplayChar(0));
    Test.assertEqual("_", pairingPicker.getSlotDisplayChar(1));
    Test.assertEqual("_", pairingPicker.getSlotDisplayChar(5));

    // Circular wrap-around backward: 0 -> Z
    var pairingDel = new UnifiedCodePickerDelegate(pairingPicker);
    pairingDel.onPreviousPage();
    Test.assertEqual("Z", pairingPicker.getCurrentChar());
    Test.assertEqual("Y", pairingPicker.getPrevChar());
    Test.assertEqual("0", pairingPicker.getNextChar());

    // Circular wrap-around forward: Z -> 0 -> 1
    pairingDel.onNextPage();
    Test.assertEqual("0", pairingPicker.getCurrentChar());
    pairingDel.onNextPage();
    Test.assertEqual("1", pairingPicker.getCurrentChar());

    // Confirm slot 0 ('1') -> advances to slot 1
    Test.assertEqual(false, pairingPicker.confirmCurrentChar());
    Test.assertEqual(1, pairingPicker.getCurrentSlot());
    Test.assertEqual("1", pairingPicker.getSlotDisplayChar(0));
    Test.assertEqual("0", pairingPicker.getSlotDisplayChar(1));
    Test.assertEqual("_", pairingPicker.getSlotDisplayChar(2));

    // Backspace from slot 1 -> returns to slot 0 and clears previous character
    Test.assertEqual(false, pairingPicker.backspaceOrCancel());
    Test.assertEqual(0, pairingPicker.getCurrentSlot());
    Test.assertEqual("0", pairingPicker.getCurrentChar());

    // Backspace at slot 0 -> cancels (returns true) and invokes cancelCallback if configured
    var cancelCalled = new [1] as Array<Boolean>;
    cancelCalled[0] = false;
    Test.assertEqual(false, pairingPicker.hasCancelCallback());
    Test.assertEqual(true, pairingPicker.backspaceOrCancel());

    // Room picker 5-char completion via UnifiedCodePickerDelegate
    var roomDel = new UnifiedCodePickerDelegate(roomPicker);
    roomDel.onNextPage(); // '1'
    roomDel.onSelect();   // slot 0 -> 1
    roomDel.onNextPage(); // '1'
    roomDel.onNextPage(); // '2'
    roomDel.onSelect();   // slot 1 -> 2
    roomDel.onSelect();   // slot 2 -> 3
    roomDel.onSelect();   // slot 3 -> 4
    Test.assertEqual(4, roomPicker.getCurrentSlot());
    Test.assertEqual(true, roomPicker.confirmCurrentChar());
    Test.assertEqual("12000", roomPicker.getFormattedCode());
    Test.assertEqual(5, roomPicker.getFormattedCode().length());

    return true;
}

//! Regression test 16: Mon Profil & Identifiant (UserManager guest vs web account mode & pseudo modification)
(:test)
function testUserManagerProfileAndGuestPseudo(logger as Logger) as Boolean {
    UserManager.clearPairing();
    Test.assertEqual(false, UserManager.isPaired());
    Test.assertEqual(true, UserManager.isGuestSession());

    // Guest mode allows local pseudo update
    UserManager.setGuestPseudo("Rameur_42");
    Test.assertEqual("Rameur_42", UserManager.getUserId());
    Test.assert(UserManager.getActiveProfileLabel().find("Rameur_42") != null);

    // Web Account mode uses pairedUserId and shows Compte Web
    UserManager.setDeviceToken("tok-web-account");
    UserManager.setPairedUserId("Marc_Row");
    UserManager.setGuestPaired(false);
    Test.assertEqual(true, UserManager.isPaired());
    Test.assertEqual(false, UserManager.isGuestSession());
    Test.assertEqual("Marc_Row", UserManager.getUserId());
    Test.assert(UserManager.getActiveProfileLabel().find("Marc_Row") != null);

    // Parcours 2 Guest Ticket mode preserves guest_xxx pairedUserId for API sync while displaying guestPseudo in profile label
    UserManager.setDeviceToken("tok-guest-ticket");
    UserManager.setPairedUserId("guest_abc123");
    UserManager.setGuestPseudo("Alex");
    UserManager.setGuestPaired(true);
    Test.assertEqual(true, UserManager.isPaired());
    Test.assertEqual(true, UserManager.isGuestSession());
    Test.assertEqual("guest_abc123", UserManager.getUserId());
    Test.assertEqual("Alex", UserManager.getDisplayPseudo());
    Test.assert(UserManager.getActiveProfileLabel().find("Alex") != null);

    UserManager.clearPairing();
    return true;
}

//! Regression test 17: BleDelegate lobby wait lock (_isWaitingForReadyOrHost)
//! Joining a private room in LOBBY (secondsRemaining == 0, waitingForHost == true) must NOT self-start the race
//! when polling or ticking until the server transitions to COUNTDOWN or RUNNING.
(:test)
function testLobbyWaitingForReadyDoesNotSelfStartRace(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);
    var del = new BleDelegate(model);
    del.setView(view);

    // Simulate joining a room via 5-char ticket while room is in LOBBY waiting for BLE READY
    var joinData = {
        "id" => "PRIV_TEST_READY",
        "targetDistance" => 2000,
        "lane" => 2,
        "secondsRemaining" => 0,
        "waitingForHost" => true,
        "internalStatus" => "LOBBY",
        "status" => "waiting",
        "guestName" => "Alex",
        "message" => "Bienvenue Alex ! Ligne 2 attribuee"
    };
    del.onPinJoinSuccess(joinData);
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());
    Test.assertEqual(2, view.getAssignedLane());

    // Simulate polling GET /api/v1/races/private/:id while still in LOBBY (secondsRemaining == 0)
    del.onLobbyDataReceived({
        "id" => "PRIV_TEST_READY",
        "status" => "waiting",
        "internalStatus" => "LOBBY",
        "waitingForHost" => true,
        "secondsRemaining" => 0,
        "totalParticipants" => 2,
        "targetDistance" => 2000
    });
    // Must STILL be in STATE_WAITING_START (must NOT prematurely transition to STATE_RACING!)
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());

    // Simulate server starting 15s countdown once all players are READY
    del.onRoomReadyConfirmed({
        "countdownSeconds" => 15,
        "waitingStatusMessage" => "Rameur pret - En attente du depart"
    });
    Test.assertEqual(15, view.getCountdown());
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());

    return true;
}





