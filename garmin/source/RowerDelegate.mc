import Toybox.WatchUi;
import Toybox.Lang;
import Toybox.System;

class RowerDelegate extends WatchUi.BehaviorDelegate {

    private var _bleDelegate as BleDelegate;
    private var _view as RowerView;

    public function initialize(bleDelegate as BleDelegate, view as RowerView) {
        BehaviorDelegate.initialize();
        _bleDelegate = bleDelegate;
        _view = view;
        _view.setPairingCompletedCallback(method(:onPairingCodeCompleted));
        _view.setRoomPinCompletedCallback(method(:onRoomPinCompleted));
    }

    public function onPairingCodeCompleted(code as String) as Void {
        _bleDelegate.submitPairingCode(code);
    }

    public function onRoomPinCompleted(pin as String) as Void {
        _bleDelegate.submitPinCode(pin);
    }

    // Handles START / SELECT button
    public function onSelect() as Boolean {
        var state = _view.getAppState();

        if (state == RowerView.STATE_SCANNING) {
            if (_bleDelegate.getModel().isConnected()) {
                _view.setAppState(RowerView.STATE_MENU);
            } else {
                _bleDelegate.startScan();
            }
            return true;
        } else if (state == RowerView.STATE_MENU) {
            var menuIdx = _view.getMainMenuIndex();
            if (menuIdx == 0) {
                // 1. Course Publique -> Rejoint Lobby / Attente synchrone
                _view.setRaceMode("race");
                _bleDelegate.joinNextRaceWaiting();
            } else if (menuIdx == 1) {
                // 2. Salon Prive -> Ecran de saisie PIN 4-5 chiffres (G3)
                _view.resetPinDigits();
                _view.setAppState(RowerView.STATE_PIN_INPUT);
            } else if (menuIdx == 2) {
                // 3. Ramer en Solo -> Cockpit Garmin immediat
                _view.setRaceMode("solo");
                _bleDelegate.startSoloSession();
            } else if (menuIdx == 3) {
                // 4. Appairer la montre OU Statut Appaire
                if (UserManager.isPaired()) {
                    _view.resetPairingStatusMenu();
                    _view.setAppState(RowerView.STATE_PAIRING_STATUS);
                } else {
                    _view.resetPairingDigits();
                    _view.setAppState(RowerView.STATE_PAIRING_INPUT);
                }
            } else if (menuIdx == 4) {
                // 5. Historique local (G9)
                _view.setAppState(RowerView.STATE_HISTORY);
            }
            return true;
        } else if (state == RowerView.STATE_PAIRING_INPUT) {
            _view.advancePairingSlot();
            return true;
        } else if (state == RowerView.STATE_PAIRING_STATUS) {
            var pStatusIdx = _view.getPairingStatusMenuIndex();
            if (pStatusIdx == 1) {
                _bleDelegate.requestResetPairing();
            } else {
                _view.setAppState(RowerView.STATE_MENU);
            }
            return true;
        } else if (state == RowerView.STATE_PAIRING_RESULT) {
            if (UserManager.isPaired()) {
                if (_bleDelegate.getModel().isConnected()) {
                    _view.setAppState(RowerView.STATE_MENU);
                } else {
                    _view.setAppState(RowerView.STATE_SCANNING);
                    _bleDelegate.startScan();
                }
            } else {
                _view.resetPairingDigits();
                _view.setAppState(RowerView.STATE_PAIRING_INPUT);
            }
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            _view.advancePinDigit();
            return true;
        } else if (state == RowerView.STATE_LOBBY || state == RowerView.STATE_WAITING_START) {
            _bleDelegate.launchRaceFromWaiting();
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE) {
            if (_view.getChoiceMenuIndex() == 0) {
                _bleDelegate.joinRaceLate();
            } else {
                _bleDelegate.waitNextRaceSlot();
            }
            return true;
        } else if (state == RowerView.STATE_COUNTDOWN_5S) {
            return true;
        } else if (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN) {
            _bleDelegate.pauseSession();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            var pIdx = _view.getPauseMenuIndex();
            if (pIdx == 0) {
                _bleDelegate.resumeSession();
            } else if (pIdx == 1) {
                _bleDelegate.saveAndExitSession();
            } else if (pIdx == 2) {
                _bleDelegate.discardSession();
            }
            return true;
        } else if (state == RowerView.STATE_FINISHED || state == RowerView.STATE_HISTORY) {
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        }

        return false;
    }

