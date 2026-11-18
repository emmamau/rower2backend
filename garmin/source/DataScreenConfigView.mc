import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;

class DataScreenConfigView extends WatchUi.View {

    // Navigation levels
    public static const LEVEL_PAGE = 0;  // Choix Page 1 / Page 2 / Reset
    public static const LEVEL_SLOT = 1;  // Choix Haut Gauche, Haut Droite, etc.
    public static const LEVEL_FIELD = 2; // Choix de la métrique

    private var _model as RowerDataModel;
    private var _currentLevel as Number = LEVEL_PAGE;

    private var _selectedPage as Number = 0; // 0 = Page 1, 1 = Page 2
    private var _selectedSlot as Number = 0; // 0..4 (TL, TR, BL, BR, Foot)

    private var _pageMenuIndex as Number = 0;
    private var _slotMenuIndex as Number = 0;
    private var _fieldMenuIndex as Number = 0;

    // Toast message (ex: "Valeurs retablies")
    private var _toastMessage as String? = null;
    private var _toastTimer as Number = 0;

    public function initialize(model as RowerDataModel) {
        View.initialize();
        _model = model;
    }

    public function getLevel() as Number {
        return _currentLevel;
    }

    public function setLevel(lvl as Number) as Void {
        _currentLevel = lvl;
        WatchUi.requestUpdate();
    }

    public function getSelectedPage() as Number {
        return _selectedPage;
    }

    public function getSelectedSlot() as Number {
        return _selectedSlot;
    }

    public function nextItem() as Void {
        if (_currentLevel == LEVEL_PAGE) {
            _pageMenuIndex = (_pageMenuIndex + 1) % 3;
        } else if (_currentLevel == LEVEL_SLOT) {
            _slotMenuIndex = (_slotMenuIndex + 1) % 5;
        } else if (_currentLevel == LEVEL_FIELD) {
            var count = (_selectedSlot == RaceDataFieldManager.SLOT_FOOTER)
                ? RaceDataFieldManager.TOTAL_FOOTER_COUNT
                : RaceDataFieldManager.TOTAL_METRICS_COUNT;
            _fieldMenuIndex = (_fieldMenuIndex + 1) % count;
        }
        WatchUi.requestUpdate();
    }

    public function prevItem() as Void {
        if (_currentLevel == LEVEL_PAGE) {
            _pageMenuIndex = (_pageMenuIndex - 1 + 3) % 3;
        } else if (_currentLevel == LEVEL_SLOT) {
            _slotMenuIndex = (_slotMenuIndex - 1 + 5) % 5;
        } else if (_currentLevel == LEVEL_FIELD) {
            var count = (_selectedSlot == RaceDataFieldManager.SLOT_FOOTER)
                ? RaceDataFieldManager.TOTAL_FOOTER_COUNT
                : RaceDataFieldManager.TOTAL_METRICS_COUNT;
            _fieldMenuIndex = (_fieldMenuIndex - 1 + count) % count;
        }
        WatchUi.requestUpdate();
    }

    public function handleSelect() as Void {
        if (_currentLevel == LEVEL_PAGE) {
            if (_pageMenuIndex == 0) {
                _selectedPage = 0;
                _slotMenuIndex = 0;
                _currentLevel = LEVEL_SLOT;
            } else if (_pageMenuIndex == 1) {
                _selectedPage = 1;
                _slotMenuIndex = 0;
                _currentLevel = LEVEL_SLOT;
            } else {
                RaceDataFieldManager.resetToDefaults();
                _toastMessage = I18n.getText("CONFIG_RESET");
                _toastTimer = 2;
            }
        } else if (_currentLevel == LEVEL_SLOT) {
            _selectedSlot = _slotMenuIndex;
            // Positionner l'index sur la métrique actuellement sélectionnée
            _fieldMenuIndex = RaceDataFieldManager.getFieldId(_selectedPage, _selectedSlot);
            _currentLevel = LEVEL_FIELD;
        } else if (_currentLevel == LEVEL_FIELD) {
            RaceDataFieldManager.setFieldId(_selectedPage, _selectedSlot, _fieldMenuIndex);
            _currentLevel = LEVEL_SLOT;
        }
        WatchUi.requestUpdate();
    }

