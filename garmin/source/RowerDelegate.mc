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
        } else if (state == RowerView.STATE_LOBBY) {
            // Join race waiting room
            _bleDelegate.joinNextRaceWaiting();
            return true;
        } else if (state == RowerView.STATE_WAITING_START) {
            // If alone and bots are not yet enabled, propose bots prompt
            if (_view.getConnectedPlayers() <= 1 && !_view.isBotsEnabled()) {
                _bleDelegate.promptBots();
                return true;
            }
            // Cannot start prematurely in race mode!
            _view.showWarning("Ne pas ramer", 2);
            return true;
        } else if (state == RowerView.STATE_RACING) {
            // Pause activity
            _bleDelegate.pauseSession();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            // Validate selected pause menu item
            var menuIdx = _view.getPauseMenuIndex();
            if (menuIdx == 0) {
                // Reprendre
                _bleDelegate.resumeSession();
            } else if (menuIdx == 1) {
                // Enregistrer & Quitter
                _bleDelegate.saveAndExitSession();
            } else if (menuIdx == 2) {
                // Abandonner
                _bleDelegate.discardSession();
            }
            return true;
        } else if (state == RowerView.STATE_FINISHED) {
            // Back to lobby
            _view.setAppState(RowerView.STATE_LOBBY);
            return true;
        } else if (state == RowerView.STATE_AUTH_PROMPT) {
            // Approve web login
            _bleDelegate.respondAuth(true);
            return true;
        } else if (state == RowerView.STATE_BOTS_PROMPT) {
            // Accept bots
            _bleDelegate.respondBotsPrompt(true);
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE) {
            // START : Rejoindre la course en retard
            _bleDelegate.joinRaceLate();
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
        if (state == RowerView.STATE_LOBBY) {
            // Option to decline multiplayer and row in Solo mode
            _bleDelegate.startSoloSession();
            return true;
        } else if (state == RowerView.STATE_WAITING_START) {
            // Return to Lobby from waiting room
            _view.setAppState(RowerView.STATE_LOBBY);
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            // Cycle pause menu choices
            _view.cyclePauseMenu();
            return true;
        } else if (state == RowerView.STATE_AUTH_PROMPT) {
            // Reject web login
            _bleDelegate.respondAuth(false);
            return true;
        } else if (state == RowerView.STATE_BOTS_PROMPT) {
            // Decline bots
            _bleDelegate.respondBotsPrompt(false);
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE) {
            // DOWN : Attendre la prochaine course (dans 1h)
            _bleDelegate.waitNextRaceSlot();
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
        if (state == RowerView.STATE_RACING) {
            // Pressing back during racing prompts pause menu
            _bleDelegate.pauseSession();
            return true;
        } else if (state == RowerView.STATE_PAUSED) {
            _bleDelegate.resumeSession();
            return true;
        } else if (state == RowerView.STATE_WAITING_START) {
            // Back to lobby
            _view.setAppState(RowerView.STATE_LOBBY);
            return true;
        } else if (state == RowerView.STATE_LATE_CHOICE) {
            // BACK : Ramer seul
            _bleDelegate.startSoloSession();
            return true;
        } else if (state == RowerView.STATE_LOBBY || state == RowerView.STATE_SCANNING) {
            _bleDelegate.stopScan();
            _bleDelegate.disconnect();
            return false; // allow exit application
        }

        return false;
    }
}
