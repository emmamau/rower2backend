import Toybox.Activity;
import Toybox.Application;
import Toybox.BluetoothLowEnergy;
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.Timer;
import Toybox.WatchUi;

class RowerApp extends Application.AppBase {

    private var _model as RowerDataModel;
    private var _bleDelegate as BleDelegate;
    private var _timer as Timer.Timer?;

    public function initialize() {
        AppBase.initialize();
        _model = new RowerDataModel();
        _bleDelegate = new BleDelegate(_model);
    }

    public function onStart(state as Dictionary?) as Void {
        // Generate or load persistent 6-char player ID
        UserManager.getUserId();

        // Register FTMS (0x1826) & SmartRow Direct (0x1234) profiles
        // Dès le démarrage, la montre active le BLE et lance la recherche de son rameur
        BluetoothLowEnergy.setDelegate(_bleDelegate);
        _bleDelegate.registerProfiles();

        // Enable internal optical / ANT+ heart rate sensor (with BLE HR fallback)
        try {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
            Sensor.enableSensorEvents(method(:onSensorEvent));
        } catch (e) {
        }

        // Start unified 1Hz refresh, BLE SmartRow watchdog & race timer
        _timer = new Timer.Timer();
        (_timer as Timer.Timer).start(method(:onTimerTick), 1000, true);
    }

    public function onStop(state as Dictionary?) as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
        try {
            Sensor.enableSensorEvents(null);
        } catch (e) {
        }
        // Le joueur qui quitte l'application Garmin pendant le jeu a abandonne
        if (_bleDelegate.isSessionActive()) {
            _bleDelegate.discardSession();
        }
        _bleDelegate.disconnect();
    }

    public function onSensorEvent(sensorInfo as Sensor.Info) as Void {
        var hr = sensorInfo.heartRate;
        if (hr != null && hr > 0) {
            _model.heartRate = hr;
        } else if (_model.bleHeartRate > 0) {
            _model.heartRate = _model.bleHeartRate;
        }
    }

    public function onTimerTick() as Void {
        try {
            if (Toybox has :Activity) {
                var actInfo = Activity.getActivityInfo();
                if (actInfo != null && actInfo.currentHeartRate != null && actInfo.currentHeartRate > 0) {
                    _model.heartRate = actInfo.currentHeartRate as Number;
                } else if (_model.bleHeartRate > 0) {
                    _model.heartRate = _model.bleHeartRate;
                }
            }
        } catch (e) {
        }
        _bleDelegate.onOneSecondTick();
    }

    public function getInitialView() as [Views] or [Views, InputDelegates] {
        var view = new RowerView(_model);
        var delegate = new RowerDelegate(_bleDelegate, view);
        _bleDelegate.setView(view);
        return [view, delegate];
    }

    public function onSettingsChanged() as Void {
        WatchUi.requestUpdate();
    }
}

function getApp() as RowerApp {
    return Application.getApp() as RowerApp;
}
