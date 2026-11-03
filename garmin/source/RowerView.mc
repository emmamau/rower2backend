import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.ActivityRecording;
import Toybox.System;

class RowerView extends WatchUi.View {

    // App state machine
    public static const STATE_SCANNING = 0;
    public static const STATE_LOBBY = 1;
    public static const STATE_WAITING_START = 2; // Écran de patience / attente départ de course
    public static const STATE_RACING = 3;
    public static const STATE_PAUSED = 4;
    public static const STATE_FINISHED = 5;
    public static const STATE_AUTH_PROMPT = 6; // Demande de validation connexion front web
    public static const STATE_BOTS_PROMPT = 7; // Proposition d'affronter des bots quand le joueur est seul

    private var _currentState as Number = STATE_SCANNING;
    private var _statusText as String = "Recherche FTMS...";
    private var _model as RowerDataModel?;
    
    // Auth Prompt
    private var _authRequestId as String = "";
    private var _authLogin as String = "";

    // Bots State
    private var _hasBotsEnabled as Boolean = false;
    
    // Race details
    private var _userId as String = "";
    private var _raceMode as String = "race"; // "race" or "solo"
    private var _nextRaceCountdown as Number = 0; // seconds
    private var _connectedPlayers as Number = 1;
    private var _targetDistance as Number = 10000;
    private var _currentRank as Number = 1;
    private var _totalRacers as Number = 1;
    private var _finalRank as Number = 0;
    private var _top3Podium as Array<Dictionary> = [];
    private var _netDistance as Number = 0;
    private var _progressPercent as Float = 0.0;
    private var _pauseMenuIndex as Number = 0; // 0: Reprendre, 1: Enregistrer & Quitter, 2: Abandonner

    // Warning overlay: "Ne pas ramer"
    private var _warningText as String? = null;
    private var _warningUntilTimerMs as Number = 0;

    function initialize() {
        View.initialize();
        _model = new RowerDataModel();
        _userId = UserManager.getUserId();
    }

    function setAppState(state as Number) as Void {
        _currentState = state;
        WatchUi.requestUpdate();
    }

    function getAppState() as Number {
        return _currentState;
    }

    function setStatus(status as String) as Void {
        _statusText = status;
        WatchUi.requestUpdate();
    }

    function setLobbyInfo(countdownSec as Number, playersCount as Number, targetDist as Number) as Void {
        _nextRaceCountdown = countdownSec;
        _connectedPlayers = playersCount;
        _targetDistance = targetDist;
        WatchUi.requestUpdate();
    }

    function decrementCountdown() as Void {
        if (_nextRaceCountdown > 0) {
            _nextRaceCountdown -= 1;
            WatchUi.requestUpdate();
        }
    }

    function getCountdown() as Number {
        return _nextRaceCountdown;
    }

    function getConnectedPlayers() as Number {
        return _connectedPlayers;
    }

    function setBotsEnabled(enabled as Boolean) as Void {
        _hasBotsEnabled = enabled;
        WatchUi.requestUpdate();
    }

    function isBotsEnabled() as Boolean {
        return _hasBotsEnabled;
    }

    function setLiveRank(rank as Number, totalRacers as Number) as Void {
        _currentRank = rank;
        _totalRacers = totalRacers;
        WatchUi.requestUpdate();
    }

    function showWarning(text as String, durationSeconds as Number) as Void {
        _warningText = text;
        _warningUntilTimerMs = System.getTimer() + (durationSeconds * 1000);
        WatchUi.requestUpdate();
    }

    function showAuthPrompt(requestId as String, login as String) as Void {
        _authRequestId = requestId;
        _authLogin = login;
        _currentState = STATE_AUTH_PROMPT;
        WatchUi.requestUpdate();
    }

    function getAuthRequestId() as String {
        return _authRequestId;
    }

    function getAuthLogin() as String {
        return _authLogin;
    }

    function updateRowerData(model as RowerDataModel, netDist as Number, progress as Float) as Void {
        _model = model;
        _netDistance = netDist;
        _progressPercent = progress;
        WatchUi.requestUpdate();
    }

    function setFinishResults(rank as Number, podium as Array<Dictionary>) as Void {
        _finalRank = rank;
        _top3Podium = podium;
        _currentState = STATE_FINISHED;
        WatchUi.requestUpdate();
    }

