import Toybox.WatchUi;
import Toybox.Lang;
import Toybox.System;

class RowerDelegate extends WatchUi.BehaviorDelegate {

    private var _bleDelegate as BleDelegate;
    private var _view as RowerView?;

    function initialize(bleDelegate as BleDelegate, view as RowerView?) {
        BehaviorDelegate.initialize();
        _bleDelegate = bleDelegate;
        _view = view;
    }

    function setView(view as RowerView) as Void {
        _view = view;
    }

    // Handles START / SELECT button
    function onSelect() as Boolean {
        if (_view == null) {
            return false;
        }

        var state = _view.getAppState();

        if (state == RowerView.STATE_SCANNING) {
            _bleDelegate.startScan();
            return true;
        } else if (state == RowerView.STATE_MENU) {
            var menuIdx = _view.getMainMenuIndex();
            if (menuIdx == 0) {
                // 1. Course Publique -> Rejoint Lobby
                _bleDelegate.joinNextRaceWaiting();
            } else if (menuIdx == 1) {
                // 2. Salon Privé -> Écran de saisie PIN G3
                _view.setAppState(RowerView.STATE_PIN_INPUT);
            } else if (menuIdx == 2) {
                // 3. Historique Récent G9
                _view.setAppState(RowerView.STATE_HISTORY);
            } else if (menuIdx == 3) {
                // 4. Ramer en Solo
                _bleDelegate.startSoloSession();
            }
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            // Validation ou passage au chiffre suivant
            var finished = _view.advancePinDigit();
            if (finished) {
                var pin = _view.getFormattedPin();
                _bleDelegate.submitPinCode(pin);
            }
            return true;
        } else if (state == RowerView.STATE_LOBBY || state == RowerView.STATE_WAITING_START) {
            // Bloqué pendant l'attente du départ
            _view.showWarning("Attendez le départ", 2);
            return true;
        } else if (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN) {
            // Pause
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

    // Handles DOWN / NEXT_PAGE button
    function onNextPage() as Boolean {
        if (_view == null) {
            return false;
        }

        var state = _view.getAppState();
        if (state == RowerView.STATE_MENU) {
            _view.cycleMainMenu();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            _view.decrementPinDigit();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            _view.cyclePauseMenu();
            return true;
        }

        return false;
    }

    // Handles UP / PREVIOUS_PAGE button
    function onPreviousPage() as Boolean {
        if (_view == null) {
            return false;
        }

        var state = _view.getAppState();
        if (state == RowerView.STATE_PIN_INPUT) {
            _view.incrementPinDigit();
            return true;
        }

        return false;
    }

    // Handles BACK / ESC button
    function onBack() as Boolean {
        if (_view == null) {
            return false;
        }

        var state = _view.getAppState();
        if (state == RowerView.STATE_PIN_INPUT) {
            var canExit = _view.backspacePinDigit();
            if (canExit) {
                _view.setAppState(RowerView.STATE_MENU);
            }
            return true;
        } else if (state == RowerView.STATE_RACING || state == RowerView.STATE_LATE_JOIN) {
            _bleDelegate.pauseSession();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            _bleDelegate.resumeSession();
            return true;
        } else if (state == RowerView.STATE_LOBBY || state == RowerView.STATE_WAITING_START || state == RowerView.STATE_HISTORY) {
            _view.setAppState(RowerView.STATE_MENU);
            return true;
        }

        return false;
    }
}
