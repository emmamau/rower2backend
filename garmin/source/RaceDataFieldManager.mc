import Toybox.Application;
import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;

module RaceDataFieldManager {

    // -------------------------------------------------------------------------
    // 31 Metric Identifiers
    // -------------------------------------------------------------------------
    public const FIELD_PACE_INSTANT    = 0;
    public const FIELD_PACE_AVG        = 1;
    public const FIELD_SPEED_INSTANT   = 2;
    public const FIELD_SPEED_AVG       = 3;
    public const FIELD_DPS             = 4;
    public const FIELD_POWER_INSTANT   = 5;
    public const FIELD_POWER_AVG       = 6;
    public const FIELD_POWER_MAX       = 7;
    public const FIELD_CALORIES        = 8;
    public const FIELD_CAL_PER_HOUR    = 9;
    public const FIELD_SPM_INSTANT     = 10;
    public const FIELD_SPM_AVG         = 11;
    public const FIELD_STROKE_COUNT    = 12;
    public const FIELD_PEAK_FORCE      = 13;
    public const FIELD_AVG_FORCE       = 14;
    public const FIELD_STROKE_WORK     = 15;
    public const FIELD_DISTANCE        = 16;
    public const FIELD_REM_DISTANCE    = 17;
    public const FIELD_ELAPSED_TIME    = 18;
    public const FIELD_REM_TIME_EST    = 19;
    public const FIELD_PROJECTED_TIME  = 20;
    public const FIELD_TIME_OF_DAY     = 21;
    public const FIELD_HR_INSTANT      = 22;
    public const FIELD_HR_AVG          = 23;
    public const FIELD_HR_MAX          = 24;
    public const FIELD_HR_ZONE         = 25;
    public const FIELD_RANK            = 26;
    public const FIELD_GAP_PREV        = 27;
    public const FIELD_GAP_NEXT        = 28;
    public const FIELD_GAP_LEADER      = 29;
    public const FIELD_PROGRESS_PCT    = 30;

    public const TOTAL_METRICS_COUNT   = 31;

    // Slot IDs in a 2x2 grid
    public const SLOT_TOP_LEFT     = 0;
    public const SLOT_TOP_RIGHT    = 1;
    public const SLOT_BOTTOM_LEFT  = 2;
    public const SLOT_BOTTOM_RIGHT = 3;
    public const SLOT_FOOTER       = 4;

    // Footer styles
    public const FOOTER_DEFAULT           = 0;
    public const FOOTER_SPM_HR            = 1;
    public const FOOTER_KAYAK_STROKES     = 2;
    public const FOOTER_TIME_SPEED        = 3;
    public const FOOTER_CALORIES_WORK     = 4;
    public const FOOTER_SPLIT_PROJECTION  = 5;
    public const FOOTER_POWER_HR          = 6;
    public const TOTAL_FOOTER_COUNT       = 7;

    // Default configuration (reproduces the original hardcoded layout)
    const DEFAULT_P1 = [
        FIELD_PACE_INSTANT,  // TL
        FIELD_POWER_INSTANT, // TR
        FIELD_DISTANCE,      // BL
        FIELD_RANK,          // BR
        FOOTER_DEFAULT       // Footer
    ];

    const DEFAULT_P2 = [
        FIELD_GAP_PREV,      // TL
        FIELD_GAP_NEXT,      // TR
        FIELD_PACE_AVG,      // BL
        FIELD_REM_DISTANCE,  // BR
        FOOTER_DEFAULT       // Footer
    ];

    // Storage property keys
    const PROP_KEYS = [
        ["dataField_p1_tl", "dataField_p1_tr", "dataField_p1_bl", "dataField_p1_br", "dataField_p1_foot"],
        ["dataField_p2_tl", "dataField_p2_tr", "dataField_p2_bl", "dataField_p2_br", "dataField_p2_foot"]
    ];

    // Runtime active config cache: [ [TL, TR, BL, BR, Foot], [TL, TR, BL, BR, Foot] ]
    var _cachedConfig as Array<Array<Number>>? = null;

