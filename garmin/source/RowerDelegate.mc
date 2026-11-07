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
    }

    // Handles START / SELECT button
    public function onSelect() as Boolean {
        var state = _view.getAppState();

        // Priority modal: Web Login Authorization prompt
        if (_view.hasPendingAuth() && state != RowerView.STATE_COUNTDOWN_5S) {
            _bleDelegate.respondAuth(_view.getAuthMenuIndex() == 0);
            return true;
        }

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
                // 2. Salon Prive -> Ecran de saisie PIN 4 chiffres (G3)
                _view.resetPinDigits();
                _view.setAppState(RowerView.STATE_PIN_INPUT);
            } else if (menuIdx == 2) {
                // 3. Ramer en Solo -> Cockpit Garmin immediat
                _view.setRaceMode("solo");
                _bleDelegate.startSoloSession();
            } else if (menuIdx == 3) {
                // 4. Mon identifiant de joueur
                _view.setAppState(RowerView.STATE_PLAYER_ID);
            } else if (menuIdx == 4) {
                // 5. Historique local (G9)
                _view.setAppState(RowerView.STATE_HISTORY);
            }
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            var finished = _view.advancePinDigit();
            if (finished) {
                _bleDelegate.submitPinCode(_view.getFormattedPin());
            }
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
        } else if (state == RowerView.STATE_FINISHED || state == RowerView.STATE_HISTORY || state == RowerView.STATE_PLAYER_ID) {
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        }

        return false;
    }

    // Handles DOWN / NEXT_PAGE button (and vertical swipe on touch watches)
    public function onNextPage() as Boolean {
        var state = _view.getAppState();

        if (_view.hasPendingAuth() && state != RowerView.STATE_COUNTDOWN_5S) {
            _view.toggleAuthMenu();
            return true;
        }

        if (state == RowerView.STATE_SCANNING) {
            // Allow entering Menu (Solo / History) even while BLE continues scanning
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        } else if (state == RowerView.STATE_MENU) {
            _view.nextMainMenu();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            _view.decrementPinDigit();
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

        if (_view.hasPendingAuth() && state != RowerView.STATE_COUNTDOWN_5S) {
            _view.toggleAuthMenu();
            return true;
        }

        if (state == RowerView.STATE_MENU) {
            _view.prevMainMenu();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            _view.incrementPinDigit();
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
        if ((state == RowerView.STATE_SCANNING && _bleDelegate.getModel().isConnected()) || state == RowerView.STATE_PLAYER_ID) {
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        }
        return false;
    }

    // Handles BACK / ESC button
    public function onBack() as Boolean {
        var state = _view.getAppState();

        if (_view.hasPendingAuth() && state != RowerView.STATE_COUNTDOWN_5S) {
            _bleDelegate.respondAuth(false);
            return true;
        }

        if (state == RowerView.STATE_SCANNING) {
            _bleDelegate.disconnect();
            return false; // Standard Garmin watch-app exit
        } else if (state == RowerView.STATE_MENU) {
            _view.setAppState(RowerView.STATE_SCANNING);
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            var canExit = _view.backspacePinDigit();
            if (canExit) {
                _view.setAppState(RowerView.STATE_MENU);
            }
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE || state == RowerView.STATE_LOBBY ||
                   state == RowerView.STATE_WAITING_START || state == RowerView.STATE_HISTORY ||
                   state == RowerView.STATE_PLAYER_ID ||
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