    // Handles DOWN / NEXT_PAGE button (and vertical swipe on touch watches)
    public function onNextPage() as Boolean {
        var state = _view.getAppState();

        if (state == RowerView.STATE_SCANNING) {
            // Allow entering Menu (Solo / History) even while BLE continues scanning
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        } else if (state == RowerView.STATE_MENU) {
            _view.nextMainMenu();
            return true;
        } else if (state == RowerView.STATE_PAIRING_INPUT) {
            _view.cyclePairingChar(1);
            return true;
        } else if (state == RowerView.STATE_PAIRING_STATUS) {
            _view.togglePairingStatusMenu();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            _view.cyclePinDigit(1);
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE) {
            _view.toggleChoiceMenu();
            return true;
        } else if (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN) {
            _view.nextRacePage();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            _view.nextPauseMenu();
            return true;
        } else if (state == RowerView.STATE_FINISHED) {
            _view.nextFinishPage();
            return true;
        }

        return false;
    }

    // Handles UP / PREVIOUS_PAGE button (and vertical swipe on touch watches)
    public function onPreviousPage() as Boolean {
        var state = _view.getAppState();

        if (state == RowerView.STATE_MENU) {
            _view.prevMainMenu();
            return true;
        } else if (state == RowerView.STATE_PAIRING_INPUT) {
            _view.cyclePairingChar(-1);
            return true;
        } else if (state == RowerView.STATE_PAIRING_STATUS) {
            _view.togglePairingStatusMenu();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            _view.cyclePinDigit(-1);
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE) {
            _view.toggleChoiceMenu();
            return true;
        } else if (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN) {
            _view.prevRacePage();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            _view.prevPauseMenu();
            return true;
        } else if (state == RowerView.STATE_FINISHED) {
            _view.nextFinishPage();
            return true;
        }

        return false;
    }

    // Handles touchscreen tap (on Venu / Epix / Forerunner / Fenix touch) without pausing race on water drops
    public function onTap(clickEvent as ClickEvent) as Boolean {
        var state = _view.getAppState();
        if (state == RowerView.STATE_SCANNING && _bleDelegate.getModel().isConnected()) {
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        } else if (state == RowerView.STATE_PAIRING_INPUT) {
            _view.advancePairingSlot();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            _view.advancePinDigit();
            return true;
        }
        return false;
    }

    // Handles touchscreen swipe gestures (Swipe UP = previous char, Swipe DOWN = next char)
    public function onSwipe(swipeEvent as SwipeEvent) as Boolean {
        var state = _view.getAppState();
        if (state == RowerView.STATE_PAIRING_INPUT) {
            var dir = swipeEvent.getDirection();
            if (dir == WatchUi.SWIPE_UP) {
                _view.cyclePairingChar(-1);
                return true;
            } else if (dir == WatchUi.SWIPE_DOWN) {
                _view.cyclePairingChar(1);
                return true;
            }
        } else if (state == RowerView.STATE_PIN_INPUT) {
            var dir2 = swipeEvent.getDirection();
            if (dir2 == WatchUi.SWIPE_UP) {
                _view.cyclePinDigit(-1);
                return true;
            } else if (dir2 == WatchUi.SWIPE_DOWN) {
                _view.cyclePinDigit(1);
                return true;
            }
        }
        return false;
    }

    // Handles BACK / ESC button
    public function onBack() as Boolean {
        var state = _view.getAppState();

        if (state == RowerView.STATE_SCANNING) {
            _bleDelegate.disconnect();
            return false; // Standard Garmin watch-app exit
        } else if (state == RowerView.STATE_MENU) {
            _view.setAppState(RowerView.STATE_SCANNING);
            return true;
        } else if (state == RowerView.STATE_PAIRING_INPUT) {
            var canExit = _view.backspacePairingSlot();
            if (canExit) {
                if (UserManager.isPaired()) {
                    _view.setAppState(RowerView.STATE_MENU);
                    return true;
                } else {
                    return false; // Exit app if not paired
                }
            }
            return true;
        } else if (state == RowerView.STATE_PAIRING_STATUS) {
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        } else if (state == RowerView.STATE_PAIRING_RESULT) {
            if (UserManager.isPaired()) {
                if (_bleDelegate.getModel().isConnected()) {
                    _view.setAppState(RowerView.STATE_MENU);
                } else {
                    _view.setAppState(RowerView.STATE_SCANNING);
                    _bleDelegate.startScan();
                }
            } else {
                _view.resetPairingDigits();
                _view.setAppState(RowerView.STATE_PAIRING_INPUT);
            }
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            var canExit = _view.backspacePinDigit();
            if (canExit) {
                _view.setAppState(RowerView.STATE_MENU);
            }
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE || state == RowerView.STATE_LOBBY ||
                   state == RowerView.STATE_WAITING_START || state == RowerView.STATE_HISTORY ||
                   state == RowerView.STATE_FINISHED || state == RowerView.STATE_PENDING_APPROVAL) {
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        } else if (state == RowerView.STATE_COUNTDOWN_5S) {
            return true;
        } else if (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN) {
            _bleDelegate.pauseSession();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            _bleDelegate.resumeSession();
            return true;
        }

        return false;
    }
}