    public function handleBack() as Boolean {
        if (_currentLevel == LEVEL_FIELD) {
            _currentLevel = LEVEL_SLOT;
            WatchUi.requestUpdate();
            return true;
        } else if (_currentLevel == LEVEL_SLOT) {
            _currentLevel = LEVEL_PAGE;
            WatchUi.requestUpdate();
            return true;
        }
        return false; // Exit view
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // En-tête
        var titleY = (h * 8) / 100;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        var titleStr = I18n.getText("MENU_DATA_SCREENS");
        if (_currentLevel == LEVEL_SLOT) {
            titleStr = (_selectedPage == 0) ? I18n.getText("CONFIG_PAGE1") : I18n.getText("CONFIG_PAGE2");
        } else if (_currentLevel == LEVEL_FIELD) {
            var slotName = getSlotName(_selectedSlot);
            titleStr = "P" + (_selectedPage + 1) + " - " + slotName;
        }
        dc.drawText(cx, titleY, Graphics.FONT_XTINY, titleStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Ligne séparatrice supérieure
        var sepY = (h * 20) / 100;
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine((w * 15) / 100, sepY, w - ((w * 15) / 100), sepY);

        if (_currentLevel == LEVEL_PAGE) {
            drawPageList(dc, w, h);
        } else if (_currentLevel == LEVEL_SLOT) {
            drawSlotList(dc, w, h);
        } else if (_currentLevel == LEVEL_FIELD) {
            drawFieldList(dc, w, h);
        }

        // Pied de page d'indication navigation
        var footY = (h * 87) / 100;
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var navStr = (_currentLevel == LEVEL_PAGE) ? "START: Choisir | BACK: Quitter" : "START: Valider | BACK: Retour";
        dc.drawText(cx, footY, Graphics.FONT_XTINY, navStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Toast overlay si actif
        if (_toastMessage != null && _toastTimer > 0) {
            dc.setColor(Graphics.COLOR_DK_BLUE, Graphics.COLOR_DK_BLUE);
            dc.fillRoundedRectangle((w * 15) / 100, (h * 40) / 100, (w * 70) / 100, (h * 20) / 100, 6);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2, Graphics.FONT_XTINY, _toastMessage as String, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    private function drawPageList(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;
        var items = [
            I18n.getText("CONFIG_PAGE1"),
            I18n.getText("CONFIG_PAGE2"),
            I18n.getText("CONFIG_RESET")
        ] as Array<String>;

        var startY = (h * 30) / 100;
        var rowH = (h * 16) / 100;

        for (var i = 0; i < items.size(); i++) {
            var isSel = (i == _pageMenuIndex);
            var itemY = startY + (i * rowH);

            if (isSel) {
                dc.setColor(Graphics.COLOR_DK_BLUE, Graphics.COLOR_DK_BLUE);
                dc.fillRoundedRectangle((w * 15) / 100, itemY - 2, (w * 70) / 100, rowH - 4, 4);
                dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            } else {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            }
            dc.drawText(cx, itemY + (rowH / 2) - 4, Graphics.FONT_TINY, items[i], Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    private function drawSlotList(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;
        var slots = [
            I18n.getText("CONFIG_SLOT_TL"),
            I18n.getText("CONFIG_SLOT_TR"),
            I18n.getText("CONFIG_SLOT_BL"),
            I18n.getText("CONFIG_SLOT_BR"),
            I18n.getText("CONFIG_SLOT_FOOT")
        ] as Array<String>;

        var startY = (h * 24) / 100;
        var rowH = (h * 12) / 100;

        for (var i = 0; i < slots.size(); i++) {
            var isSel = (i == _slotMenuIndex);
            var itemY = startY + (i * rowH);

            var currFieldId = RaceDataFieldManager.getFieldId(_selectedPage, i);
            var currName = (i == RaceDataFieldManager.SLOT_FOOTER)
                ? RaceDataFieldManager.getFooterMenuName(currFieldId)
                : RaceDataFieldManager.getFieldMenuName(currFieldId);

            var displayLine = slots[i] + " : " + currName;

            if (isSel) {
                dc.setColor(Graphics.COLOR_DK_BLUE, Graphics.COLOR_DK_BLUE);
                dc.fillRoundedRectangle((w * 10) / 100, itemY - 1, (w * 80) / 100, rowH - 2, 4);
                dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            } else {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            }
            dc.drawText(cx, itemY + (rowH / 2) - 2, Graphics.FONT_XTINY, displayLine, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    private function drawFieldList(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var cx = w / 2;
        var isFoot = (_selectedSlot == RaceDataFieldManager.SLOT_FOOTER);
        var totalCount = isFoot ? RaceDataFieldManager.TOTAL_FOOTER_COUNT : RaceDataFieldManager.TOTAL_METRICS_COUNT;

        // Afficher 3 items centrés autour de _fieldMenuIndex (précédent, courant, suivant)
        var rowH = (h * 16) / 100;
        var centerY = (h * 50) / 100;

        for (var offset = -1; offset <= 1; offset++) {
            var idx = (_fieldMenuIndex + offset + totalCount) % totalCount;
            var itemY = centerY + (offset * rowH);

            var nameStr = isFoot
                ? RaceDataFieldManager.getFooterMenuName(idx)
                : RaceDataFieldManager.getFieldMenuName(idx);

            var isCurSlotActive = (idx == RaceDataFieldManager.getFieldId(_selectedPage, _selectedSlot));
            if (isCurSlotActive) {
                nameStr = nameStr + " [V]";
            }

            if (offset == 0) {
                // Élément sélectionné au centre
                dc.setColor(Graphics.COLOR_DK_BLUE, Graphics.COLOR_DK_BLUE);
                dc.fillRoundedRectangle((w * 10) / 100, itemY - (rowH / 2) + 2, (w * 80) / 100, rowH - 4, 6);
                dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, itemY, Graphics.FONT_TINY, nameStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            } else {
                dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, itemY, Graphics.FONT_XTINY, nameStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
        }

        // Indicateur de scroll (position / total)
        var posStr = (_fieldMenuIndex + 1).format("%d") + "/" + totalCount.format("%d");
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 78) / 100, Graphics.FONT_XTINY, posStr, Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function getSlotName(slot as Number) as String {
        switch (slot) {
            case RaceDataFieldManager.SLOT_TOP_LEFT:
                return I18n.getText("CONFIG_SLOT_TL");
            case RaceDataFieldManager.SLOT_TOP_RIGHT:
                return I18n.getText("CONFIG_SLOT_TR");
            case RaceDataFieldManager.SLOT_BOTTOM_LEFT:
                return I18n.getText("CONFIG_SLOT_BL");
            case RaceDataFieldManager.SLOT_BOTTOM_RIGHT:
                return I18n.getText("CONFIG_SLOT_BR");
            case RaceDataFieldManager.SLOT_FOOTER:
                return I18n.getText("CONFIG_SLOT_FOOT");
            default:
                return "";
        }
    }
}
