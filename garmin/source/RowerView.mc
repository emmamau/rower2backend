import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Lang;

class RowerView extends WatchUi.View {

    private var _statusText as String = "Scanning...";
    private var _model as RowerDataModel?;

    function initialize() {
        View.initialize();
        _model = new RowerDataModel();
    }

    function setStatus(status as String) as Void {
        _statusText = status;
        WatchUi.requestUpdate();
    }

    function updateRowerData(model as RowerDataModel) as Void {
        _model = model;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();

        // 1. Status Bar (Top Header)
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 8, Graphics.FONT_XTINY, _statusText, Graphics.TEXT_JUSTIFY_CENTER);

        // Top horizontal separator line at y = 28
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(15, 28, width - 15, 28);

        if (_model == null) {
            return;
        }

        var m = _model as RowerDataModel;

        // 2. Data Label: SPM / STROKES placed immediately below the top horizontal bar (y = 31)
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 31, Graphics.FONT_XTINY, "SPM / STROKES: " + m.strokeCount, Graphics.TEXT_JUSTIFY_CENTER);

        // 3. Cadence (SPM) Main Metric - perfectly balanced in upper section
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        var spmStr = m.strokeRate.format("%.1f");
        dc.drawText(width / 2, 48, Graphics.FONT_NUMBER_HOT, spmStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Middle separator line at y = 114
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(30, 114, width - 30, 114);

        // 4. Power (Watts) & Pace (/500m) Row (y = 120)
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        var powerStr = m.instantPower.toString() + " W";
        dc.drawText(width / 4, 120, Graphics.FONT_MEDIUM, powerStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Format pace (sec -> MM:SS)
        var paceSec = m.instantPace;
        var paceMin = paceSec / 60;
        var paceRemainder = paceSec % 60;
        var paceStr = (paceRemainder < 10) ? (paceMin + ":0" + paceRemainder) : (paceMin + ":" + paceRemainder);
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText((width * 3) / 4, 120, Graphics.FONT_MEDIUM, paceStr + "/500m", Graphics.TEXT_JUSTIFY_CENTER);

        // Row Labels (y = 148)
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 4, 148, Graphics.FONT_XTINY, "POWER", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText((width * 3) / 4, 148, Graphics.FONT_XTINY, "PACE", Graphics.TEXT_JUSTIFY_CENTER);

        // 5. Total Distance & Elapsed Time Row (y = 172)
        var distStr = m.totalDistance.toString() + " m";
        var timeSec = m.elapsedTime;
        var tMin = timeSec / 60;
        var tSec = timeSec % 60;
        var timeStr = (tSec < 10) ? (tMin + ":0" + tSec) : (tMin + ":" + tSec);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 172, Graphics.FONT_SMALL, distStr + "  |  " + timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        // 6. Heart Rate & Calories (Bottom Row, y = 202)
        var hrStr = (m.heartRate > 0) ? (m.heartRate.toString() + " bpm") : "-- bpm";
        var calStr = m.totalEnergy.toString() + " kcal";
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 202, Graphics.FONT_XTINY, hrStr + "  *  " + calStr, Graphics.TEXT_JUSTIFY_CENTER);
    }
}