    function cyclePauseMenu() as Void {
        _pauseMenuIndex = (_pauseMenuIndex + 1) % 3;
        WatchUi.requestUpdate();
    }

    function getPauseMenuIndex() as Number {
        return _pauseMenuIndex;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();

        if (_currentState == STATE_SCANNING) {
            drawScanningScreen(dc, width, height);
        } else if (_currentState == STATE_LOBBY) {
            drawLobbyScreen(dc, width, height);
        } else if (_currentState == STATE_WAITING_START) {
            drawWaitingStartScreen(dc, width, height);
        } else if (_currentState == STATE_RACING) {
            drawRacingScreen(dc, width, height);
        } else if (_currentState == STATE_PAUSED) {
            drawPausedScreen(dc, width, height);
        } else if (_currentState == STATE_FINISHED) {
            drawFinishedScreen(dc, width, height);
        } else if (_currentState == STATE_AUTH_PROMPT) {
            drawAuthPromptScreen(dc, width, height);
        } else if (_currentState == STATE_BOTS_PROMPT) {
            drawBotsPromptScreen(dc, width, height);
        }

        // Draw Warning Overlay if active ("Ne pas ramer")
        if (_warningText != null) {
            var now = System.getTimer();
            if (now < _warningUntilTimerMs) {
                drawWarningBanner(dc, width, height, _warningText as String);
            } else {
                _warningText = null;
            }
        }
    }

