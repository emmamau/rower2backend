import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.ActivityRecording;
import Toybox.System;
import Toybox.Application.Storage;

class RowerView extends WatchUi.View {

    // App state machine according to specification (G1 to G9)
    public static const STATE_SCANNING      = 0; // G1 : Scanner & Connexion FTMS
    public static const STATE_MENU          = 1; // G2 : Menu Principal
    public static const STATE_PIN_INPUT     = 2; // G3 : Saisie du Code PIN Salon Privé
    public static const STATE_LOBBY         = 3; // G4 : Salle d'attente (Lobby & Ready Check)
    public static const STATE_COUNTDOWN_5S  = 4; // G5 : Décompte synchrone 5s (Vibrations & Alertes)
    public static const STATE_RACING        = 5; // G6 : Écran de course standard
    public static const STATE_LATE_JOIN     = 6; // G7 : Écran de course mode Late-Join
    public static const STATE_FINISHED      = 7; // G8 : Ligne d'arrivée & Podium
    public static const STATE_HISTORY       = 8; // G9 : Historique local Storage
    public static const STATE_PAUSED        = 9; // Menu de pause
    public static const STATE_WAITING_START = 10; // Attente synchrone du T0
    public static const STATE_LATE_CHOICE   = 11;
    public static const STATE_BOTS_PROMPT   = 12;

    private var _currentState as Number = STATE_SCANNING;
    private var _statusText as String = "Recherche FTMS...";
    private var _model as RowerDataModel?;
    
    // G2 Menu Principal selection index (0: Publique, 1: Privée PIN, 2: Historique, 3: Solo)
    private var _mainMenuIndex as Number = 0;

    // G3 PIN Input state (4 digits)
    private var _pinDigits as Array<Number> = [0, 0, 0, 0];
    private var _pinCurrentDigitIdx as Number = 0; // 0 to 3

    // G5 5-seconds countdown
    private var _countdown5sValue as Number = 5;

    // Race details
    private var _userId as String = "";
    private var _raceMode as String = "race";
    private var _nextRaceCountdown as Number = 0;
    private var _connectedPlayers as Number = 1;
    private var _targetDistance as Number = 2000;
    private var _currentRank as Number = 1;
    private var _totalRacers as Number = 1;
    private var _distToLeader as Number = 0;
    private var _distToPrev as Number = 0;
    private var _distToNext as Number = 0;
    private var _finalRank as Number = 0;
    private var _top3Podium as Array<Dictionary> = [];
    private var _netDistance as Number = 0;
    private var _progressPercent as Float = 0.0;
    private var _pauseMenuIndex as Number = 0;
    private var _isLateJoiner as Boolean = false;
    private var _hasBotsEnabled as Boolean = false;
    private var _authRequestId as String = "";
    private var _authLogin as String = "";

    // Warning overlay
    private var _warningText as String? = null;
    private var _warningUntilTimerMs as Number = 0;
    private var _falseStartLocked as Boolean = false;

    // User Career Stats
    private var _userPoints as Number = 0;
    private var _userGeneralRank as Number = 1;
    private var _userTotalPlayers as Number = 1;
    private var _userLastRank as Number = 0;
    private var _userBestRank as Number = 0;

    function initialize() {
        View.initialize();
        _userId = UserManager.getUserId();
    }

    function setAppState(state as Number) as Void {
        _currentState = state;
        WatchUi.requestUpdate();
    }

    function getAppState() as Number {
        return _currentState;
    }

    function setStatus(text as String) as Void {
        _statusText = text;
        WatchUi.requestUpdate();
    }

    function updateRowerData(model as RowerDataModel, netDist as Number, progress as Float) as Void {
        _model = model;
        _netDistance = netDist;
        _progressPercent = progress;
        WatchUi.requestUpdate();
    }

    function setLiveRank(rk as Number, tot as Number, dLeader as Number, dPrev as Number, dNext as Number) as Void {
        _currentRank = rk;
        _totalRacers = tot;
        _distToLeader = dLeader;
        _distToPrev = dPrev;
        _distToNext = dNext;
        WatchUi.requestUpdate();
    }

    function setLobbyInfo(countdown as Number, players as Number, targetDist as Number) as Void {
        _nextRaceCountdown = countdown;
        _connectedPlayers = players;
        _targetDistance = targetDist;
        WatchUi.requestUpdate();
    }

