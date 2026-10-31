import Toybox.Lang;
import Toybox.Communications;
import Toybox.Application.Properties;
import Toybox.System;

class RestSyncManager {

    private var _isSending as Boolean = false;
    private var _lastSyncTime as Number = 0;

    function sendRowerData(model as RowerDataModel, deviceName as String?) as Void {
        var now = System.getTimer() / 1000;
        // Throttle transmission to 1 second
        if (_isSending || (now - _lastSyncTime < 1)) {
            return;
        }

        var url = "https://rower-api-service.onrender.com";
        try {
            var configuredUrl = Properties.getValue("backendUrl");
            if (configuredUrl != null && configuredUrl instanceof String && configuredUrl.length() > 0) {
                url = configuredUrl;
            }
        } catch (ex) {
            System.println("Error reading backendUrl property: " + ex.getErrorMessage());
        }

        // Clean trailing slash
        if (url.substring(url.length() - 1, url.length()).equals("/")) {
            url = url.substring(0, url.length() - 1);
        }
        var endpoint = url + "/api/rower/data";

        var payload = model.toDictionary();
        if (deviceName != null) {
            payload.put("deviceId", deviceName);
        }

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        _isSending = true;
        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onReceiveResponse)
        );
    }

    function onReceiveResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        _isSending = false;
        _lastSyncTime = System.getTimer() / 1000;
        if (responseCode == 200 || responseCode == 201) {
            System.println("HTTP Sync success: " + responseCode);
        } else {
            System.println("HTTP Sync failed with code: " + responseCode);
        }
    }
}

