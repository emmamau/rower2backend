import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;

//! Composant unique et réutilisable pour la saisie de code alphanumérique sur montre Garmin
//! Utilisé de manière 100% identique pour :
//! - Code d'Appairage (6 caractères, titre "APPAIRAGE")
//! - Code PIN Salon Privé (5 caractères, titre "CODE SALON")
class UnifiedCodePickerView extends WatchUi.View {

    // Palette Garmin Pro Dark Carbon (compatible MIP 64 couleurs & AMOLED)
    private static const COL_BG        = Graphics.COLOR_BLACK;
    private static const COL_PRIMARY   = Graphics.COLOR_WHITE;
    private static const COL_MUTED     = Graphics.COLOR_LT_GRAY;
    private static const COL_GRID      = Graphics.COLOR_DK_GRAY;
    private static const COL_ACCENT    = Graphics.COLOR_YELLOW;
    private static const COL_CYAN      = Graphics.COLOR_BLUE;
    private static const COL_PILL_BG   = Graphics.COLOR_DK_BLUE;

    // Jeu de caractères & ordre cyclique de défilement identique sur les deux flux (0..9 puis A..Z)
    public static const CHARSET as Array<String> = [
        "0","1","2","3","4","5","6","7","8","9",
        "A","B","C","D","E","F","G","H","I","J",
        "K","L","M","N","O","P","Q","R","S","T",
        "U","V","W","X","Y","Z"
    ];

    private var _codeLength as Number;
    private var _screenTitle as String;
    private var _callback as Method?;
    private var _cancelCallback as Method?;
    private var _charIndices as Array<Number>;
    private var _currentSlot as Number = 0;

    //! Constructeur de la vue générique paramétrable
    //! @param codeLength Entier (6 pour l'appairage, 5 pour le salon privé)
    //! @param screenTitle Libellé affiché ("APPAIRAGE" ou "CODE SALON")
    //! @param callback Méthode appelée avec la chaîne complète dès validation du dernier caractère
    public function initialize(codeLength as Number, screenTitle as String, callback as Method?) {
        View.initialize();
        _codeLength = (codeLength > 0) ? codeLength : 5;
        _screenTitle = screenTitle;
        _callback = callback;
        _charIndices = new [_codeLength] as Array<Number>;
        for (var i = 0; i < _codeLength; i++) {
            _charIndices[i] = 0;
        }
        _currentSlot = 0;
    }

    public function setCancelCallback(cancelCb as Method?) as Void {
        _cancelCallback = cancelCb;
    }

    public function getCodeLength() as Number {
        return _codeLength;
    }

    public function getScreenTitle() as String {
        return _screenTitle;
    }

    public function getCurrentSlot() as Number {
        return _currentSlot;
    }

    public function getCurrentChar() as String {
        return CHARSET[_charIndices[_currentSlot]];
    }

    public function getPrevChar() as String {
        var count = CHARSET.size();
        var prevIdx = (_charIndices[_currentSlot] - 1 + count) % count;
        return CHARSET[prevIdx];
    }

    public function getNextChar() as String {
        var count = CHARSET.size();
        var nextIdx = (_charIndices[_currentSlot] + 1) % count;
        return CHARSET[nextIdx];
    }

    public function getSlotDisplayChar(slotIdx as Number) as String {
        if (slotIdx < 0 || slotIdx >= _codeLength) {
            return "_";
        }
        if (slotIdx <= _currentSlot) {
            return CHARSET[_charIndices[slotIdx]];
        }
        return "_";
    }

    //! Remet tous les emplacements à '0' et repositionne le curseur sur la première case
    public function reset() as Void {
        for (var i = 0; i < _codeLength; i++) {
            _charIndices[i] = 0;
        }
        _currentSlot = 0;
        WatchUi.requestUpdate();
    }

    //! Défilement circulaire continu : delta = -1 (UP / Swipe Haut -> précédent), delta = +1 (DOWN / Swipe Bas -> suivant)
    public function cycleChar(delta as Number) as Void {
        var count = CHARSET.size();
        _charIndices[_currentSlot] = (_charIndices[_currentSlot] + delta + count) % count;
        WatchUi.requestUpdate();
    }