    function setFinishResults(rank as Number, podium as Array<Dictionary>) as Void {
        _finalRank = rank;
        _top3Podium = podium;
        _currentState = STATE_FINISHED;

        // Persist local session in Storage for G9 screen
        try {
            var hist = Storage.getValue("local_race_history");
            var list = (hist != null && hist instanceof Array) ? (hist as Array<Dictionary>) : [] as Array<Dictionary>;
            var item = {
                "date" => "Aujourd'hui",
                "distance" => _targetDistance,
                "rank" => rank,
                "timeSec" => (_model != null ? _model.elapsedTime : 0)
            };
            list.add(item);
            if (list.size() > 5) {
                list = list.slice(list.size() - 5, list.size());
            }
            Storage.setValue("local_race_history", list);
        } catch (ex) {
            System.println("Storage error: " + ex.getErrorMessage());
        }

        WatchUi.requestUpdate();
    }

    function setUserStats(pts as Number, genR as Number, totalP as Number, lastR as Number, bestR as Number) as Void {
        _userPoints = pts;
        _userGeneralRank = genR;
        _userTotalPlayers = totalP;
        _userLastRank = lastR;
        _userBestRank = bestR;
        WatchUi.requestUpdate();
    }

    function showWarning(text as String, durationSec as Number) as Void {
        _warningText = text;
        _warningUntilTimerMs = System.getTimer() + (durationSec * 1000);
        WatchUi.requestUpdate();
    }

    function setFalseStartLocked(locked as Boolean) as Void {
        _falseStartLocked = locked;
        WatchUi.requestUpdate();
    }

    function isFalseStartLocked() as Boolean {
        return _falseStartLocked;
    }

    function setIsLateJoiner(isLate as Boolean) as Void {
        _isLateJoiner = isLate;
    }

    function set5sCountdown(val as Number) as Void {
        _countdown5sValue = val;
        WatchUi.requestUpdate();
    }

    // G2 Menu navigation
    function cycleMainMenu() as Void {
        _mainMenuIndex = (_mainMenuIndex + 1) % 4;
        WatchUi.requestUpdate();
    }

    function getMainMenuIndex() as Number {
        return _mainMenuIndex;
    }

    // G3 PIN Input helpers
    function incrementPinDigit() as Void {
        _pinDigits[_pinCurrentDigitIdx] = (_pinDigits[_pinCurrentDigitIdx] + 1) % 10;
        WatchUi.requestUpdate();
    }

    function decrementPinDigit() as Void {
        var v = _pinDigits[_pinCurrentDigitIdx] - 1;
        _pinDigits[_pinCurrentDigitIdx] = v < 0 ? 9 : v;
        WatchUi.requestUpdate();
    }

    function advancePinDigit() as Boolean {
        if (_pinCurrentDigitIdx < 3) {
            _pinCurrentDigitIdx++;
            WatchUi.requestUpdate();
            return false; // Still typing
        }
        return true; // Finished 4th digit
    }

    function backspacePinDigit() as Boolean {
        if (_pinCurrentDigitIdx > 0) {
            _pinCurrentDigitIdx--;
            WatchUi.requestUpdate();
            return false;
        }
        return true; // Already on first digit, can exit
    }

    function getFormattedPin() as String {
        return "" + _pinDigits[0] + _pinDigits[1] + _pinDigits[2] + _pinDigits[3];
    }

    // Pause menu navigation
    function cyclePauseMenu() as Void {
        _pauseMenuIndex = (_pauseMenuIndex + 1) % 3;
        WatchUi.requestUpdate();
    }

