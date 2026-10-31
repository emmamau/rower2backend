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

        // Title & Connection Status Bar
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 15, Graphics.FONT_XTINY, _statusText, Graphics.TEXT_JUSTIFY_CENTER);

        // Separator line
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(20, 38, width - 20, 38);

        if (_model == null) {
            return;
        }

        var m = _model as RowerDataModel;

        // Metric 1: Stroke Rate (SPM) - Large in center
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        var spmStr = m.strokeRate.format("%.1f");
        dc.drawText(width / 2, 45, Graphics.FONT_NUMBER_HOT, spmStr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 95, Graphics.FONT_XTINY, "SPM / STROKES: " + m.strokeCount, Graphics.TEXT_JUSTIFY_CENTER);

        // Metric 2: Power (Watts) & Pace (/500m)
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

        // Labels
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 4, 150, Graphics.FONT_XTINY, "POWER", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText((width * 3) / 4, 150, Graphics.FONT_XTINY, "PACE", Graphics.TEXT_JUSTIFY_CENTER);

        // Metric 3: Total Distance & Elapsed Time
        var distStr = m.totalDistance.toString() + " m";
        var timeSec = m.elapsedTime;
        var tMin = timeSec / 60;
        var tSec = timeSec % 60;
        var timeStr = (tSec < 10) ? (tMin + ":0" + tSec) : (tMin + ":" + tSec);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 175, Graphics.FONT_SMALL, distStr + "  |  " + timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Metric 4: Heart Rate & Calories (bottom row)
        var hrStr = (m.heartRate > 0) ? (m.heartRate.toString() + " bpm") : "-- bpm";
        var calStr = m.totalEnergy.toString() + " kcal";
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 205, Graphics.FONT_XTINY, hrStr + "  *  " + calStr, Graphics.TEXT_JUSTIFY_CENTER);
    }
}

