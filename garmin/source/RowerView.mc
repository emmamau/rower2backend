import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Application.Storage;

class RowerView extends WatchUi.View {

    // Official Garmin App States (G1 to G9 + Modals)
    public static const STATE_SCANNING      = 0; // G1 : Connexion Rameur BLE (FTMS / SmartRow)
    public static const STATE_MENU          = 1; // G2 : Menu Principal
    public static const STATE_PIN_INPUT     = 2; // G3 : Saisie PIN 4 chiffres
    public static const STATE_LOBBY         = 3; // G4 : Salle d'attente
    public static const STATE_COUNTDOWN_5S  = 4; // G5 : Decompte synchrone 5s
    public static const STATE_RACING        = 5; // G6 : Grille Course Garmin (2 pages)
    public static const STATE_LATE_JOIN     = 6; // G7 : Grille Course Late-Join
    public static const STATE_FINISHED      = 7; // G8 : Arrivee & Podium (2 pages)
    public static const STATE_HISTORY       = 8; // G9 : Historique local
    public static const STATE_PAUSED        = 9; // Menu Pause
    public static const STATE_WAITING_START = 10; // Attente synchrone du depart
    public static const STATE_LATE_CHOICE   = 11; // Choix course en cours
    public static const STATE_BOTS_PROMPT   = 12; // Choix ajout de bots
    public static const STATE_PENDING_APPROVAL = 13; // En attente de validation par l'hote (salon prive)
    public static const STATE_PLAYER_ID        = 14; // Mon identifiant de joueur (appairage web)

    // Garmin Pro Dark Carbon Palette (64-color MIP & AMOLED compatible)
    private static const COL_BG        = Graphics.COLOR_BLACK;
    private static const COL_PRIMARY   = Graphics.COLOR_WHITE;
    private static const COL_MUTED     = Graphics.COLOR_LT_GRAY;
    private static const COL_GRID      = Graphics.COLOR_DK_GRAY;
    private static const COL_ACCENT    = Graphics.COLOR_YELLOW;
    private static const COL_CYAN      = Graphics.COLOR_BLUE;
    private static const COL_GOOD      = Graphics.COLOR_GREEN;
    private static const COL_WARN      = Graphics.COLOR_ORANGE;
    private static const COL_ALERT     = Graphics.COLOR_RED;
    private static const COL_PILL_BG   = Graphics.COLOR_DK_BLUE;

    // Alphanumeric character set for 5-char PIN codes (0..9 + A..Z = 36 chars)
    private static const PIN_CHARSET as Array<String> = [
        "0","1","2","3","4","5","6","7","8","9",
        "A","B","C","D","E","F","G","H","I","J",
        "K","L","M","N","O","P","Q","R","S","T",
        "U","V","W","X","Y","Z"
    ];

    private var _model as RowerDataModel;
    private var _currentState as Number = STATE_SCANNING;

    // Navigation & Page indices
    private var _mainMenuIndex as Number = 0;   // 0..3
    private var _pauseMenuIndex as Number = 0;  // 0..2
    private var _choiceMenuIndex as Number = 0; // 0..1 (Late choice & Bots prompt)
    private var _authMenuIndex as Number = 0;   // 0..1 (Web auth prompt)
    private var _racePage as Number = 0;        // 0 = Main 2x2 Race Grid, 1 = Gaps & Averages 2x2 Grid
    private var _finishPage as Number = 0;      // 0 = Finish Stats 2x2 Grid, 1 = Official Top 3 Podium

    // G3 PIN Input state (5 alphanumeric characters)
    private var _pinIndices as Array<Number> = [0, 0, 0, 0, 0];
    private var _pinCurrentDigitIdx as Number = 0;

    // G5 5-second countdown
    private var _countdown5sValue as Number = 5;

    // Race & Lobby state
    private var _userId as String = "";
    private var _raceMode as String = "race";
    private var _nextRaceCountdown as Number = 600;
    private var _connectedPlayers as Number = 1;
    private var _targetDistance as Number = 10000;
    private var _currentRank as Number = 1;
    private var _totalRacers as Number = 1;
    private var _distToLeader as Number = 0;
    private var _distToPrev as Number = 0;
    private var _distToNext as Number = 0;
    private var _finalRank as Number = 1;
    private var _top3Podium as Array<Dictionary> = [] as Array<Dictionary>;
    private var _netDistance as Number = 0;
    private var _progressPercent as Float = 0.0f;
    private var _isLateJoiner as Boolean = false;
    private var _hasBotsEnabled as Boolean = false;
    private var _isAbandoned as Boolean = false;
    private var _gameRemainingSeconds as Number = 3300; // Max 55 minutes remaining timer

    // Web login authorization overlay
    private var _authRequestId as String = "";
    private var _authLogin as String = "";
    private var _authPromptStartTimer as Number = 0;

    // Warning toast overlay
    private var _warningText as String? = null;
    private var _warningUntilTimerMs as Number = 0;
    private var _falseStartLocked as Boolean = false;

    // User Career Stats (shown in Lobby G4 grid)
    private var _userPoints as Number = 0;
    private var _userGeneralRank as Number = 1;
    private var _userTotalPlayers as Number = 1;
    private var _userLastRank as Number = 0;
    private var _userBestRank as Number = 0;

    public function initialize(model as RowerDataModel) {
        View.initialize();
        _model = model;
        _userId = UserManager.getUserId();
        I18n.init();
    }

    public function setAppState(state as Number) as Void {
        _currentState = state;
        if (state == STATE_PAUSED) {
            _pauseMenuIndex = 0;
        } else if (state == STATE_LATE_CHOICE || state == STATE_BOTS_PROMPT) {
            _choiceMenuIndex = 0;
        }
        WatchUi.requestUpdate();
    }

    public function getAppState() as Number {
        return _currentState;
    }

    public function setRaceMode(mode as String) as Void {
        _raceMode = mode;
    }

    public function resetRacePages() as Void {
        _racePage = 0;
        _finishPage = 0;
    }

    public function nextRacePage() as Void {
        _racePage = (_racePage + 1) % 2;
        WatchUi.requestUpdate();
    }

    public function prevRacePage() as Void {
        _racePage = (_racePage + 1) % 2;
        WatchUi.requestUpdate();
    }

    public function nextFinishPage() as Void {
        _finishPage = (_finishPage + 1) % 2;
        WatchUi.requestUpdate();
    }

    public function updateRowerData(model as RowerDataModel, netDist as Number, progress as Float) as Void {
        _model = model;
        _netDistance = netDist;
        _progressPercent = progress;
    }

    public function setLiveRank(rk as Number, tot as Number, dLeader as Number, dPrev as Number, dNext as Number) as Void {
        _currentRank = rk;
        _totalRacers = tot;
        _distToLeader = dLeader;
        _distToPrev = dPrev;
        _distToNext = dNext;
        WatchUi.requestUpdate();
    }

    public function getCurrentRank() as Number {
        return _currentRank;
    }

    public function setLobbyInfo(countdown as Number, players as Number, targetDist as Number) as Void {
        _nextRaceCountdown = countdown;
        _connectedPlayers = players;
        _targetDistance = targetDist;
        WatchUi.requestUpdate();
    }

    public function setGameRemainingSeconds(remSec as Number) as Void {
        _gameRemainingSeconds = remSec;
        WatchUi.requestUpdate();
    }

    public function getGameRemainingSeconds() as Number {
        return _gameRemainingSeconds;
    }

    public function setFinishResults(rank as Number, podium as Array<Dictionary>) as Void {
        setFinishResultsEx(rank, podium, false);
    }

    public function setFinishResultsEx(rank as Number, podium as Array<Dictionary>, isAbandoned as Boolean) as Void {
        _finalRank = rank;
        _top3Podium = podium;
        _finishPage = 0;
        _isAbandoned = isAbandoned;
        _currentState = STATE_FINISHED;

        // Persist compact session entry in local Storage for G9 History
        try {
            var hist = Storage.getValue("local_race_history");
            var list = (hist != null && hist instanceof Array) ? (hist as Array<Dictionary>) : ([] as Array<Dictionary>);
            var distRecorded = (_netDistance > 0) ? _netDistance : _model.totalDistance;
            var item = {
                "distance" => distRecorded,
                "rank" => rank,
                "timeSec" => _model.elapsedTime,
                "avgW" => _model.avgPower
            };
            list.add(item);
            if (list.size() > 5) {
                list = list.slice(list.size() - 5, list.size()) as Array<Dictionary>;
            }
            Storage.setValue("local_race_history", list);
        } catch (ex) {
        }

        WatchUi.requestUpdate();
    }