    function getPauseMenuIndex() as Number {
        return _pauseMenuIndex;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var width = dc.getWidth();
        var height = dc.getHeight();

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        if (_currentState == STATE_SCANNING) {
            drawG1Scanning(dc, width, height);
        } else if (_currentState == STATE_MENU) {
            drawG2Menu(dc, width, height);
        } else if (_currentState == STATE_PIN_INPUT) {
            drawG3PinInput(dc, width, height);
        } else if (_currentState == STATE_LOBBY || _currentState == STATE_WAITING_START) {
            drawG4Lobby(dc, width, height);
        } else if (_currentState == STATE_COUNTDOWN_5S) {
            drawG5Countdown(dc, width, height);
        } else if (_currentState == STATE_RACING) {
            if (_isLateJoiner) {
                drawG7LateJoin(dc, width, height);
            } else {
                drawG6Racing(dc, width, height);
            }
        } else if (_currentState == STATE_FINISHED) {
            drawG8Finished(dc, width, height);
        } else if (_currentState == STATE_HISTORY) {
            drawG9History(dc, width, height);
        } else if (_currentState == STATE_PAUSED) {
            drawPaused(dc, width, height);
        }

        // Draw Warning Overlay if active
        if (_warningText != null) {
            var now = System.getTimer();
            if (now < _warningUntilTimerMs) {
                drawWarningBanner(dc, width, height, _warningText as String);
            } else {
                _warningText = null;
            }
        }
    }

    // ==========================================
    // ÉCRANS OFFICIELS G1 À G9
    // ==========================================

    // G1 : Scanner & Connexion FTMS
    private function drawG1Scanning(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 34, Graphics.FONT_SMALL, "ROWER LINK", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height / 2 - 25, Graphics.FONT_MEDIUM, "(( BLE ))", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height / 2 + 10, Graphics.FONT_TINY, _statusText, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 35, Graphics.FONT_XTINY, "Phone Link: OK", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // G2 : Menu Principal
    private function drawG2Menu(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 22, Graphics.FONT_TINY, "SÉLECTION MODE", Graphics.TEXT_JUSTIFY_CENTER);

        var menuItems = [
            "1. Course Publique",
            "2. Salon Privé (PIN)",
            "3. Historique Récent",
            "4. Ramer en Solo"
        ];

        for (var i = 0; i < 4; i++) {
            var yPos = 55 + (i * 32);
            if (i == _mainMenuIndex) {
                dc.setColor(Graphics.COLOR_DK_BLUE, Graphics.COLOR_DK_BLUE);
                dc.fillRoundedRectangle(20, yPos - 2, width - 40, 26, 6);
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(width / 2, yPos, Graphics.FONT_XTINY, "> " + menuItems[i] + " <", Graphics.TEXT_JUSTIFY_CENTER);
            } else {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(width / 2, yPos, Graphics.FONT_XTINY, menuItems[i], Graphics.TEXT_JUSTIFY_CENTER);
            }
        }

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 25, Graphics.FONT_XTINY, "DOWN: Choisir | START: OK", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // G3 : Saisie du Code PIN Salon Privé
    private function drawG3PinInput(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 22, Graphics.FONT_TINY, "SALON PRIVÉ", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 50, Graphics.FONT_XTINY, "Entrez le PIN (4 chiffres) :", Graphics.TEXT_JUSTIFY_CENTER);

        // 4 Digits Boxes
        var boxW = 32;
        var boxH = 44;
        var startX = (width - (4 * boxW + 3 * 8)) / 2;
        var boxY = 85;

        for (var i = 0; i < 4; i++) {
            var bx = startX + (i * (boxW + 8));
            var isCurrent = (i == _pinCurrentDigitIdx);

            if (isCurrent) {
                dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_YELLOW);
                dc.fillRoundedRectangle(bx, boxY, boxW, boxH, 6);
                dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            } else {
                dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_DK_GRAY);
                dc.fillRoundedRectangle(bx, boxY, boxW, boxH, 6);
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            }