    // -------------------------------------------------------------------------
    // Configuration Management
    // -------------------------------------------------------------------------
    function initConfig() as Void {
        _cachedConfig = [
            [DEFAULT_P1[0], DEFAULT_P1[1], DEFAULT_P1[2], DEFAULT_P1[3], DEFAULT_P1[4]],
            [DEFAULT_P2[0], DEFAULT_P2[1], DEFAULT_P2[2], DEFAULT_P2[3], DEFAULT_P2[4]]
        ] as Array<Array<Number>>;

        for (var p = 0; p < 2; p++) {
            var defArr = (p == 0) ? DEFAULT_P1 : DEFAULT_P2;
            for (var s = 0; s < 5; s++) {
                var propKey = PROP_KEYS[p][s];
                var val = readProperty(propKey);
                if (val != null && val instanceof Number) {
                    (_cachedConfig as Array<Array<Number>>)[p][s] = val;
                } else {
                    (_cachedConfig as Array<Array<Number>>)[p][s] = defArr[s];
                }
            }
        }
    }

    function reloadConfig() as Void {
        initConfig();
    }

    function getFieldId(page as Number, slot as Number) as Number {
        if (_cachedConfig == null) {
            initConfig();
        }
        if (page < 0 || page > 1 || slot < 0 || slot > 4) {
            return 0;
        }
        return (_cachedConfig as Array<Array<Number>>)[page][slot];
    }

    function setFieldId(page as Number, slot as Number, fieldId as Number) as Void {
        if (_cachedConfig == null) {
            initConfig();
        }
        if (page < 0 || page > 1 || slot < 0 || slot > 4) {
            return;
        }
        (_cachedConfig as Array<Array<Number>>)[page][slot] = fieldId;
        var propKey = PROP_KEYS[page][slot];
        writeProperty(propKey, fieldId);
    }

    function resetToDefaults() as Void {
        initConfig();
        for (var p = 0; p < 2; p++) {
            var defArr = (p == 0) ? DEFAULT_P1 : DEFAULT_P2;
            for (var s = 0; s < 5; s++) {
                var propKey = PROP_KEYS[p][s];
                writeProperty(propKey, defArr[s]);
                (_cachedConfig as Array<Array<Number>>)[p][s] = defArr[s];
            }
        }
    }

    function readProperty(key as String) as Object? {
        var val = null;
        try {
            if (Toybox.Application has :Properties) {
                val = Properties.getValue(key);
            }
        } catch (e) {
        }
        if (val == null) {
            try {
                val = Storage.getValue(key);
            } catch (e2) {
            }
        }
        return val;
    }

    function writeProperty(key as String, value as Object) as Void {
        try {
            if (Toybox.Application has :Properties) {
                Properties.setValue(key, value);
            }
        } catch (e) {
        }
        try {
            Storage.setValue(key, value);
        } catch (e2) {
        }
    }

    // -------------------------------------------------------------------------
    // Labels & Menu Descriptions
    // -------------------------------------------------------------------------
    function getFieldMenuName(fieldId as Number) as String {
        switch (fieldId) {
            case FIELD_PACE_INSTANT:
                return I18n.getText("GRID_PACE");
            case FIELD_PACE_AVG:
                return I18n.getText("GRID_AVG_PACE");
            case FIELD_SPEED_INSTANT:
                return I18n.getText("GRID_SPEED");
            case FIELD_SPEED_AVG:
                return I18n.getText("GRID_AVG_SPEED");
            case FIELD_DPS:
                return I18n.getText("GRID_DPS");
            case FIELD_POWER_INSTANT:
                return I18n.getText("GRID_POWER");
            case FIELD_POWER_AVG:
                return I18n.getText("GRID_AVG_POWER");
            case FIELD_POWER_MAX:
                return I18n.getText("GRID_MAX_POWER");
            case FIELD_CALORIES:
                return I18n.getText("GRID_CALORIES");
            case FIELD_CAL_PER_HOUR:
                return I18n.getText("GRID_CAL_HR");
            case FIELD_SPM_INSTANT:
                return I18n.getText("GRID_SPM");
            case FIELD_SPM_AVG:
                return I18n.getText("GRID_AVG_SPM");
            case FIELD_STROKE_COUNT:
                return I18n.getText("GRID_STROKES");
            case FIELD_PEAK_FORCE:
                return I18n.getText("GRID_FORCE");
            case FIELD_AVG_FORCE:
                return I18n.getText("GRID_AVG_FORCE");
            case FIELD_STROKE_WORK:
                return I18n.getText("GRID_WORK");
            case FIELD_DISTANCE:
                return I18n.getText("GRID_DIST");
            case FIELD_REM_DISTANCE:
                return I18n.getText("GRID_REM");
            case FIELD_ELAPSED_TIME:
                return I18n.getText("GRID_ELAPSED");
            case FIELD_REM_TIME_EST:
                return I18n.getText("GRID_REM_TIME");
            case FIELD_PROJECTED_TIME:
                return I18n.getText("GRID_PROJECTED");
            case FIELD_TIME_OF_DAY:
                return I18n.getText("GRID_CLOCK");
            case FIELD_HR_INSTANT:
                return I18n.getText("GRID_HR");
            case FIELD_HR_AVG:
                return I18n.getText("GRID_AVG_HR");
            case FIELD_HR_MAX:
                return I18n.getText("GRID_MAX_HR");
            case FIELD_HR_ZONE:
                return I18n.getText("GRID_HR_ZONE");
            case FIELD_RANK:
                return I18n.getText("GRID_RANK");
            case FIELD_GAP_PREV:
                return I18n.getText("GRID_PREV");
            case FIELD_GAP_NEXT:
                return I18n.getText("GRID_NEXT");
            case FIELD_GAP_LEADER:
                return I18n.getText("GRID_LEADER");
            case FIELD_PROGRESS_PCT:
                return I18n.getText("GRID_PROGRESS");
            default:
                return "--";
        }
    }