    public function setUserStats(pts as Number, genR as Number, totalP as Number, lastR as Number, bestR as Number) as Void {
        _userPoints = pts;
        _userGeneralRank = genR;
        _userTotalPlayers = totalP;
        _userLastRank = lastR;
        _userBestRank = bestR;
        WatchUi.requestUpdate();
    }

    public function showWarning(text as String, durationSec as Number) as Void {
        _warningText = text;
        _warningUntilTimerMs = System.getTimer() + (durationSec * 1000);
        WatchUi.requestUpdate();
    }

    public function setFalseStartLocked(locked as Boolean) as Void {
        _falseStartLocked = locked;
    }

    public function isFalseStartLocked() as Boolean {
        return _falseStartLocked;
    }

    public function setIsLateJoiner(isLate as Boolean) as Void {
        _isLateJoiner = isLate;
    }

    public function set5sCountdown(val as Number) as Void {
        _countdown5sValue = val;
    }

    // Menu navigation helpers
    public function nextMainMenu() as Void {
        _mainMenuIndex = (_mainMenuIndex + 1) % 5;
        WatchUi.requestUpdate();
    }

    public function prevMainMenu() as Void {
        _mainMenuIndex = (_mainMenuIndex + 4) % 5;
        WatchUi.requestUpdate();
    }

    public function getMainMenuIndex() as Number {
        return _mainMenuIndex;
    }

    public function nextPauseMenu() as Void {
        _pauseMenuIndex = (_pauseMenuIndex + 1) % 3;
        WatchUi.requestUpdate();
    }

    public function prevPauseMenu() as Void {
        _pauseMenuIndex = (_pauseMenuIndex + 2) % 3;
        WatchUi.requestUpdate();
    }

    public function getPauseMenuIndex() as Number {
        return _pauseMenuIndex;
    }

    public function toggleChoiceMenu() as Void {
        _choiceMenuIndex = (_choiceMenuIndex + 1) % 2;
        WatchUi.requestUpdate();
    }

    public function getChoiceMenuIndex() as Number {
        return _choiceMenuIndex;
    }

    public function getUserLogin() as String {
        return _userId;
    }

    // PIN helpers (5 alphanumeric characters 0..9 and A..Z)
    public function incrementPinDigit() as Void {
        _pinIndices[_pinCurrentDigitIdx] = (_pinIndices[_pinCurrentDigitIdx] + 1) % 36;
        WatchUi.requestUpdate();
    }

    public function decrementPinDigit() as Void {
        var v = _pinIndices[_pinCurrentDigitIdx] - 1;
        _pinIndices[_pinCurrentDigitIdx] = v < 0 ? 35 : v;
        WatchUi.requestUpdate();
    }

    public function advancePinDigit() as Boolean {
        if (_pinCurrentDigitIdx < 4) {
            _pinCurrentDigitIdx++;
            WatchUi.requestUpdate();
            return false;
        }
        return true;
    }

    public function backspacePinDigit() as Boolean {
        if (_pinCurrentDigitIdx > 0) {
            _pinCurrentDigitIdx--;
            WatchUi.requestUpdate();
            return false;
        }
        return true;
    }

    public function resetPinDigits() as Void {
        _pinIndices = [0, 0, 0, 0, 0];
        _pinCurrentDigitIdx = 0;
    }

    public function getFormattedPin() as String {
        var res = "";
        for (var i = 0; i < 5; i++) {
            res += PIN_CHARSET[_pinIndices[i]];
        }
        return res;
    }

    // Countdown & Lobby getters
    public function decrementCountdown() as Void {
        if (_nextRaceCountdown > 0) {
            _nextRaceCountdown--;
        }
    }

    public function getCountdown() as Number {
        return _nextRaceCountdown;
    }

    public function getConnectedPlayers() as Number {
        return _connectedPlayers;
    }

    public function isBotsEnabled() as Boolean {
        return _hasBotsEnabled;
    }

    public function setBotsEnabled(enabled as Boolean) as Void {
        _hasBotsEnabled = enabled;
        WatchUi.requestUpdate();
    }

    // Web Auth prompt helpers
    public function showAuthPrompt(reqId as String, login as String) as Void {
        if (!_authRequestId.equals(reqId)) {
            _authRequestId = reqId;
            _authLogin = login;
            _authMenuIndex = 0;
            _authPromptStartTimer = System.getTimer();
            WatchUi.requestUpdate();
        }
    }

    public function hasPendingAuth() as Boolean {
        return (_authRequestId.length() > 0);
    }

    public function toggleAuthMenu() as Void {
        _authMenuIndex = (_authMenuIndex + 1) % 2;
        WatchUi.requestUpdate();
    }

    public function getAuthMenuIndex() as Number {
        return _authMenuIndex;
    }

    public function getAuthRequestId() as String {
        return _authRequestId;
    }

    public function clearAuthPrompt() as Void {
        _authRequestId = "";
        _authLogin = "";
        WatchUi.requestUpdate();
    }

    // =========================================================================
    // MAIN RENDER DISPATCHER
    // =========================================================================
    public function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(COL_BG, COL_BG);
        dc.clear();

        // Priority modal: Web Login Authorization (active during all phases including racing)
        if (hasPendingAuth() && _currentState != STATE_COUNTDOWN_5S) {
            // Auto-dismiss after 25s without input during active racing to avoid blocking display
            if ((_currentState == STATE_RACING || _currentState == STATE_LATE_JOIN) &&
                (System.getTimer() - _authPromptStartTimer > 25000)) {
                clearAuthPrompt();
            } else {
                drawGarminMenuScreen(
                    dc,
                    I18n.getText("AUTH_TITLE"),
                    COL_ACCENT,
                    I18n.getText("AUTH_SUB") + " " + _authLogin,
                    [I18n.getText("AUTH_APPROVE"), I18n.getText("AUTH_REJECT")] as Array<String>,
                    _authMenuIndex,
                    I18n.getText("MENU_FOOTER")
                );
                return;
            }
        }

        if (_currentState == STATE_SCANNING) {
            drawG1ConnectionScreen(dc, w, h);
        } else if (_currentState == STATE_MENU) {
            var menuItems = [
                I18n.getText("MENU_PUBLIC"),
                I18n.getText("MENU_PRIVATE"),
                I18n.getText("MENU_SOLO"),
                I18n.getText("MENU_PLAYER_ID"),
                I18n.getText("MENU_HISTORY")
            ] as Array<String>;
            var menuSub = getBleProtocolTag();
            if (_userId.length() > 0) {
                menuSub = menuSub + " | " + I18n.getText("PLAYER_LABEL") + " " + _userId;
            }
            drawGarminMenuScreen(
                dc,
                I18n.getText("MENU_TITLE"),
                COL_ACCENT,
                menuSub,
                menuItems,
                _mainMenuIndex,
                I18n.getText("MENU_FOOTER")
            );
        } else if (_currentState == STATE_PIN_INPUT) {
            drawG3PinInput(dc, w, h);
        } else if (_currentState == STATE_PENDING_APPROVAL) {
            drawPendingApprovalScreen(dc, w, h);
        } else if (_currentState == STATE_PLAYER_ID) {
            drawPlayerIdScreen(dc, w, h);
        } else if (_currentState == STATE_LOBBY || _currentState == STATE_WAITING_START) {
            drawG4LobbyGrid(dc, w, h);
        } else if (_currentState == STATE_COUNTDOWN_5S) {
            drawG5Countdown(dc, w, h);
        } else if (_currentState == STATE_RACING || _currentState == STATE_LATE_JOIN) {
            drawG6RacingCockpit(dc, w, h);
        } else if (_currentState == STATE_FINISHED) {
            drawG8Finished(dc, w, h);
        } else if (_currentState == STATE_HISTORY) {
            drawG9History(dc, w, h);
        } else if (_currentState == STATE_PAUSED) {
            var pauseItems = [
                I18n.getText("MENU_RESUME"),
                I18n.getText("MENU_SAVE_EXIT"),
                I18n.getText("MENU_ABANDON")
            ] as Array<String>;
            drawGarminMenuScreen(
                dc,
                I18n.getText("PAUSED_TITLE"),
                COL_WARN,
                _model.formatTime(_model.elapsedTime) + "  |  " + _netDistance + "m",
                pauseItems,
                _pauseMenuIndex,
                I18n.getText("MENU_FOOTER")
            );
        } else if (_currentState == STATE_LATE_CHOICE) {
            var lateItems = [
                I18n.getText("LATE_OPT_JOIN"),
                I18n.getText("LATE_OPT_WAIT")
            ] as Array<String>;
            drawGarminMenuScreen(
                dc,
                I18n.getText("LATE_TITLE"),
                COL_WARN,
                "" + _connectedPlayers + " " + I18n.getText("CELL_RACERS"),
                lateItems,
                _choiceMenuIndex,
                I18n.getText("MENU_FOOTER")
            );
        }