    // 1. Scanning Screen
    private function drawScanningScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 34, Graphics.FONT_SMALL, "ROWER RACE", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height / 2 - 20, Graphics.FONT_XTINY, "Joueur: " + _userId, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height / 2 + 10, Graphics.FONT_TINY, _statusText, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 35, Graphics.FONT_XTINY, "Synchronisation BLE Rameur...", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // 2. Lobby Screen (Choice between Joining Race or Solo)
    private function drawLobbyScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 28, Graphics.FONT_TINY, "LOBBY COURSE (15m)", Graphics.TEXT_JUSTIFY_CENTER);

        var min = _nextRaceCountdown / 60;
        var sec = _nextRaceCountdown % 60;
        var timeStr = (sec < 10) ? (min + ":0" + sec) : (min + ":" + sec);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 54, Graphics.FONT_NUMBER_MEDIUM, timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 116, Graphics.FONT_XTINY, "Connectes en attente: " + _connectedPlayers, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(width / 2, 136, Graphics.FONT_XTINY, "Distance: " + _targetDistance + "m", Graphics.TEXT_JUSTIFY_CENTER);

        // Buttons instruction
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 168, Graphics.FONT_XTINY, "START : Rejoindre Course", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 192, Graphics.FONT_XTINY, "DOWN : Ramer en Solo", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // 3. Waiting Screen (Patience avant départ)
    private function drawWaitingStartScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        // Special 3-second Countdown Rendering
        if (_nextRaceCountdown <= 3 && _nextRaceCountdown > 0) {
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_RED);
            dc.fillRectangle(0, 0, width, height);

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, 35, Graphics.FONT_MEDIUM, "DEPART IMMINENT", Graphics.TEXT_JUSTIFY_CENTER);

            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, (height / 2) - 40, Graphics.FONT_NUMBER_THAI_HOT, _nextRaceCountdown.toString(), Graphics.TEXT_JUSTIFY_CENTER);

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, height - 45, Graphics.FONT_SMALL, "A VOS RAMES !", Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 28, Graphics.FONT_TINY, "EN ATTENTE DU DEPART", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(25, 48, width - 25, 48);

        // Countdown timer in big digits
        var min = _nextRaceCountdown / 60;
        var sec = _nextRaceCountdown % 60;
        var timeStr = (sec < 10) ? (min + ":0" + sec) : (min + ":" + sec);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 58, Graphics.FONT_NUMBER_HOT, timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        var playersLabel = "Joueurs connectes: " + _connectedPlayers;
        if (_hasBotsEnabled) {
            playersLabel += " (+Bots)";
        }
        dc.drawText(width / 2, 134, Graphics.FONT_TINY, playersLabel, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 155, Graphics.FONT_XTINY, "Course de " + _targetDistance + "m", Graphics.TEXT_JUSTIFY_CENTER);

        // Bots status / hint button
        if (!_hasBotsEnabled && _connectedPlayers <= 1) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, 176, Graphics.FONT_XTINY, "START : Jouer vs Bots ?", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, 176, Graphics.FONT_XTINY, "Joueur: " + _userId, Graphics.TEXT_JUSTIFY_CENTER);
        }

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 26, Graphics.FONT_XTINY, "Depart automatique a 00:00", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // 4. Racing HUD Screen
    private function drawRacingScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        // Status Bar (Top Header descendu sous la lunette)
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var modeTitle = (_raceMode.equals("solo")) ? "SOLO" : "RACE " + _targetDistance + "M";

        // Affichage position instantanée si mode course
        var rankBadge = (_raceMode.equals("solo")) ? ("[" + _userId + "]") : ("RANG " + _currentRank + "/" + _totalRacers);
        dc.drawText(width / 2, 22, Graphics.FONT_XTINY, modeTitle + "  •  " + rankBadge, Graphics.TEXT_JUSTIFY_CENTER);

        // Ligne de séparation sous l'en-tête
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(20, 39, width - 20, 39);

        var m = (_model != null) ? (_model as RowerDataModel) : new RowerDataModel();

        // SPM & Stroke Count
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 42, Graphics.FONT_XTINY, "SPM / COUPS: " + m.strokeCount, Graphics.TEXT_JUSTIFY_CENTER);

        // Cadence (SPM) Main Metric
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        var spmStr = m.strokeRate.format("%.1f");
        dc.drawText(width / 2, 56, Graphics.FONT_NUMBER_MEDIUM, spmStr, Graphics.TEXT_JUSTIFY_CENTER);

        // 2nd horizontal separator line
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(25, 114, width - 25, 114);

        // Power (Watts) & Pace (/500m) Row
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        var powerStr = m.instantPower.toString() + " W";
        dc.drawText(width / 4, 119, Graphics.FONT_MEDIUM, powerStr, Graphics.TEXT_JUSTIFY_CENTER);

        var paceSec = m.instantPace;
        var paceMin = paceSec / 60;
        var paceRemainder = paceSec % 60;
        var paceStr = (paceRemainder < 10) ? (paceMin + ":0" + paceRemainder) : (paceMin + ":" + paceRemainder);
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText((width * 3) / 4, 119, Graphics.FONT_MEDIUM, paceStr + "/500m", Graphics.TEXT_JUSTIFY_CENTER);

        // Labels
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 4, 145, Graphics.FONT_XTINY, "PUISSANCE", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText((width * 3) / 4, 145, Graphics.FONT_XTINY, "ALLURE", Graphics.TEXT_JUSTIFY_CENTER);

        // Net Distance & Elapsed Time Row
        var distStr = _netDistance.toString() + " / " + _targetDistance + "m";
        var timeSec = m.elapsedTime;
        var tMin = timeSec / 60;
        var tSec = timeSec % 60;
        var timeStr = (tSec < 10) ? (tMin + ":0" + tSec) : (tMin + ":" + tSec);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 168, Graphics.FONT_SMALL, distStr + "  |  " + timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Progress bar at bottom
        var barWidth = width - 40;
        var progressPx = (_progressPercent * barWidth).toNumber();
        if (progressPx > barWidth) { progressPx = barWidth; }
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(20, 196, barWidth, 6);
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(20, 196, progressPx, 6);
    }

    // 5. Paused Screen Menu
    private function drawPausedScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 20, Graphics.FONT_MEDIUM, "EN PAUSE", Graphics.TEXT_JUSTIFY_CENTER);

        var options = ["Reprendre", "Enregistrer & Quitter", "Abandonner"];
        for (var i = 0; i < 3; i++) {
            var yPos = 75 + (i * 35);
            if (i == _pauseMenuIndex) {
                dc.setColor(Graphics.COLOR_DK_BLUE, Graphics.COLOR_DK_BLUE);
                dc.fillRectangle(25, yPos - 3, width - 50, 26);
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(width / 2, yPos, Graphics.FONT_TINY, "> " + options[i] + " <", Graphics.TEXT_JUSTIFY_CENTER);
            } else {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(width / 2, yPos, Graphics.FONT_TINY, options[i], Graphics.TEXT_JUSTIFY_CENTER);
            }
        }

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 30, Graphics.FONT_XTINY, "DOWN: Choisir | START: Valider", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // 6. Finished Screen (Rank and Podium)
    private function drawFinishedScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 10, Graphics.FONT_MEDIUM, "COURSE TERMINEE", Graphics.TEXT_JUSTIFY_CENTER);

        var rankStr = (_finalRank > 0) ? ("Votre Rang: #" + _finalRank) : "Bravo!";
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 45, Graphics.FONT_SMALL, rankStr, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 80, Graphics.FONT_XTINY, "--- PODIUM OFFICIEL ---", Graphics.TEXT_JUSTIFY_CENTER);

        var medals = ["1er:", "2eme:", "3eme:"];
        for (var i = 0; i < 3; i++) {
            var racerName = "--";
            if (i < _top3Podium.size() && _top3Podium[i] != null) {
                var p = _top3Podium[i] as Dictionary;
                if (p.hasKey("userName")) {
                    racerName = p.get("userName").toString();
                }
            }
            var yPos = 105 + (i * 24);
            dc.setColor((i == 0) ? Graphics.COLOR_YELLOW : ((i == 1) ? Graphics.COLOR_LT_GRAY : Graphics.COLOR_ORANGE), Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, yPos, Graphics.FONT_TINY, medals[i] + " " + racerName, Graphics.TEXT_JUSTIFY_CENTER);
        }

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 35, Graphics.FONT_XTINY, "FIT enregistre dans Garmin", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // 7. Warning Box Overlay ("Ne pas ramer")
    private function drawWarningBanner(dc as Graphics.Dc, width as Number, height as Number, text as String) as Void {
        var boxW = width - 40;
        var boxH = 46;
        var boxX = 20;
        var boxY = (height / 2) - (boxH / 2);

        // Encart fond rouge
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_RED);
        dc.fillRoundedRectangle(boxX, boxY, boxW, boxH, 8);

        // Bordure blanche
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        dc.drawRoundedRectangle(boxX, boxY, boxW, boxH, 8);

        // Texte blanc au milieu de l'écran
        dc.drawText(width / 2, boxY + 4, Graphics.FONT_MEDIUM, text, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(width / 2, boxY + 26, Graphics.FONT_XTINY, "Attendez le départ !", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // 8. Auth Prompt Screen (Confirmation login front web)
    private function drawAuthPromptScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 18, Graphics.FONT_SMALL, "CONNEXION WEB", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 55, Graphics.FONT_TINY, "Autoriser le joueur :", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 85, Graphics.FONT_MEDIUM, _authLogin, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 125, Graphics.FONT_XTINY, "Montre ID: " + _userId, Graphics.TEXT_JUSTIFY_CENTER);

        // Action options
        dc.setColor(Graphics.COLOR_DK_GREEN, Graphics.COLOR_DK_GREEN);
        dc.fillRoundedRectangle(30, 160, width - 60, 28, 6);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 166, Graphics.FONT_XTINY, "START : Accepter", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_RED, Graphics.COLOR_DK_RED);
        dc.fillRoundedRectangle(30, 196, width - 60, 28, 6);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 202, Graphics.FONT_XTINY, "DOWN : Refuser", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // 9. Bots Prompt Screen (Menu si le joueur est tout seul)
    private function drawBotsPromptScreen(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 15, Graphics.FONT_TINY, "JOUEURS VIRTUELS", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 45, Graphics.FONT_SMALL, "Vous etes seul !", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 75, Graphics.FONT_XTINY, "Souhaitez-vous jouer", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(width / 2, 95, Graphics.FONT_XTINY, "contre des joueurs virtuels ?", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 122, Graphics.FONT_XTINY, "Affrontez 3 Bots Kayak !", Graphics.TEXT_JUSTIFY_CENTER);

        // Buttons
        dc.setColor(Graphics.COLOR_DK_GREEN, Graphics.COLOR_DK_GREEN);
        dc.fillRoundedRectangle(25, 150, width - 50, 28, 6);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 156, Graphics.FONT_XTINY, "START : OUI (Activer Bots)", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_DK_GRAY);
        dc.fillRoundedRectangle(25, 185, width - 50, 28, 6);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 191, Graphics.FONT_XTINY, "DOWN : NON (Attendre/Solo)", Graphics.TEXT_JUSTIFY_CENTER);
    }
}
