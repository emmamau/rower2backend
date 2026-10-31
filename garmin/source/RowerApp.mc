import Toybox.Application;
import Toybox.Application.Storage;
import Toybox.Application.Properties;
import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.BluetoothLowEnergy;

class RowerApp extends Application.AppBase {

    private var _view as RowerView?;
    private var _bleDelegate as BleDelegate?;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
        _bleDelegate = new BleDelegate();
        BluetoothLowEnergy.setDelegate(_bleDelegate as BleDelegate);
        _bleDelegate.startScan();
    }

    function onStop(state as Dictionary?) as Void {
        if (_bleDelegate != null) {
            _bleDelegate.stopScan();
            _bleDelegate.disconnect();
        }
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        _view = new RowerView();
        if (_bleDelegate != null) {
            _bleDelegate.setView(_view as RowerView);
        }
        return [_view as WatchUi.View, new RowerDelegate(_bleDelegate as BleDelegate)];
    }

    function onSettingsChanged() as Void {
        WatchUi.requestUpdate();
    }
}

function getApp() as RowerApp {
    return Application.getApp() as RowerApp;
}

