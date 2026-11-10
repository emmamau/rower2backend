import Toybox.WatchUi;
import Toybox.Lang;
import Toybox.System;

class RowerDelegate extends WatchUi.BehaviorDelegate {

    private var _bleDelegate as BleDelegate;
    private var _view as RowerView;
    private var _pairingPickerDelegate as UnifiedCodePickerDelegate;
    private var _roomPinPickerDelegate as UnifiedCodePickerDelegate;
    private var _pseudoPickerDelegate as UnifiedCodePickerDelegate;

    public function initialize(bleDelegate as BleDelegate, view as RowerView) {
        BehaviorDelegate.initialize();
        _bleDelegate = bleDelegate;
        _view = view;
        _view.setPairingCompletedCallback(method(:onPairingCodeCompleted));
        _view.setRoomPinCompletedCallback(method(:onRoomPinCompleted));
        _view.setPseudoCompletedCallback(method(:onPseudoCompleted));
        _view.getPairingPicker().setCancelCallback(method(:onPickerCancelled));
        _view.getRoomPinPicker().setCancelCallback(method(:onPickerCancelled));
        _view.getPseudoPicker().setCancelCallback(method(:onPseudoPickerCancelled));
        _pairingPickerDelegate = new UnifiedCodePickerDelegate(_view.getPairingPicker());
        _roomPinPickerDelegate = new UnifiedCodePickerDelegate(_view.getRoomPinPicker());
        _pseudoPickerDelegate = new UnifiedCodePickerDelegate(_view.getPseudoPicker());
    }

    public function onPairingCodeCompleted(code as String) as Void {
        _bleDelegate.submitPairingCode(code);
    }

    public function onRoomPinCompleted(pin as String) as Void {
        _bleDelegate.submitPinCode(pin);
    }

    public function onPseudoCompleted(pseudo as String) as Void {
        UserManager.setGuestPseudo(pseudo);
        _view.showWarning("Pseudo : " + pseudo, 2);
        _view.setAppState(RowerView.STATE_PAIRING_STATUS);
    }

    public function onPseudoPickerCancelled() as Void {
        _view.setAppState(RowerView.STATE_PAIRING_STATUS);
    }

    public function onPickerCancelled() as Void {
        _view.setAppState(RowerView.STATE_MENU);
    }

    // Section 5.1 : Neutralisation formelle du bouton START / STOP / ENTER durant l'attente et les 15s de compte à rebours
    public function onKey(keyEvent as WatchUi.KeyEvent) as Boolean {
        var key = keyEvent.getKey();
        var state = _view.getAppState();
        if (state == RowerView.STATE_LOBBY ||
            state == RowerView.STATE_WAITING_START ||
            state == RowerView.STATE_COUNTDOWN_5S) {
            if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) {
                // Neutralisé jusqu'à T=0 : le départ est piloté exclusivement par le serveur
                return true;
            }
        }
        return BehaviorDelegate.onKey(keyEvent);
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
                // 4. Appairer la montre OU Mon Profil & Identifiant
                if (UserManager.isPaired()) {
                    _view.resetPairingStatusMenu();
                    _view.setAppState(RowerView.STATE_PAIRING_STATUS);
                } else {
                    _view.resetPairingDigits();
                    _view.setAppState(RowerView.STATE_PAIRING_INPUT);
                }
            } else if (menuIdx == 4) {
                // 5. Mon Profil & Identifiant (accessible à tout moment)
                _view.resetPairingStatusMenu();
                _view.setAppState(RowerView.STATE_PAIRING_STATUS);
            } else if (menuIdx == 5) {
                // 6. Historique local (G9)
                _view.setAppState(RowerView.STATE_HISTORY);
            }
            return true;
        } else if (state == RowerView.STATE_PAIRING_INPUT) {
            return _pairingPickerDelegate.onSelect();
        } else if (state == RowerView.STATE_PSEUDO_INPUT) {
            return _pseudoPickerDelegate.onSelect();
        } else if (state == RowerView.STATE_PAIRING_STATUS) {
            var pStatusIdx = _view.getPairingStatusMenuIndex();
            if (pStatusIdx == 0) {
                // Modifier le pseudo (uniquement en mode Invité ; verrouillé en mode Compte Lié)
                if (UserManager.isGuestSession()) {
                    _view.resetPseudoDigits();
                    _view.setAppState(RowerView.STATE_PSEUDO_INPUT);
                } else {
                    _view.showWarning(I18n.getText("PROFILE_SYNCED_WEB"), 3);
                }
            } else if (pStatusIdx == 1) {
                // Réinitialiser / Dissocier
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
            return _roomPinPickerDelegate.onSelect();
        } else if (state == RowerView.STATE_LOBBY || state == RowerView.STATE_WAITING_START) {
            // Section 5.1 : Neutralisation formelle du bouton START durant l'attente et les 15s de compte à rebours
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
            return _pairingPickerDelegate.onNextPage();
        } else if (state == RowerView.STATE_PSEUDO_INPUT) {
            return _pseudoPickerDelegate.onNextPage();
        } else if (state == RowerView.STATE_PAIRING_STATUS) {
            _view.togglePairingStatusMenu();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            return _roomPinPickerDelegate.onNextPage();
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
            return _pairingPickerDelegate.onPreviousPage();
        } else if (state == RowerView.STATE_PSEUDO_INPUT) {
            return _pseudoPickerDelegate.onPreviousPage();
        } else if (state == RowerView.STATE_PAIRING_STATUS) {
            _view.prevPairingStatusMenu();
            return true;
        } else if (state == RowerView.STATE_PIN_INPUT) {
            return _roomPinPickerDelegate.onPreviousPage();
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
            return _pairingPickerDelegate.onTap(clickEvent);
        } else if (state == RowerView.STATE_PSEUDO_INPUT) {
            return _pseudoPickerDelegate.onTap(clickEvent);
        } else if (state == RowerView.STATE_PIN_INPUT) {
            return _roomPinPickerDelegate.onTap(clickEvent);
        }
        return false;
    }

    // Handles touchscreen swipe gestures (Swipe UP = previous char, Swipe DOWN = next char)
    public function onSwipe(swipeEvent as SwipeEvent) as Boolean {
        var state = _view.getAppState();
        if (state == RowerView.STATE_PAIRING_INPUT) {
            return _pairingPickerDelegate.onSwipe(swipeEvent);
        } else if (state == RowerView.STATE_PSEUDO_INPUT) {
            return _pseudoPickerDelegate.onSwipe(swipeEvent);
        } else if (state == RowerView.STATE_PIN_INPUT) {
            return _roomPinPickerDelegate.onSwipe(swipeEvent);
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
            return _pairingPickerDelegate.onBack();
        } else if (state == RowerView.STATE_PSEUDO_INPUT) {
            return _pseudoPickerDelegate.onBack();
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
            return _roomPinPickerDelegate.onBack();
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