            dc.drawText(bx + boxW / 2, boxY + 6, Graphics.FONT_MEDIUM, _pinDigits[i].toString(), Graphics.TEXT_JUSTIFY_CENTER);
        }

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 145, Graphics.FONT_XTINY, "UP/DOWN: Chiffre", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 165, Graphics.FONT_XTINY, "START: Suivant | BACK: Corrig", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // G4 : Salle d'Attente (Lobby & Ready Check)
    private function drawG4Lobby(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 20, Graphics.FONT_XTINY, "SALON COULOIR : #01", Graphics.TEXT_JUSTIFY_CENTER);

        var min = _nextRaceCountdown / 60;
        var sec = _nextRaceCountdown % 60;
        var timeStr = (sec < 10) ? (min + ":0" + sec) : (min + ":" + sec);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_DK_GRAY);
        dc.fillRoundedRectangle(20, 42, width - 40, 52, 10);
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        dc.drawRoundedRectangle(20, 42, width - 40, 52, 10);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 44, Graphics.FONT_NUMBER_HOT, timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 102, Graphics.FONT_XTINY, "AVANT DÉPART", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 125, Graphics.FONT_XTINY, "" + _connectedPlayers + " Rameurs prêts", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 148, Graphics.FONT_XTINY, "Distance: " + _targetDistance + "m", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 25, Graphics.FONT_XTINY, "Départ automatique à 00:00", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // G5 : Décompte Synchrone (T0 - 5 secondes)
    private function drawG5Countdown(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_RED);
        dc.fillRectangle(0, 0, width, height);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 30, Graphics.FONT_MEDIUM, "ATTENTION", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height / 2 - 40, Graphics.FONT_NUMBER_THAI_HOT, ">> " + _countdown5sValue + " <<", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 45, Graphics.FONT_SMALL, "TENIR PALONNIER", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // G6 : Écran de Course (In-Game Standard)
    private function drawG6Racing(dc as Graphics.Dc, width as Number, height as Number) as Void {
        // En-tête Rang / Total
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var rankBadge = "P " + (_currentRank < 10 ? "0" : "") + _currentRank + " / " + _totalRacers;
        dc.drawText(width / 2, 18, Graphics.FONT_TINY, rankBadge, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(25, 36, width - 25, 36);

        var m = (_model != null) ? (_model as RowerDataModel) : new RowerDataModel();

        // Split instantané aux 500m
        var paceSec = m.instantPace;
        var pMin = paceSec / 60;
        var pSec = paceSec % 60;
        var paceStr = (pSec < 10) ? (pMin + ":0" + pSec) : (pMin + ":" + pSec);
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 42, Graphics.FONT_MEDIUM, paceStr + " /500m", Graphics.TEXT_JUSTIFY_CENTER);

        // Puissance (Watts)
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 75, Graphics.FONT_NUMBER_MEDIUM, m.instantPower.toString() + " W", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(25, 125, width - 25, 125);

        // Distance & Écart Leader
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 4, 132, Graphics.FONT_XTINY, "Dist:", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText((width * 3) / 4, 132, Graphics.FONT_XTINY, "Lead:", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 4, 150, Graphics.FONT_SMALL, _netDistance + "m", Graphics.TEXT_JUSTIFY_CENTER);

        var gapStr = (_currentRank == 1) ? "1er" : ("-" + _distToLeader + "m");
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText((width * 3) / 4, 150, Graphics.FONT_SMALL, gapStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Progress bar at bottom
        var barWidth = width - 40;
        var progressPx = (_progressPercent * barWidth).toNumber();
        if (progressPx > barWidth) { progressPx = barWidth; }
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(20, 198, barWidth, 6);
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(20, 198, progressPx, 6);
    }

    // G7 : Écran de Course Alternatif (Mode Late-Join)
    private function drawG7LateJoin(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 18, Graphics.FONT_TINY, "LATE JOIN", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(25, 36, width - 25, 36);

        var m = (_model != null) ? (_model as RowerDataModel) : new RowerDataModel();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 45, Graphics.FONT_SMALL, "Perso: " + _netDistance + "m", Graphics.TEXT_JUSTIFY_CENTER);

        var paceSec = m.instantPace;
        var pMin = paceSec / 60;
        var pSec = paceSec % 60;
        var paceStr = (pSec < 10) ? (pMin + ":0" + pSec) : (pMin + ":" + pSec);
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 75, Graphics.FONT_MEDIUM, "Split: " + paceStr, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(25, 115, width - 25, 115);

        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 125, Graphics.FONT_XTINY, "Peloton: -" + _distToLeader + "m", Graphics.TEXT_JUSTIFY_CENTER);

        var timeSec = m.elapsedTime;
        var tMin = timeSec / 60;
        var tSec = timeSec % 60;
        var timeStr = (tSec < 10) ? (tMin + ":0" + tSec) : (tMin + ":" + tSec);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 150, Graphics.FONT_XTINY, "Session: " + timeStr, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // G8 : Ligne d'Arrivée & Podium Montre
    private function drawG8Finished(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 18, Graphics.FONT_MEDIUM, "TERMINÉ !", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 55, Graphics.FONT_LARGE, "[ #" + _finalRank + " ]", Graphics.TEXT_JUSTIFY_CENTER);

        var m = (_model != null) ? (_model as RowerDataModel) : new RowerDataModel();
        var timeSec = m.elapsedTime;
        var tMin = timeSec / 60;
        var tSec = timeSec % 60;
        var timeStr = (tSec < 10) ? (tMin + ":0" + tSec) : (tMin + ":" + tSec);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 105, Graphics.FONT_SMALL, "Chrono: " + timeStr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(width / 2, 130, Graphics.FONT_XTINY, "Moy: " + m.avgPower + "W | " + m.avgStrokeRate.format("%.0f") + " spm", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 30, Graphics.FONT_XTINY, "FIT Sauvegardé", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // G9 : Consultation de l'Historique Récent au Poignet
    private function drawG9History(dc as Graphics.Dc, width as Number, height as Number) as Void {
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 18, Graphics.FONT_TINY, "HISTORIQUE RÉCENT", Graphics.TEXT_JUSTIFY_CENTER);

        var historyList = [] as Array<Dictionary>;
        try {
            var raw = Storage.getValue("local_race_history");
            if (raw != null && raw instanceof Array) {
                historyList = raw as Array<Dictionary>;
            }
        } catch (ex) {}

        if (historyList.size() == 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, height / 2, Graphics.FONT_XTINY, "Aucune course enregistrée", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            for (var i = 0; i < historyList.size() && i < 3; i++) {
                var item = historyList[i];
                var yPos = 55 + (i * 38);
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                var dist = item.get("distance");
                var rk = item.get("rank");
                var tSec = item.get("timeSec");
                var m = (tSec as Number) / 60;
                var s = (tSec as Number) % 60;
                var timeStr = (s < 10) ? (m + ":0" + s) : (m + ":" + s);

                dc.drawText(width / 2, yPos, Graphics.FONT_XTINY, "> Course " + dist + "m", Graphics.TEXT_JUSTIFY_CENTER);
                dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(width / 2, yPos + 16, Graphics.FONT_XTINY, "#0" + rk + " • " + timeStr, Graphics.TEXT_JUSTIFY_CENTER);
            }
        }

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height - 25, Graphics.FONT_XTINY, "BACK: Retour Menu", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // Menu Pause
    private function drawPaused(dc as Graphics.Dc, width as Number, height as Number) as Void {
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

    // Bannière d'alerte / faux départ
    private function drawWarningBanner(dc as Graphics.Dc, width as Number, height as Number, text as String) as Void {
        var boxW = width - 40;
        var boxH = 46;
        var boxX = 20;
        var boxY = (height / 2) - (boxH / 2);

        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_RED);
        dc.fillRoundedRectangle(boxX, boxY, boxW, boxH, 8);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        dc.drawRoundedRectangle(boxX, boxY, boxW, boxH, 8);

        dc.drawText(width / 2, boxY + 4, Graphics.FONT_MEDIUM, text, Graphics.TEXT_JUSTIFY_CENTER);
        var subText = _falseStartLocked ? "Vitesse à 0 requise !" : "Attendez le départ !";
        dc.drawText(width / 2, boxY + 26, Graphics.FONT_XTINY, subText, Graphics.TEXT_JUSTIFY_CENTER);
    }

    function decrementCountdown() as Void {
        if (_nextRaceCountdown > 0) {
            _nextRaceCountdown--;
            WatchUi.requestUpdate();
        }
    }

    function getCountdown() as Number {
        return _nextRaceCountdown;
    }

    function getConnectedPlayers() as Number {
        return _connectedPlayers;
    }

    function isBotsEnabled() as Boolean {
        return _hasBotsEnabled;
    }

    function setBotsEnabled(enabled as Boolean) as Void {
        _hasBotsEnabled = enabled;
        WatchUi.requestUpdate();
    }

    function showAuthPrompt(reqId as String, login as String) as Void {
        _authRequestId = reqId;
        _authLogin = login;
        WatchUi.requestUpdate();
    }

    function getAuthRequestId() as String {
        return _authRequestId;
    }
}