    //! Valide le caractère courant et avance à la case suivante.
    //! Si la dernière case est validée, déclenche l'appel du callback et retourne true.
    public function confirmCurrentChar() as Boolean {
        if (_currentSlot < _codeLength - 1) {
            _currentSlot++;
            WatchUi.requestUpdate();
            return false;
        }
        var fullCode = getFormattedCode();
        if (_callback != null) {
            (_callback as Method).invoke(fullCode);
        }
        return true;
    }

    //! Efface le caractère précédent et recule d'une case si index > 0.
    //! Si index == 0, annule la saisie et retourne true.
    public function backspaceOrCancel() as Boolean {
        if (_currentSlot > 0) {
            _charIndices[_currentSlot] = 0;
            _currentSlot--;
            _charIndices[_currentSlot] = 0;
            WatchUi.requestUpdate();
            return false;
        }
        if (_cancelCallback != null) {
            (_cancelCallback as Method).invoke();
        }
        return true;
    }

    //! Retourne la chaîne complète de longueur _codeLength
    public function getFormattedCode() as String {
        var res = "";
        for (var i = 0; i < _codeLength; i++) {
            res += CHARSET[_charIndices[i]];
        }
        return res;
    }

    //! Calcule la largeur horizontale sécurisée dans le cadran circulaire Garmin
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

    //! Rendu visuel strictement identique entre Appairage (6 cases) et Code Salon (5 cases)
    public function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(COL_BG, COL_BG);
        dc.clear();