    function getFooterMenuName(footerId as Number) as String {
        switch (footerId) {
            case FOOTER_DEFAULT:
                return "Par defaut";
            case FOOTER_SPM_HR:
                return "Cadence & Cardio";
            case FOOTER_KAYAK_STROKES:
                return "Couloir & Coups";
            case FOOTER_TIME_SPEED:
                return "Chrono & Vitesse";
            case FOOTER_CALORIES_WORK:
                return "Calories & Travail";
            case FOOTER_SPLIT_PROJECTION:
                return "Reste & Arrivee";
            case FOOTER_POWER_HR:
                return "Puissance & Cardio";
            default:
                return "Par defaut";
        }
    }

    // -------------------------------------------------------------------------
    // Dynamic Telemetry Rendering Data
    // Returns [labelStr, valueStr, labelColor, valueColor]
    // -------------------------------------------------------------------------
    function getSlotRenderData(fieldId as Number, model as RowerDataModel, view as RowerView) as Array<Object> {
        var lbl = "";
        var val = "";
        var lblCol = Graphics.COLOR_WHITE;
        var valCol = Graphics.COLOR_WHITE;

        switch (fieldId) {
            case FIELD_PACE_INSTANT:
                lbl = I18n.getText("GRID_PACE");
                var dispPace = (model.instantPace > 0) ? model.instantPace : model.avgPace;
                val = model.formatPace(dispPace);
                lblCol = Graphics.COLOR_YELLOW;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_PACE_AVG:
                lbl = I18n.getText("GRID_AVG_PACE");
                val = model.formatPace(model.getEffectiveAvgPace(model.elapsedTime));
                lblCol = Graphics.COLOR_YELLOW;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_SPEED_INSTANT:
                lbl = I18n.getText("GRID_SPEED");
                val = model.getSpeedKmh().format("%.1f");
                lblCol = Graphics.COLOR_BLUE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_SPEED_AVG:
                lbl = I18n.getText("GRID_AVG_SPEED");
                val = model.getAvgSpeedKmh(model.elapsedTime).format("%.1f");
                lblCol = Graphics.COLOR_BLUE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_DPS:
                lbl = I18n.getText("GRID_DPS");
                val = model.getDistancePerStroke().format("%.1f") + "m";
                lblCol = Graphics.COLOR_BLUE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_POWER_INSTANT:
                lbl = I18n.getText("GRID_POWER");
                var dispPow = (model.instantPower > 0) ? model.instantPower : ((!model.isHalted && model.avgPower > 0) ? model.avgPower : 0);
                val = dispPow.format("%d");
                lblCol = Graphics.COLOR_GREEN;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_POWER_AVG:
                lbl = I18n.getText("GRID_AVG_POWER");
                val = (model.avgPower > 0) ? model.avgPower.format("%d") : "0";
                lblCol = Graphics.COLOR_GREEN;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_POWER_MAX:
                lbl = I18n.getText("GRID_MAX_POWER");
                val = (model.maxPower > 0) ? model.maxPower.format("%d") : "0";
                lblCol = Graphics.COLOR_ORANGE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_CALORIES:
                lbl = I18n.getText("GRID_CALORIES");
                val = (model.totalEnergy > 0) ? model.totalEnergy.format("%d") : "0";
                lblCol = Graphics.COLOR_ORANGE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_CAL_PER_HOUR:
                lbl = I18n.getText("GRID_CAL_HR");
                val = (model.energyPerHour > 0) ? model.energyPerHour.format("%d") : "0";
                lblCol = Graphics.COLOR_ORANGE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_SPM_INSTANT:
                lbl = I18n.getText("GRID_SPM");
                val = (model.strokeRate > 0.0f) ? model.strokeRate.format("%.0f") : "0";
                lblCol = Graphics.COLOR_YELLOW;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_SPM_AVG:
                lbl = I18n.getText("GRID_AVG_SPM");
                val = (model.avgStrokeRate > 0.0f) ? model.avgStrokeRate.format("%.0f") : "0";
                lblCol = Graphics.COLOR_YELLOW;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_STROKE_COUNT:
                lbl = I18n.getText("GRID_STROKES");
                val = model.strokeCount.format("%d");
                lblCol = Graphics.COLOR_BLUE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_PEAK_FORCE:
                lbl = I18n.getText("GRID_FORCE");
                val = model.force.format("%d");
                lblCol = Graphics.COLOR_GREEN;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_AVG_FORCE:
                lbl = I18n.getText("GRID_AVG_FORCE");
                val = model.avgForce.format("%d");
                lblCol = Graphics.COLOR_GREEN;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_STROKE_WORK:
                lbl = I18n.getText("GRID_WORK");
                val = model.work.format("%.0f");
                lblCol = Graphics.COLOR_ORANGE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_DISTANCE:
                lbl = I18n.getText("GRID_DIST");
                val = view.getNetDistance().format("%d");
                lblCol = Graphics.COLOR_BLUE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_REM_DISTANCE:
                lbl = I18n.getText("GRID_REM");
                var rem = view.getTargetDistance() - view.getNetDistance();
                if (rem < 0) { rem = 0; }
                val = rem.format("%d");
                lblCol = Graphics.COLOR_BLUE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_ELAPSED_TIME:
                lbl = I18n.getText("GRID_ELAPSED");
                val = model.formatTime(model.elapsedTime);
                lblCol = Graphics.COLOR_WHITE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_REM_TIME_EST:
                lbl = I18n.getText("GRID_REM_TIME");
                val = model.formatTime(model.getRemainingTimeEst(view.getTargetDistance(), view.getNetDistance()));
                lblCol = Graphics.COLOR_WHITE;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_PROJECTED_TIME:
                lbl = I18n.getText("GRID_PROJECTED");
                val = model.formatTime(model.getProjectedTime(view.getTargetDistance(), view.getNetDistance()));
                lblCol = Graphics.COLOR_GREEN;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_TIME_OF_DAY:
                lbl = I18n.getText("GRID_CLOCK");
                var clock = System.getClockTime();
                val = clock.hour.format("%02d") + ":" + clock.min.format("%02d");
                lblCol = Graphics.COLOR_LT_GRAY;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_HR_INSTANT:
                lbl = I18n.getText("GRID_HR");
                val = (model.heartRate > 0) ? (model.heartRate.format("%d") + " bpm") : "-- bpm";
                lblCol = Graphics.COLOR_RED;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_HR_AVG:
                lbl = I18n.getText("GRID_AVG_HR");
                val = (model.heartRate > 0) ? model.heartRate.format("%d") : "--";
                lblCol = Graphics.COLOR_RED;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_HR_MAX:
                lbl = I18n.getText("GRID_MAX_HR");
                val = (model.heartRate > 0) ? model.heartRate.format("%d") : "--";
                lblCol = Graphics.COLOR_RED;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_HR_ZONE:
                lbl = I18n.getText("GRID_HR_ZONE");
                var zone = model.getHeartRateZone();
                val = (zone > 0) ? ("Z" + zone) : "--";
                lblCol = Graphics.COLOR_RED;
                valCol = (zone >= 4) ? Graphics.COLOR_RED : Graphics.COLOR_WHITE;
                break;

            case FIELD_RANK:
                lbl = view.isSolo() ? I18n.getText("GRID_REM") : I18n.getText("GRID_RANK");
                val = view.getPage1BottomRightValue();
                lblCol = Graphics.COLOR_YELLOW;
                valCol = view.getRankValueColor();
                break;

            case FIELD_GAP_PREV:
                if (view.isSolo()) {
                    lbl = I18n.getText("GRID_WORK");
                    val = model.work.format("%.0f");
                    lblCol = Graphics.COLOR_ORANGE;
                    valCol = Graphics.COLOR_WHITE;
                } else {
                    lbl = I18n.getText("GRID_PREV");
                    val = (view.getCurrentRank() > 1) ? ("-" + view.getDistToPrev().format("%d")) : "LEAD";
                    lblCol = Graphics.COLOR_ORANGE;
                    valCol = Graphics.COLOR_WHITE;
                }
                break;

            case FIELD_GAP_NEXT:
                if (view.isSolo()) {
                    lbl = I18n.getText("GRID_FORCE");
                    val = model.force.format("%d");
                    lblCol = Graphics.COLOR_GREEN;
                    valCol = Graphics.COLOR_WHITE;
                } else {
                    lbl = I18n.getText("GRID_NEXT");
                    val = (view.getCurrentRank() < view.getTotalRacers()) ? ("+" + view.getDistToNext().format("%d")) : "DERN";
                    lblCol = Graphics.COLOR_GREEN;
                    valCol = Graphics.COLOR_WHITE;
                }
                break;

            case FIELD_GAP_LEADER:
                lbl = I18n.getText("GRID_LEADER");
                val = (view.getCurrentRank() <= 1) ? "LEAD" : ("-" + view.getDistToLeader().format("%d"));
                lblCol = Graphics.COLOR_RED;
                valCol = Graphics.COLOR_WHITE;
                break;

            case FIELD_PROGRESS_PCT:
                lbl = I18n.getText("GRID_PROGRESS");
                val = (view.getProgressPercent() * 100.0f).format("%.0f") + "%";
                lblCol = Graphics.COLOR_BLUE;
                valCol = Graphics.COLOR_WHITE;
                break;

            default:
                lbl = "--";
                val = "--";
                lblCol = Graphics.COLOR_LT_GRAY;
                valCol = Graphics.COLOR_WHITE;
                break;
        }

        return [lbl, val, lblCol, valCol] as Array<Object>;
    }

