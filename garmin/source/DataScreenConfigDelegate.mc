import Toybox.WatchUi;
import Toybox.Lang;
import Toybox.System;

class DataScreenConfigDelegate extends WatchUi.BehaviorDelegate {

    private var _view as DataScreenConfigView;

    public function initialize(view as DataScreenConfigView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    public function onKey(evt as WatchUi.KeyEvent) as Boolean {
        var key = evt.getKey();
        if (key == WatchUi.KEY_UP) {
            _view.prevItem();
            return true;
        } else if (key == WatchUi.KEY_DOWN) {
            _view.nextItem();
            return true;
        } else if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) {
            _view.handleSelect();
            return true;
        }
        return false;
    }

    public function onSelect() as Boolean {
        _view.handleSelect();
        return true;
    }

    public function onNextPage() as Boolean {
        _view.nextItem();
        return true;
    }

    public function onPreviousPage() as Boolean {
        _view.prevItem();
        return true;
    }

    public function onBack() as Boolean {
        if (!_view.handleBack()) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
        return true;
    }
}