        // Draw non-overlapping warning banner if active
        if (_warningText != null) {
            if (System.getTimer() < _warningUntilTimerMs) {
                drawWarningBanner(dc, w, h, _warningText as String);
            } else {
                _warningText = null;
            }
        }
    }

    // =========================================================================
    // GARMIN PROPORTIONAL GEOMETRY & ANTI-OVERLAP GRID ENGINE
    // =========================================================================

    //! Compute safe horizontal pixel width inside circular bezel across [yTop..yBot]
    private function getSafeWidthAtY(w as Number, h as Number, yTop as Number, yBot as Number) as Number {
        var minDim = (w < h) ? w : h;
        var r = (minDim / 2) - 8;
        var cy = h / 2;
        var dTop = (yTop > cy) ? (yTop - cy) : (cy - yTop);
        var dBot = (yBot > cy) ? (yBot - cy) : (cy - yBot);
        var dy = (dTop > dBot) ? dTop : dBot;
        if (dy >= (r - 12)) {
            return (w * 42) / 100;
        }
        var sq = (r * r) - (dy * dy);
        var halfChord = Math.sqrt(sq.toFloat()).toNumber();
        var safeW = (halfChord * 2) - 8;
        var capW = w - 16;
        return (safeW < capW) ? safeW : capW;
    }

    //! True only if string contains glyphs supported by Garmin FONT_NUMBER_* fonts
    private function isNumericFontSafe(text as String) as Boolean {
        if (text.length() == 0) {
            return false;
        }
        var chars = text.toCharArray();
        for (var i = 0; i < chars.size(); i++) {
            var c = chars[i];
            var ok = ((c >= '0' && c <= '9') || c == ':' || c == '.' || c == '-' || c == '+' || c == ' ');
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    private function isNumberFont(f as Graphics.FontDefinition) as Boolean {
        return (f == Graphics.FONT_NUMBER_MILD ||
                f == Graphics.FONT_NUMBER_MEDIUM ||
                f == Graphics.FONT_NUMBER_HOT ||
                f == Graphics.FONT_NUMBER_THAI_HOT);
    }

    //! Select largest candidate font that fits strictly inside (maxW x maxH)
    private function fitFontToBox(
        dc as Graphics.Dc,
        text as String,
        candidates as Array<Graphics.FontDefinition>,
        maxW as Number,
        maxH as Number
    ) as Graphics.FontDefinition {
        var numSafe = isNumericFontSafe(text);
        for (var i = 0; i < candidates.size(); i++) {
            var f = candidates[i];
            if (isNumberFont(f) && !numSafe) {
                continue;
            }
            var tw = dc.getTextWidthInPixels(text, f);
            var th = dc.getFontHeight(f);
            if (tw <= maxW && th <= maxH) {
                return f;
            }
        }
        return Graphics.FONT_XTINY;
    }

    //! Truncate text cleanly so it never overflows maxW in given font
    private function truncateToWidth(dc as Graphics.Dc, text as String, font as Graphics.FontDefinition, maxW as Number) as String {
        if (dc.getTextWidthInPixels(text, font) <= maxW || text.length() <= 3) {
            return text;
        }
        var cur = text;
        while (cur.length() > 3 && dc.getTextWidthInPixels(cur + "..", font) > maxW) {
            var nextSub = cur.substring(0, cur.length() - 1);
            if (nextSub == null) {
                break;
            }
            cur = nextSub;
        }
        return cur + "..";
    }

    //! Render a single Garmin Grid Cell with disjoint Label [top] and Value [centered in remaining height]
    private function drawGridCell(
        dc as Graphics.Dc,
        cellCx as Number,
        cellTop as Number,
        cellW as Number,
        cellH as Number,
        label as String,
        valStr as String,
        colors as Array<Number>
    ) as Void {
        var lblFont = Graphics.FONT_XTINY;
        var lblH = dc.getFontHeight(lblFont);
        var safeLbl = truncateToWidth(dc, label, lblFont, cellW - 2);

        dc.setColor(colors[0], Graphics.COLOR_TRANSPARENT);
        dc.drawText(cellCx, cellTop, lblFont, safeLbl, Graphics.TEXT_JUSTIFY_CENTER);

        var valTop = cellTop + lblH;
        var valH = (cellTop + cellH) - valTop;
        if (valH < 10) {
            valH = 10;
        }
        var fontCandidates = [
            Graphics.FONT_NUMBER_MEDIUM,
            Graphics.FONT_NUMBER_MILD,
            Graphics.FONT_LARGE,
            Graphics.FONT_MEDIUM,
            Graphics.FONT_SMALL,
            Graphics.FONT_TINY,
            Graphics.FONT_XTINY
        ] as Array<Graphics.FontDefinition>;
        var valFont = fitFontToBox(dc, valStr, fontCandidates, cellW - 4, valH + 2);
        var safeVal = valStr;
        if (valFont == Graphics.FONT_XTINY) {
            safeVal = truncateToWidth(dc, valStr, valFont, cellW - 2);
        }

        dc.setColor(colors[1], Graphics.COLOR_TRANSPARENT);
        dc.drawText(cellCx, valTop + (valH / 2), valFont, safeVal, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! Render a standard Garmin 2x2 Crosshair Data Grid inside [topY..botY] (4 quadrants: TL, TR, BL, BR)
    private function drawGarminGrid2x2(
        dc as Graphics.Dc,
        topY as Number,
        botY as Number,
        labels as Array<String>,
        values as Array<String>,
        labelCols as Array<Number>,
        valCols as Array<Number>
    ) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var midY = topY + ((botY - topY) / 2);
        var lineMargin = (w * 9) / 100;

        // Garmin crosshair grid lines + center accent node
        dc.setPenWidth(1);
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(lineMargin, midY, w - lineMargin, midY);
        dc.drawLine(cx, topY + 3, cx, botY - 3);

        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, midY, 3);

        // Top Row Quadrants
        var topCellTop = topY + 2;
        var topCellH = midY - topCellTop - 2;
        var topSafeRowW = getSafeWidthAtY(w, h, topCellTop, midY - 2) - 10;
        var topHalfW = (topSafeRowW / 2) - 4;
        var topLeftCx = cx - (topHalfW / 2) - 3;
        var topRightCx = cx + (topHalfW / 2) + 3;

        drawGridCell(dc, topLeftCx, topCellTop, topHalfW, topCellH, labels[0], values[0], [labelCols[0], valCols[0]] as Array<Number>);
        drawGridCell(dc, topRightCx, topCellTop, topHalfW, topCellH, labels[1], values[1], [labelCols[1], valCols[1]] as Array<Number>);

        // Bottom Row Quadrants
        var botCellTop = midY + 2;
        var botCellH = botY - botCellTop - 2;
        var botSafeRowW = getSafeWidthAtY(w, h, botCellTop, botY - 2) - 10;
        var botHalfW = (botSafeRowW / 2) - 4;
        var botLeftCx = cx - (botHalfW / 2) - 3;
        var botRightCx = cx + (botHalfW / 2) + 3;

        drawGridCell(dc, botLeftCx, botCellTop, botHalfW, botCellH, labels[2], values[2], [labelCols[2], valCols[2]] as Array<Number>);
        drawGridCell(dc, botRightCx, botCellTop, botHalfW, botCellH, labels[3], values[3], [labelCols[3], valCols[3]] as Array<Number>);
    }

    //! Right-edge Garmin Vertical Page Carousel Indicator (ported from rower.iq)
    private function drawRightPageCarousel(dc as Graphics.Dc, w as Number, h as Number, totalPages as Number, activePage as Number) as Void {
        if (totalPages <= 1) {
            return;
        }
        var x = w - 8;
        var cy = h / 2;
        var spacing = 11;
        var startY = cy - (((totalPages - 1) * spacing) / 2);

        for (var i = 0; i < totalPages; i++) {
            var y = startY + (i * spacing);
            if (i == activePage) {
                dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(x - 2, y - 4, 5, 9, 2);
            } else {
                dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, 2);
            }
        }
    }

    //! Outer 240-degree Segmented Perimeter Progress Ring (210 deg clockwise to 330 deg)
    private function drawPerimeterProgressRing(dc as Graphics.Dc, w as Number, h as Number, ratio as Float) as Void {
        var minDim = (w < h) ? w : h;
        var r = (minDim / 2) - 3;
        if (r < 50) {
            return;
        }
        var cx = w / 2;
        var cy = h / 2;

        dc.setPenWidth(4);
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawArc(cx, cy, r, Graphics.ARC_CLOCKWISE, 210, 330);

        var clamped = ratio;
        if (clamped < 0.0f) { clamped = 0.0f; }
        if (clamped > 1.0f) { clamped = 1.0f; }

        if (clamped > 0.01f) {
            var sweepDeg = (clamped * 240.0f).toNumber();
            if (sweepDeg < 3) {
                sweepDeg = 3;
            }
            var endDeg = 210 - sweepDeg;
            if (endDeg < 0) {
                endDeg += 360;
            }
            var arcCol = (clamped >= 0.85f) ? COL_GOOD : ((clamped >= 0.40f) ? COL_ACCENT : COL_CYAN);
            dc.setPenWidth(5);
            dc.setColor(arcCol, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(cx, cy, r, Graphics.ARC_CLOCKWISE, 210, endDeg);
        }
        dc.setPenWidth(1);
    }

    private function getBleProtocolTag() as String {
        if (_model.connectionState == RowerDataModel.STATE_CONNECTED_SMARTROW) {
            return "[SmartRow] " + _model.deviceName;
        } else if (_model.connectionState == RowerDataModel.STATE_CONNECTED_FTMS) {
            return "[FTMS] " + _model.deviceName;
        } else if (_model.connectionState == RowerDataModel.STATE_CONNECTING) {
            return "BLE... " + _model.deviceName;
        }
        return "BLE Scan...";
    }

    // =========================================================================
    // G1 : CONNEXION RAMEUR BLE (Ported & Refined from rower.iq PreWorkoutScreen)
    // =========================================================================
    private function drawG1ConnectionScreen(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;
        var minDim = (w < h) ? w : h;
        var isConnected = _model.isConnected();

        // 1. Top Status Bar (6%..15% h): Clock | Athlete Login | HR / BLE
        var topY = (h * 6) / 100;
        var clockTime = System.getClockTime();
        var clockStr = clockTime.hour.format("%d") + ":" + clockTime.min.format("%02d");

        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText((w * 16) / 100, topY, Graphics.FONT_XTINY, clockStr, Graphics.TEXT_JUSTIFY_LEFT);

        var playerTag = _userId;
        dc.setColor(COL_CYAN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, topY, Graphics.FONT_XTINY, truncateToWidth(dc, playerTag, Graphics.FONT_XTINY, (w * 44) / 100), Graphics.TEXT_JUSTIFY_CENTER);

        if (_model.heartRate > 0) {
            dc.setColor(COL_ALERT, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w - ((w * 16) / 100), topY, Graphics.FONT_XTINY, "HR " + _model.heartRate, Graphics.TEXT_JUSTIFY_RIGHT);
        } else {
            dc.setColor(COL_GOOD, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w - ((w * 16) / 100), topY, Graphics.FONT_XTINY, "BLE", Graphics.TEXT_JUSTIFY_RIGHT);
        }

        var divY = (h * 16) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 20) / 100, divY, w - ((w * 20) / 100), divY);

        if (!isConnected) {
            // STATE A: SCANNING / CONNECTING RADAR
            var vY = (h * 33) / 100;
            var voyantR = (minDim * 10) / 100;
            var pulsePhase = (System.getTimer() / 300) % 4;

            dc.setColor(COL_CYAN, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
            dc.drawCircle(cx, vY, voyantR);

            dc.setPenWidth(2);
            dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
            var sweepStart = pulsePhase * 90;
            dc.drawArc(cx, vY, voyantR + 7, Graphics.ARC_CLOCKWISE, sweepStart, sweepStart + 70);

            var dotCol = (pulsePhase % 2 == 0) ? COL_WARN : COL_CYAN;
            dc.setColor(dotCol, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(cx, vY, (voyantR * 5) / 10);
            dc.setPenWidth(1);

            // Title row (48..60% h)
            var statusTitle = (_model.connectionState == RowerDataModel.STATE_CONNECTING)
                ? I18n.getText("PRE_CONNECTING")
                : I18n.getText("PRE_SEARCH_TITLE");
            var titleBoxTop = (h * 48) / 100;
            var titleBoxH = (h * 13) / 100;
            var titleMaxW = getSafeWidthAtY(w, h, titleBoxTop, titleBoxTop + titleBoxH);
            var titleFont = fitFontToBox(dc, statusTitle, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>, titleMaxW, titleBoxH);
            dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, titleBoxTop + (titleBoxH / 2), titleFont, statusTitle, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // Subtitle row (62..72% h)
            var subStr = (_model.connectionState == RowerDataModel.STATE_CONNECTING)
                ? _model.deviceName
                : I18n.getText("PRE_SEARCH_SUB");
            var subTop = (h * 62) / 100;
            var subMaxW = getSafeWidthAtY(w, h, subTop, subTop + ((h * 10) / 100));
            dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, subTop, Graphics.FONT_XTINY, truncateToWidth(dc, subStr, Graphics.FONT_XTINY, subMaxW), Graphics.TEXT_JUSTIFY_CENTER);

            // Bottom hint box (76..88% h)
            var hintY = (h * 77) / 100;
            var hintH = (h * 11) / 100;
            var hintW = getSafeWidthAtY(w, h, hintY, hintY + hintH) - 8;
            dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(cx - (hintW / 2), hintY, hintW, hintH, 6);
            dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
            var hintStr = truncateToWidth(dc, I18n.getText("PRE_HINT_WAKE"), Graphics.FONT_XTINY, hintW - 8);
            dc.drawText(cx, hintY + (hintH / 2), Graphics.FONT_XTINY, hintStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            // STATE B: ROWER DETECTED / READY (GREEN CHECKMARK + DEVICE CARD + START CTA)
            var vY2 = (h * 27) / 100;
            var r2 = (minDim * 9) / 100;

            dc.setColor(COL_GOOD, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(cx, vY2, r2);

            dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
            dc.drawLine(cx - 6, vY2, cx - 2, vY2 + 4);
            dc.drawLine(cx - 2, vY2 + 4, cx + 7, vY2 - 5);
            dc.setPenWidth(1);

            // Protocol + Ready Header (38..48% h)
            var protoTag = (_model.connectionState == RowerDataModel.STATE_CONNECTED_SMARTROW)
                ? "SMARTROW"
                : "FTMS";
            var protoStr = I18n.getText("PRE_READY_TITLE") + " (" + protoTag + ")";
            dc.setColor(COL_GOOD, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (h * 39) / 100, Graphics.FONT_XTINY, truncateToWidth(dc, protoStr, Graphics.FONT_XTINY, getSafeWidthAtY(w, h, (h * 39) / 100, (h * 47) / 100)), Graphics.TEXT_JUSTIFY_CENTER);

            // Rower Name Card or Live Data Preview (48..62% h)
            var cardY = (h * 48) / 100;
            var cardH = (h * 14) / 100;
            var cardW = getSafeWidthAtY(w, h, cardY, cardY + cardH) - 12;
            dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(cx - (cardW / 2), cardY, cardW, cardH, 6);

            var hasLiveMovement = (_model.instantPower > 0 || _model.strokeRate > 0.0f || _model.instantPace > 0);
            if (hasLiveMovement) {
                var previewStr = _model.instantPower + "W | " + _model.strokeRate.format("%.0f") + " SPM";
                if (_model.instantPace > 0) {
                    var m = _model.instantPace / 60;
                    var s = _model.instantPace % 60;
                    previewStr = previewStr + " | " + m + ":" + s.format("%02d");
                }
                var prevFont = fitFontToBox(dc, previewStr, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>, cardW - 10, cardH - 4);
                dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, cardY + (cardH / 2), prevFont, truncateToWidth(dc, previewStr, prevFont, cardW - 10), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            } else {
                var devName = (_model.deviceName.length() > 0) ? _model.deviceName : "BLE Rower";
                var nameFont = fitFontToBox(dc, devName, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>, cardW - 10, cardH - 4);
                dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, cardY + (cardH / 2), nameFont, truncateToWidth(dc, devName, nameFont, cardW - 10), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            // Green START Button (65..79% h)
            var btnY = (h * 65) / 100;
            var btnH = (h * 14) / 100;
            var btnW = getSafeWidthAtY(w, h, btnY, btnY + btnH) - 24;
            dc.setColor(COL_GOOD, COL_GOOD);
            dc.fillRoundedRectangle(cx - (btnW / 2), btnY, btnW, btnH, 8);

            var btnLabel = "> " + I18n.getText("PRE_START_BTN") + " <";
            var btnFont = fitFontToBox(dc, btnLabel, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>, btnW - 10, btnH - 4);
            dc.setColor(COL_BG, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, btnY + (btnH / 2), btnFont, btnLabel, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            // Footer prompt (83% h)
            var footY = (h * 83) / 100;
            var footMaxW = getSafeWidthAtY(w, h, footY, footY + 18);
            dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, footY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PRE_START_PROMPT"), Graphics.FONT_XTINY, footMaxW), Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // =========================================================================
    // STANDARD GARMIN LIST MENU ENGINE (G2 Menu, Pause, Late Choice, Bots, Auth)
    // =========================================================================
    private function drawGarminMenuScreen(
        dc as Graphics.Dc,
        title as String,
        titleCol as Number,
        subtitle as String,
        items as Array<String>,
        selectedIdx as Number,
        footerText as String
    ) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        // Header band (5..19% h)
        var titleY = (h * 5) / 100;
        var titleMaxW = getSafeWidthAtY(w, h, titleY, titleY + 18);
        dc.setColor(titleCol, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, titleY, Graphics.FONT_XTINY, truncateToWidth(dc, title, Graphics.FONT_XTINY, titleMaxW), Graphics.TEXT_JUSTIFY_CENTER);

        if (subtitle.length() > 0) {
            var subY = (h * 12) / 100;
            var subMaxW = getSafeWidthAtY(w, h, subY, subY + 16);
            dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, subY, Graphics.FONT_XTINY, truncateToWidth(dc, subtitle, Graphics.FONT_XTINY, subMaxW), Graphics.TEXT_JUSTIFY_CENTER);
        }

        var divY = (h * 19) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 16) / 100, divY, w - ((w * 16) / 100), divY);

        // Body list area (21..81% h)
        var listTop = (h * 21) / 100;
        var listBot = (h * 81) / 100;
        var count = items.size();
        if (count > 0) {
            var slotH = (listBot - listTop) / count;
            var pillH = slotH - 4;
            if (pillH > ((h * 16) / 100)) {
                pillH = (h * 16) / 100;
            }

            for (var i = 0; i < count; i++) {
                var slotCenterY = listTop + (i * slotH) + (slotH / 2);
                var pillTop = slotCenterY - (pillH / 2);
                var safeW = getSafeWidthAtY(w, h, pillTop, pillTop + pillH) - 18;
                var pillLeft = cx - (safeW / 2);
                var isSel = (i == selectedIdx);

                if (isSel) {
                    dc.setColor(COL_PILL_BG, COL_PILL_BG);
                    dc.fillRoundedRectangle(pillLeft, pillTop, safeW, pillH, 6);
                    dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
                    dc.drawRoundedRectangle(pillLeft, pillTop, safeW, pillH, 6);
                }

                var itemFont = fitFontToBox(
                    dc,
                    items[i],
                    [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>,
                    safeW - 14,
                    pillH - 2
                );
                var itemText = truncateToWidth(dc, items[i], itemFont, safeW - 14);
                dc.setColor(isSel ? COL_PRIMARY : COL_MUTED, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, slotCenterY, itemFont, itemText, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }

            drawRightPageCarousel(dc, w, h, count, selectedIdx);
        }

        // Footer hint (84% h)
        var footY = (h * 84) / 100;
        var footMaxW = getSafeWidthAtY(dc.getWidth(), dc.getHeight(), footY, footY + 16);
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 22) / 100, (h * 82) / 100, w - ((w * 22) / 100), (h * 82) / 100);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footY, Graphics.FONT_XTINY, truncateToWidth(dc, footerText, Graphics.FONT_XTINY, footMaxW), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // =========================================================================
    // G3 : SAISIE CODE PIN ALPHANUMERIQUE 5 CARACTERES (0..9 + A..Z)
    // =========================================================================
    private function drawG3PinInput(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;

        // Title (6% h)
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 5) / 100, Graphics.FONT_XTINY, I18n.getText("PIN_TITLE"), Graphics.TEXT_JUSTIFY_CENTER);

        // Player Login display (12% h)
        var playerText = I18n.getText("PLAYER_LABEL") + " " + _userId;
        var pY = (h * 12) / 100;
        var pW = getSafeWidthAtY(w, h, pY, pY + 16);
        dc.setColor(COL_CYAN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, pY, Graphics.FONT_XTINY, truncateToWidth(dc, playerText, Graphics.FONT_XTINY, pW), Graphics.TEXT_JUSTIFY_CENTER);

        // Subtitle (18% h)
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        var subY = (h * 19) / 100;
        var subW = getSafeWidthAtY(w, h, subY, subY + 16);
        dc.drawText(cx, subY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PIN_SUB"), Graphics.FONT_XTINY, subW), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 18) / 100, (h * 27) / 100, w - ((w * 18) / 100), (h * 27) / 100);

        // 5 Proportional Alphanumeric Character Cards in [30..62% h]
        var boxY = (h * 30) / 100;
        var boxH = (h * 30) / 100;
        var availW = getSafeWidthAtY(w, h, boxY, boxY + boxH) - 14;
        var gap = (w * 2) / 100;
        var boxW = (availW - (4 * gap)) / 5;
        var totalRowW = (5 * boxW) + (4 * gap);
        var startX = cx - (totalRowW / 2);

        // Candidate fonts for alphanumeric glyphs (never use FONT_NUMBER_* for A-Z)
        var charCandidates = [
            Graphics.FONT_LARGE,
            Graphics.FONT_MEDIUM,
            Graphics.FONT_SMALL,
            Graphics.FONT_TINY
        ] as Array<Graphics.FontDefinition>;

        for (var i = 0; i < 5; i++) {
            var bx = startX + (i * (boxW + gap));
            var isCurrent = (i == _pinCurrentDigitIdx);
            var charIdx = _pinIndices[i];
            var cStr = PIN_CHARSET[charIdx];
            var cFont = fitFontToBox(dc, cStr, charCandidates, boxW - 4, boxH - 6);

            if (isCurrent) {
                dc.setColor(COL_ACCENT, COL_ACCENT);
                dc.fillRoundedRectangle(bx, boxY, boxW, boxH, 6);
                dc.setColor(COL_BG, Graphics.COLOR_TRANSPARENT);
            } else {
                dc.setColor(COL_GRID, COL_GRID);
                dc.fillRoundedRectangle(bx, boxY, boxW, boxH, 6);
                dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
            }

            dc.drawText(bx + (boxW / 2), boxY + (boxH / 2), cFont, cStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        var h1Y = (h * 68) / 100;
        var h2Y = (h * 79) / 100;
        dc.setColor(COL_WARN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h1Y, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PIN_HELP_1"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, h1Y, h1Y + 16)), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h2Y, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PIN_HELP_2"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, h2Y, h2Y + 16)), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // =========================================================================
    // EN ATTENTE DE VALIDATION PAR L'HÔTE (SALON PRIVÉ)
    // =========================================================================
    private function drawPendingApprovalScreen(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;
        var minDim = (w < h) ? w : h;

        // 1. Header (5..14% h)
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 5) / 100, Graphics.FONT_XTINY, I18n.getText("PIN_TITLE"), Graphics.TEXT_JUSTIFY_CENTER);

        // Athlete Login display (12..19% h)
        _userId = UserManager.getUserId();
        var userStr = "ID Web: " + _userId;
        var userMaxW = getSafeWidthAtY(w, h, (h * 12) / 100, (h * 12) / 100 + 16);
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 12) / 100, Graphics.FONT_XTINY, truncateToWidth(dc, userStr, Graphics.FONT_XTINY, userMaxW), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 18) / 100, (h * 20) / 100, w - ((w * 18) / 100), (h * 20) / 100);

        // 2. Animated Pulsing Radar Indicator (22..45% h)
        var pulseCenterY = (h * 34) / 100;
        var circleR = (minDim * 11) / 100;
        var animPhase = (System.getTimer() / 250) % 6;

        dc.setPenWidth(3);
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, pulseCenterY, circleR);

        dc.setColor(COL_WARN, Graphics.COLOR_TRANSPARENT);
        var arcAngle = animPhase * 60;
        dc.drawArc(cx, pulseCenterY, circleR + 4, Graphics.ARC_CLOCKWISE, arcAngle, arcAngle + 90);

        var coreR = (circleR * 4) / 10 + (animPhase % 3);
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, pulseCenterY, coreR);
        dc.setPenWidth(1);

        // 3. Status Title & Subtitle (49..73% h)
        var titleY = (h * 50) / 100;
        dc.setColor(COL_WARN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, titleY, Graphics.FONT_MEDIUM, I18n.getText("PENDING_TITLE"), Graphics.TEXT_JUSTIFY_CENTER);

        var subY = (h * 64) / 100;
        var subMaxW = getSafeWidthAtY(w, h, subY, subY + 16);
        dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, subY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PENDING_SUB"), Graphics.FONT_XTINY, subMaxW), Graphics.TEXT_JUSTIFY_CENTER);

        var hintY = (h * 73) / 100;
        var hintMaxW = getSafeWidthAtY(w, h, hintY, hintY + 16);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, hintY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PENDING_HINT"), Graphics.FONT_XTINY, hintMaxW), Graphics.TEXT_JUSTIFY_CENTER);

        // 4. Footer hint (85% h)
        var footY = (h * 85) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 22) / 100, (h * 83) / 100, w - ((w * 22) / 100), (h * 83) / 100);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footY, Graphics.FONT_XTINY, "BACK : Annuler", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // =========================================================================
    // G4 : SALLE D'ATTENTE / LOBBY EN GRILLE GARMIN (1 Hero + Grille 2x2)
    // =========================================================================
    private function drawG4LobbyGrid(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;

        // 1. Header (5..17% h)
        var hdrY = (h * 5) / 100;
        var hdrText = (_nextRaceCountdown <= 15) ? I18n.getText("GET_READY") : I18n.getText("LOBBY_TITLE");
        var hdrCol = (_nextRaceCountdown <= 15) ? COL_WARN : COL_ACCENT;
        dc.setColor(hdrCol, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, hdrY, Graphics.FONT_XTINY, truncateToWidth(dc, hdrText, Graphics.FONT_XTINY, getSafeWidthAtY(w, h, hdrY, hdrY + 16)), Graphics.TEXT_JUSTIFY_CENTER);

        _userId = UserManager.getUserId();
        var playerText = "ID Web: " + _userId;
        var playerY = (h * 11) / 100;
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, playerY, Graphics.FONT_XTINY, truncateToWidth(dc, playerText, Graphics.FONT_XTINY, getSafeWidthAtY(w, h, playerY, playerY + 16)), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 16) / 100, (h * 17) / 100, w - ((w * 16) / 100), (h * 17) / 100);

        // 2. Hero Countdown Timer Band (18..42% h)
        var heroTop = (h * 18) / 100;
        var heroH = (h * 24) / 100;
        var timeStr = _model.formatTime(_nextRaceCountdown);
        var heroMaxW = getSafeWidthAtY(w, h, heroTop, heroTop + heroH) - 16;
        var heroFont = fitFontToBox(
            dc,
            timeStr,
            [Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE, Graphics.FONT_MEDIUM] as Array<Graphics.FontDefinition>,
            heroMaxW,
            heroH
        );
        dc.setColor((_nextRaceCountdown <= 15) ? COL_WARN : COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, heroTop + (heroH / 2), heroFont, timeStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // 3. Garmin 2x2 Lobby & Career Stats Grid (43..81% h)
        var gTop = (h * 43) / 100;
        var gBot = (h * 81) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 10) / 100, gTop, w - ((w * 10) / 100), gTop);

        var racersStr = _hasBotsEnabled ? ("" + _connectedPlayers + "+B") : ("" + _connectedPlayers);
        var targetStr = "" + _targetDistance;
        var rankPtsStr = (_userPoints > 0)
            ? ("#" + _userGeneralRank + " / " + _userPoints + "p")
            : ("#" + _userGeneralRank + "/" + _userTotalPlayers);
        var lastPart = (_userLastRank > 0) ? ("#" + _userLastRank) : "--";
        var bestPart = (_userBestRank > 0) ? ("#" + _userBestRank) : "--";
        var lastBestStr = lastPart + " / " + bestPart;

        drawGarminGrid2x2(
            dc, gTop, gBot,
            [I18n.getText("CELL_RACERS"), I18n.getText("CELL_TARGET"), I18n.getText("CELL_RANK_PTS"), I18n.getText("CELL_LAST_BEST")] as Array<String>,
            [racersStr, targetStr, rankPtsStr, lastBestStr] as Array<String>,
            [COL_GOOD, COL_CYAN, COL_ACCENT, COL_WARN] as Array<Number>,
            [COL_PRIMARY, COL_PRIMARY, COL_PRIMARY, COL_PRIMARY] as Array<Number>
        );

        // 4. Footer (83..95% h)
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 20) / 100, (h * 82) / 100, w - ((w * 20) / 100), (h * 82) / 100);

        var footY = (h * 84) / 100;
        var footText = I18n.getText("AUTO_START_AT_ZERO");
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footY, Graphics.FONT_XTINY, truncateToWidth(dc, footText, Graphics.FONT_XTINY, getSafeWidthAtY(w, h, footY, footY + 16)), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // =========================================================================
    // G5 : DECOMPTE SYNCHRONE 5 SECONDES (Chiffre pur dans FONT_NUMBER_*)
    // =========================================================================
    private function drawG5Countdown(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;
        var cy = h / 2;
        var minDim = (w < h) ? w : h;

        // Alert bezel ring
        dc.setPenWidth(6);
        dc.setColor(COL_ALERT, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, cy, (minDim / 2) - 4);
        dc.setPenWidth(1);

        var topY = (h * 14) / 100;
        dc.setColor(COL_WARN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, topY, Graphics.FONT_SMALL, truncateToWidth(dc, I18n.getText("COUNTDOWN_TITLE"), Graphics.FONT_SMALL, getSafeWidthAtY(w, h, topY, topY + 24)), Graphics.TEXT_JUSTIFY_CENTER);

        // Pure numeric string so FONT_NUMBER_THAI_HOT / FONT_NUMBER_HOT renders cleanly on all watches
        var numStr = _countdown5sValue.toString();
        var numBoxH = (h * 46) / 100;
        var numFont = fitFontToBox(
            dc,
            numStr,
            [Graphics.FONT_NUMBER_THAI_HOT, Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_LARGE] as Array<Graphics.FontDefinition>,
            (w * 60) / 100,
            numBoxH
        );
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy, numFont, numStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var botY = (h * 79) / 100;
        dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, botY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("COUNTDOWN_HOLD"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, botY, botY + 18)), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // =========================================================================
    // G6 / G7 : COCKPIT DE COURSE EN GRILLE GARMIN (2 PAGES + ARC PERIMETRIQUE)
    // =========================================================================
    private function drawG6RacingCockpit(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;

        // 1. Outer 240 deg Perimeter Progress Ring
        drawPerimeterProgressRing(dc, w, h, _progressPercent);

        // 2. Top Sport Header Band (5..18% h): REC Dot + Rank/Mode + Chrono
        var hdrTop = (h * 5) / 100;
        var hdrBot = (h * 17) / 100;
        var hdrCy = hdrTop + ((hdrBot - hdrTop) / 2);
        var hdrMaxW = getSafeWidthAtY(w, h, hdrTop, hdrBot) - 18;

        var modePrefix = "P" + _currentRank + "/" + _totalRacers;
        if (_raceMode.equals("solo")) {
            modePrefix = "SOLO";
        } else if (_isLateJoiner) {
            modePrefix = "LATE P" + _currentRank;
        }
        var remSec = _gameRemainingSeconds;
        if (_model.elapsedTime > 0 && remSec > _model.elapsedTime) {
            remSec = remSec - _model.elapsedTime;
        }
        if (remSec < 0) { remSec = 0; }
        var headerStr = modePrefix + "  " + _model.formatTime(_model.elapsedTime) + "  " + _model.formatTime(remSec);
        var hdrFont = fitFontToBox(dc, headerStr, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>, hdrMaxW, hdrBot - hdrTop);

        var textW = dc.getTextWidthInPixels(headerStr, hdrFont);
        var dotX = cx - (textW / 2) - 8;
        dc.setColor(COL_GOOD, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(dotX, hdrCy, 4);

        dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, hdrCy, hdrFont, headerStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var divTopY = (h * 18) / 100;
        var divBotY = (h * 82) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 15) / 100, divTopY, w - ((w * 15) / 100), divTopY);

        // 3. Central 2x2 Garmin Data Grid (18..82% h)
        if (_racePage == 0) {
            // PAGE 1: Primary Race Grid [PACE | POWER] / [DISTANCE | GAP or REMAINING]
            var dispPace = (_model.instantPace > 0) ? _model.instantPace : _model.avgPace;
            var paceStr = _model.formatPace(dispPace);
            var dispPower = (_model.instantPower > 0) ? _model.instantPower : ((!_model.isHalted && _model.avgPower > 0) ? _model.avgPower : 0);
            var powerStr = dispPower.format("%d");
            var distStr = _netDistance.format("%d");

            var brLabel = I18n.getText("GRID_GAP");
            var brVal = "--";
            var brValCol = COL_PRIMARY;

            if (_raceMode.equals("solo")) {
                brLabel = I18n.getText("GRID_REM");
                var rem = _targetDistance - _netDistance;
                if (rem < 0) { rem = 0; }
                brVal = rem.format("%d");
            } else if (_currentRank <= 1 && !_isLateJoiner) {
                brVal = I18n.getText("HUD_LEADER");
                brValCol = COL_GOOD;
            } else {
                brVal = "-" + _distToLeader.format("%d");
                brValCol = COL_WARN;
            }

            drawGarminGrid2x2(
                dc, divTopY, divBotY,
                [I18n.getText("GRID_PACE"), I18n.getText("GRID_POWER"), I18n.getText("GRID_DIST"), brLabel] as Array<String>,
                [paceStr, powerStr, distStr, brVal] as Array<String>,
                [COL_ACCENT, COL_GOOD, COL_CYAN, COL_WARN] as Array<Number>,
                [COL_PRIMARY, COL_PRIMARY, COL_PRIMARY, brValCol] as Array<Number>
            );
        } else {
            // PAGE 2: Tactical Gaps / Biomechanics & Session Averages Grid
            var tlLbl = I18n.getText("GRID_PREV");
            var tlVal = "--";
            var trLbl = I18n.getText("GRID_NEXT");
            var trVal = "--";

            if (_raceMode.equals("solo")) {
                tlLbl = I18n.getText("GRID_WORK");
                tlVal = _model.work.format("%.0f");
                trLbl = I18n.getText("GRID_FORCE");
                trVal = _model.force.format("%d");
            } else {
                if (_currentRank > 1) {
                    tlVal = "-" + _distToPrev.format("%d");
                } else {
                    tlVal = "LEAD";
                }
                if (_currentRank < _totalRacers) {
                    trVal = "+" + _distToNext.format("%d");
                } else {
                    trVal = "DERN";
                }
            }

            var avgPaceVal = _model.formatPace(_model.getEffectiveAvgPace(_model.elapsedTime));
            var avgPowVal = _model.avgPower.format("%d");

            drawGarminGrid2x2(
                dc, divTopY, divBotY,
                [tlLbl, trLbl, I18n.getText("GRID_AVG_PACE"), I18n.getText("GRID_AVG_POWER")] as Array<String>,
                [tlVal, trVal, avgPaceVal, avgPowVal] as Array<String>,
                [COL_WARN, COL_GOOD, COL_ACCENT, COL_CYAN] as Array<Number>,
                [COL_PRIMARY, COL_PRIMARY, COL_PRIMARY, COL_PRIMARY] as Array<Number>
            );
        }

        // 4. Bottom Compact Telemetry Pill (82..94% h)
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 20) / 100, divBotY, w - ((w * 20) / 100), divBotY);

        var footTop = (h * 83) / 100;
        var footBot = (h * 94) / 100;
        var footMaxW = getSafeWidthAtY(w, h, footTop, footBot) - 6;
        var footStr = "";
        if (_racePage == 0) {
            var spmVal = (_model.strokeRate > 0.0f) ? _model.strokeRate.format("%.0f") : "0";
            var hrVal = (_model.heartRate > 0) ? (_model.heartRate.format("%d") + " bpm") : "-- bpm";
            footStr = spmVal + " spm  |  " + hrVal;
        } else {
            footStr = _model.strokeCount.format("%d") + " " + I18n.getText("FOOT_STROKES") + "  |  " + _model.totalEnergy.format("%d") + " kcal";
        }
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footTop + ((footBot - footTop) / 2), Graphics.FONT_XTINY, truncateToWidth(dc, footStr, Graphics.FONT_XTINY, footMaxW), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // 5. Right-Edge Vertical Garmin Page Carousel (2 pages)
        drawRightPageCarousel(dc, w, h, 2, _racePage);
    }

    // =========================================================================
    // G8 : LIGNE D'ARRIVEE & PODIUM (2 Pages navigables UP/DOWN)
    // =========================================================================
    private function drawG8Finished(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;

        drawPerimeterProgressRing(dc, w, h, 1.0f);

        if (_finishPage == 0) {
            // Page 1: Finish Rank Header + 2x2 Summary Grid
            var hdrY = (h * 5) / 100;
            var rankTag = _raceMode.equals("solo") ? "SOLO" : ("#" + _finalRank);
            var medalStr = "";
            var titleCol = COL_ACCENT;
            if (!_raceMode.equals("solo")) {
                if (_finalRank == 1) {
                    medalStr = "  [OR]";
                    titleCol = COL_ACCENT;
                } else if (_finalRank == 2) {
                    medalStr = "  [ARGENT]";
                    titleCol = COL_PRIMARY;
                } else if (_finalRank == 3) {
                    medalStr = "  [BRONZE]";
                    titleCol = COL_WARN;
                }
            }
            var titleStr = "";
            if (_isAbandoned) {
                titleStr = "A BIENTOT !";
                titleCol = COL_WARN;
            } else {
                titleStr = "BRAVO ! " + rankTag + medalStr;
            }
            dc.setColor(titleCol, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, hdrY, Graphics.FONT_SMALL, truncateToWidth(dc, titleStr, Graphics.FONT_SMALL, getSafeWidthAtY(w, h, hdrY, hdrY + 22)), Graphics.TEXT_JUSTIFY_CENTER);

            var gTop = (h * 19) / 100;
            var gBot = (h * 81) / 100;
            dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
            dc.drawLine((w * 15) / 100, gTop, w - ((w * 15) / 100), gTop);

            var distVal = ((_netDistance > 0) ? _netDistance : _model.totalDistance).format("%d");
            var timeVal = _model.formatTime(_model.elapsedTime);
            var avgPaceVal = _model.formatPace(_model.getEffectiveAvgPace(_model.elapsedTime));
            var avgWattsVal = _model.avgPower.format("%d");

            drawGarminGrid2x2(
                dc, gTop, gBot,
                [I18n.getText("CELL_TIME"), I18n.getText("GRID_DIST"), I18n.getText("GRID_AVG_PACE"), I18n.getText("GRID_AVG_POWER")] as Array<String>,
                [timeVal, distVal, avgPaceVal, avgWattsVal] as Array<String>,
                [COL_GOOD, COL_CYAN, COL_ACCENT, COL_WARN] as Array<Number>,
                [COL_PRIMARY, COL_PRIMARY, COL_PRIMARY, COL_PRIMARY] as Array<Number>
            );
        } else {
            // Page 2: Official Top 3 Podium Rows
            var pHdrY = (h * 7) / 100;
            dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, pHdrY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PODIUM_TITLE"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, pHdrY, pHdrY + 18)), Graphics.TEXT_JUSTIFY_CENTER);

            dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
            dc.drawLine((w * 16) / 100, (h * 18) / 100, w - ((w * 16) / 100), (h * 18) / 100);

            if (_top3Podium.size() == 0) {
                dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, h / 2, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("PODIUM_EMPTY"), Graphics.FONT_XTINY, w - 32), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            } else {
                var listTop = (h * 21) / 100;
                var rowH = (h * 19) / 100;
                for (var i = 0; i < _top3Podium.size() && i < 3; i++) {
                    var entry = _top3Podium[i];
                    var rTop = listTop + (i * rowH);
                    var rW = getSafeWidthAtY(w, h, rTop, rTop + rowH - 4) - 16;
                    var rLeft = cx - (rW / 2);

                    dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
                    dc.drawRoundedRectangle(rLeft, rTop, rW, rowH - 4, 6);

                    var pName = (entry.hasKey("userName") && entry.get("userName") != null)
                        ? entry.get("userName").toString()
                        : ((entry.hasKey("name") && entry.get("name") != null) ? entry.get("name").toString() : "Racer");
                    var pCol = (i == 0) ? COL_ACCENT : ((i == 1) ? COL_PRIMARY : COL_WARN);
                    var medalTag = (i == 0) ? " [OR]" : ((i == 1) ? " [ARGENT]" : " [BRONZE]");
                    var rowLabel = "#" + (i + 1) + " " + pName + medalTag;
                    dc.setColor(pCol, Graphics.COLOR_TRANSPARENT);
                    dc.drawText(cx, rTop + ((rowH - 4) / 2), Graphics.FONT_SMALL, truncateToWidth(dc, rowLabel, Graphics.FONT_SMALL, rW - 12), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                }
            }
        }

        var footY = (h * 84) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 20) / 100, (h * 82) / 100, w - ((w * 20) / 100), (h * 82) / 100);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("FINISH_FOOTER"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, footY, footY + 16)), Graphics.TEXT_JUSTIFY_CENTER);

        drawRightPageCarousel(dc, w, h, 2, _finishPage);
    }

    // =========================================================================
    // G9 : HISTORIQUE LOCAL EN LIGNES DE GRILLE GARMIN
    // =========================================================================
    private function drawG9History(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;

        var hdrY = (h * 7) / 100;
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, hdrY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("HIST_TITLE"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, hdrY, hdrY + 16)), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 16) / 100, (h * 18) / 100, w - ((w * 16) / 100), (h * 18) / 100);

        var historyList = [] as Array<Dictionary>;
        try {
            var raw = Storage.getValue("local_race_history");
            if (raw != null && raw instanceof Array) {
                historyList = raw as Array<Dictionary>;
            }
        } catch (ex) {
        }

        if (historyList.size() == 0) {
            dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("HIST_EMPTY"), Graphics.FONT_XTINY, w - 30), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            var listTop = (h * 20) / 100;
            var rowH = (h * 20) / 100;
            var count = historyList.size();
            var shown = 0;
            // Show up to 3 most recent sessions first
            for (var idx = count - 1; idx >= 0 && shown < 3; idx--) {
                var item = historyList[idx];
                var rTop = listTop + (shown * rowH);
                var rW = getSafeWidthAtY(w, h, rTop, rTop + rowH - 3) - 14;
                var rLeft = cx - (rW / 2);

                dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
                dc.drawRoundedRectangle(rLeft, rTop, rW, rowH - 4, 5);

                var dist = (item.hasKey("distance") && item.get("distance") != null) ? (item.get("distance") as Number) : 0;
                var rk = (item.hasKey("rank") && item.get("rank") != null) ? (item.get("rank") as Number) : 1;
                var tSec = (item.hasKey("timeSec") && item.get("timeSec") != null) ? (item.get("timeSec") as Number) : 0;
                var rowStr = "#" + rk + "  " + dist + "m  |  " + _model.formatTime(tSec);

                var rFont = fitFontToBox(dc, rowStr, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>, rW - 10, rowH - 6);
                dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, rTop + ((rowH - 4) / 2), rFont, truncateToWidth(dc, rowStr, rFont, rW - 10), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                shown += 1;
            }
        }

        var footY = (h * 84) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 20) / 100, (h * 82) / 100, w - ((w * 20) / 100), (h * 82) / 100);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("HIST_FOOTER"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, footY, footY + 16)), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // =========================================================================
    // ECRAN IDENTIFIANT JOUEUR (APPAIRAGE PLATEFORME WEB & MONTRE)
    // =========================================================================
    private function drawPlayerIdScreen(dc as Graphics.Dc, w as Number, h as Number) as Void {
        _userId = UserManager.getUserId();
        var prefix = UserManager.getPrefix();
        var suffix = UserManager.getSuffix();
        var cx = w / 2;

        // Header band (5..18% h)
        var hdrY = (h * 5) / 100;
        var hdrMaxW = getSafeWidthAtY(w, h, hdrY, hdrY + 18);
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, hdrY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("ID_SCREEN_TITLE"), Graphics.FONT_XTINY, hdrMaxW), Graphics.TEXT_JUSTIFY_CENTER);

        var subY = (h * 12) / 100;
        var subMaxW = getSafeWidthAtY(w, h, subY, subY + 16);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, subY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("ID_SCREEN_SUB"), Graphics.FONT_XTINY, subMaxW), Graphics.TEXT_JUSTIFY_CENTER);

        var divY = (h * 19) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 16) / 100, divY, w - ((w * 16) / 100), divY);

        // Center card with Full Player ID (23..56% h)
        var cardTop = (h * 23) / 100;
        var cardH = (h * 32) / 100;
        var safeW = getSafeWidthAtY(w, h, cardTop, cardTop + cardH) - 16;
        var cardLeft = cx - (safeW / 2);

        dc.setColor(COL_PILL_BG, COL_PILL_BG);
        dc.fillRoundedRectangle(cardLeft, cardTop, safeW, cardH, 8);
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawRoundedRectangle(cardLeft, cardTop, safeW, cardH, 8);

        // ID text centered in card
        var idFont = fitFontToBox(
            dc,
            _userId,
            [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>,
            safeW - 12,
            (cardH * 45) / 100
        );
        dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cardTop + (cardH / 3), idFont, _userId, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Sub label inside card: 10 free chars block + encoded suffix
        dc.setColor(COL_GOOD, Graphics.COLOR_TRANSPARENT);
        var tagText = "10 car. | " + suffix;
        dc.drawText(cx, cardTop + ((cardH * 73) / 100), Graphics.FONT_XTINY, truncateToWidth(dc, tagText, Graphics.FONT_XTINY, safeW - 10), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Detail text below card
        var infoY1 = (h * 59) / 100;
        dc.setColor(COL_CYAN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, infoY1, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("ID_SCREEN_PREFIX_HINT"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, infoY1, infoY1 + 16)), Graphics.TEXT_JUSTIFY_CENTER);

        var infoY2 = (h * 68) / 100;
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, infoY2, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("ID_SCREEN_SETTINGS_HINT"), Graphics.FONT_XTINY, getSafeWidthAtY(w, h, infoY2, infoY2 + 16)), Graphics.TEXT_JUSTIFY_CENTER);

        // Footer hint (84% h)
        var footDivY = (h * 81) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 20) / 100, footDivY, w - ((w * 20) / 100), footDivY);

        var footY = (h * 85) / 100;
        var footMaxW = getSafeWidthAtY(w, h, footY, footY + 16);
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footY, Graphics.FONT_XTINY, truncateToWidth(dc, I18n.getText("ID_SCREEN_FOOTER"), Graphics.FONT_XTINY, footMaxW), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // =========================================================================
    // PROPORTIONAL WARNING BANNER OVERLAY
    // =========================================================================
    private function drawWarningBanner(dc as Graphics.Dc, w as Number, h as Number, text as String) as Void {
        var cx = w / 2;
        var cy = h / 2;
        var boxH = (h * 26) / 100;
        if (boxH < 48) { boxH = 48; }
        var boxY = cy - (boxH / 2);
        var boxW = getSafeWidthAtY(w, h, boxY, boxY + boxH) - 12;
        var boxX = cx - (boxW / 2);

        dc.setColor(COL_ALERT, COL_ALERT);
        dc.fillRoundedRectangle(boxX, boxY, boxW, boxH, 8);
        dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        dc.drawRoundedRectangle(boxX, boxY, boxW, boxH, 8);
        dc.setPenWidth(1);

        var mainTop = boxY + 4;
        var mainH = (boxH * 52) / 100;
        var mainFont = fitFontToBox(dc, text, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY] as Array<Graphics.FontDefinition>, boxW - 12, mainH);
        dc.drawText(cx, mainTop + (mainH / 2), mainFont, truncateToWidth(dc, text, mainFont, boxW - 12), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var subText = _falseStartLocked ? I18n.getText("WARN_ZERO_SPEED") : I18n.getText("WARN_WAIT_START");
        var subCy = boxY + ((boxH * 76) / 100);
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, subCy, Graphics.FONT_XTINY, truncateToWidth(dc, subText, Graphics.FONT_XTINY, boxW - 12), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
