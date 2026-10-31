import Toybox.WatchUi;

class RowerDelegate extends WatchUi.BehaviorDelegate {

    private var _bleDelegate as BleDelegate;

    function initialize(bleDelegate as BleDelegate) {
        BehaviorDelegate.initialize();
        _bleDelegate = bleDelegate;
    }

    // Press Select / Start-Stop to toggle scan / reconnect
    function onSelect() as Boolean {
        _bleDelegate.startScan();
        return true;
    }

    function onBack() as Boolean {
        _bleDelegate.stopScan();
        _bleDelegate.disconnect();
        return false; // allow exit
    }
}