        renderToDc(dc, w, h);
    }

    //! Méthode de rendu réutilisable (appelée par onUpdate ou par RowerView)
    public function renderToDc(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;

        // 1. En-tête : Titre centré en haut ("APPAIRAGE" ou "CODE SALON")
        var titleY = (h * 7) / 100;
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, titleY, Graphics.FONT_XTINY, _screenTitle, Graphics.TEXT_JUSTIFY_CENTER);

        var divTopY = (h * 17) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 20) / 100, divTopY, w - ((w * 20) / 100), divTopY);

        // 2. Ligne des cases / tirets : _codeLength emplacements horizontaux espacés et parfaitement centrés
        var boxTop = (h * 21) / 100;
        var boxH = (h * 18) / 100;
        var availW = getSafeWidthAtY(w, h, boxTop, boxTop + boxH) - 10;
        var gap = (w * 2) / 100;
        if (gap < 3) { gap = 3; }
        var boxW = (availW - ((_codeLength - 1) * gap)) / _codeLength;
        var maxBoxW = (w * 14) / 100;
        if (boxW > maxBoxW) {
            boxW = maxBoxW;
        }
        var totalRowW = (_codeLength * boxW) + ((_codeLength - 1) * gap);
        var startX = cx - (totalRowW / 2);

        for (var i = 0; i < _codeLength; i++) {
            var bx = startX + (i * (boxW + gap));
            var isCurrent = (i == _currentSlot);
            var isEntered = (i < _currentSlot);

            if (isCurrent) {
                // Emplacement en cours d'édition mis en valeur par un curseur/cadre contrasté
                dc.setColor(COL_PILL_BG, COL_PILL_BG);
                dc.fillRoundedRectangle(bx, boxTop, boxW, boxH, 5);
                dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(2);
                dc.drawRoundedRectangle(bx, boxTop, boxW, boxH, 5);
                dc.setPenWidth(1);

                var curChar = CHARSET[_charIndices[i]];
                dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
                dc.drawText(bx + (boxW / 2), boxTop + (boxH / 2), Graphics.FONT_SMALL, curChar, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            } else if (isEntered) {
                // Caractères déjà saisis affichés en blanc/surbrillance
                dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
                dc.drawRoundedRectangle(bx, boxTop, boxW, boxH, 5);

                var enteredChar = CHARSET[_charIndices[i]];
                dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(bx + (boxW / 2), boxTop + (boxH / 2), Graphics.FONT_SMALL, enteredChar, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            } else {
                // Emplacements restants indiqués par un tiret '_'
                dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
                dc.drawRoundedRectangle(bx, boxTop, boxW, boxH, 5);

                dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
                dc.drawText(bx + (boxW / 2), boxTop + (boxH / 2), Graphics.FONT_SMALL, "_", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
        }

        // 3. Carrousel vertical du caractère actif :
        //    - Rappel discret du caractère précédent au-dessus
        //    - Caractère sélectionné affiché en grand au centre
        //    - Rappel discret du caractère suivant en dessous
        var prevChar = getPrevChar();
        var activeChar = getCurrentChar();
        var nextChar = getNextChar();

        var prevY = (h * 45) / 100;
        var activeY = (h * 59) / 100;
        var nextY = (h * 73) / 100;

        // Caractère précédent (au-dessus, taille réduite, opacité/couleur atténuée)
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, prevY, Graphics.FONT_XTINY, "^  " + prevChar + "  ^", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Cadre central du carrousel pour le caractère actif
        var pillW = (w * 28) / 100;
        var pillH = (h * 16) / 100;
        dc.setColor(COL_PILL_BG, COL_PILL_BG);
        dc.fillRoundedRectangle(cx - (pillW / 2), activeY - (pillH / 2), pillW, pillH, 6);
        dc.setColor(COL_ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.drawRoundedRectangle(cx - (pillW / 2), activeY - (pillH / 2), pillW, pillH, 6);

        // Caractère sélectionné en grand au centre
        dc.setColor(COL_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, activeY, Graphics.FONT_LARGE, activeChar, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Caractère suivant (en dessous, taille réduite, opacité/couleur atténuée)
        dc.setColor(COL_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, nextY, Graphics.FONT_XTINY, "v  " + nextChar + "  v", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // 4. Pied de page
        var divBotY = (h * 82) / 100;
        dc.setColor(COL_GRID, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 22) / 100, divBotY, w - ((w * 22) / 100), divBotY);

        var footY = (h * 85) / 100;
        dc.setColor(COL_CYAN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, footY, Graphics.FONT_XTINY, "START: OK | BACK: Ret", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

//! Delegate associé à UnifiedCodePickerView gérant les boutons physiques et les gestes tactiles
class UnifiedCodePickerDelegate extends WatchUi.BehaviorDelegate {

    private var _pickerView as UnifiedCodePickerView;

    public function initialize(pickerView as UnifiedCodePickerView) {
        BehaviorDelegate.initialize();
        _pickerView = pickerView;
    }

    public function getPickerView() as UnifiedCodePickerView {
        return _pickerView;
    }

    //! Bouton UP : Caractère précédent dans la liste
    public function onPreviousPage() as Boolean {
        _pickerView.cycleChar(-1);
        return true;
    }

    //! Bouton DOWN : Caractère suivant dans la liste
    public function onNextPage() as Boolean {
        _pickerView.cycleChar(1);
        return true;
    }

    //! Gestes tactiles Swipe Haut / Swipe Bas
    public function onSwipe(swipeEvent as WatchUi.SwipeEvent) as Boolean {
        var dir = swipeEvent.getDirection();
        if (dir == WatchUi.SWIPE_UP) {
            _pickerView.cycleChar(-1);
            return true;
        } else if (dir == WatchUi.SWIPE_DOWN) {
            _pickerView.cycleChar(1);
            return true;
        }
        return false;
    }

    //! Bouton SELECT (Start/Stop) : Valide le caractère courant et avance à la case suivante
    public function onSelect() as Boolean {
        _pickerView.confirmCurrentChar();
        return true;
    }

    //! Tap écran : Valide le caractère courant et avance à la case suivante
    public function onTap(clickEvent as WatchUi.ClickEvent) as Boolean {
        _pickerView.confirmCurrentChar();
        return true;
    }

    //! Bouton BACK (Lap) :
    //! - Si index > 0 : efface le caractère précédent et recule d'une case
    //! - Si index == 0 : annule la saisie et revient au menu précédent
    public function onBack() as Boolean {
        var cancelled = _pickerView.backspaceOrCancel();
        if (cancelled) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
        return true;
    }
}