    // -------------------------------------------------------------------------
    // Footer String Formatter
    // -------------------------------------------------------------------------
    function getFooterString(page as Number, model as RowerDataModel, view as RowerView) as String {
        var footStyle = getFieldId(page, SLOT_FOOTER);
        if (footStyle == FOOTER_DEFAULT) {
            if (page == 0) {
                var spmVal = (model.strokeRate > 0.0f) ? model.strokeRate.format("%.0f") : "0";
                var hrVal = (model.heartRate > 0) ? (model.heartRate.format("%d") + " bpm") : "-- bpm";
                return spmVal + " spm  |  " + hrVal;
            } else {
                var lane = view.getAssignedLane();
                var kTag = (lane > 0)
                    ? ("Kayak L." + lane + " (" + UserManager.getDisplayPseudo() + ")")
                    : ("Kayak : " + UserManager.getDisplayPseudo());
                return kTag + "  |  " + model.strokeCount.format("%d") + " " + I18n.getText("FOOT_STROKES");
            }
        } else if (footStyle == FOOTER_SPM_HR) {
            var sVal = (model.strokeRate > 0.0f) ? model.strokeRate.format("%.0f") : "0";
            var hVal = (model.heartRate > 0) ? (model.heartRate.format("%d") + " bpm") : "-- bpm";
            return sVal + " spm  |  " + hVal;
        } else if (footStyle == FOOTER_KAYAK_STROKES) {
            var l = view.getAssignedLane();
            var kt = (l > 0)
                ? ("Kayak L." + l + " (" + UserManager.getDisplayPseudo() + ")")
                : ("Kayak : " + UserManager.getDisplayPseudo());
            return kt + "  |  " + model.strokeCount.format("%d") + " " + I18n.getText("FOOT_STROKES");
        } else if (footStyle == FOOTER_TIME_SPEED) {
            var tVal = model.formatTime(model.elapsedTime);
            var spdVal = model.getSpeedKmh().format("%.1f") + " km/h";
            return tVal + "  |  " + spdVal;
        } else if (footStyle == FOOTER_CALORIES_WORK) {
            var calVal = (model.totalEnergy > 0) ? (model.totalEnergy.format("%d") + " kcal") : "0 kcal";
            var wVal = model.work.format("%.0f") + " J";
            return calVal + "  |  " + wVal;
        } else if (footStyle == FOOTER_SPLIT_PROJECTION) {
            var rTime = model.formatTime(model.getRemainingTimeEst(view.getTargetDistance(), view.getNetDistance()));
            var pTime = model.formatTime(model.getProjectedTime(view.getTargetDistance(), view.getNetDistance()));
            return "Rest: " + rTime + "  |  Arr: " + pTime;
        } else if (footStyle == FOOTER_POWER_HR) {
            var pVal = ((model.instantPower > 0) ? model.instantPower : model.avgPower).format("%d") + " W";
            var hrVal2 = (model.heartRate > 0) ? (model.heartRate.format("%d") + " bpm") : "-- bpm";
            return pVal + "  |  " + hrVal2;
        }

        return "";
    }
}
