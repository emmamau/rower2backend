import Toybox.Lang;
import Toybox.Communications;
import Toybox.Application.Properties;
import Toybox.System;

class RestSyncManager {

    private var _isSending as Boolean = false;
    private var _lastSyncTime as Number = 0;
    private var _delegate as BleDelegate?;

    function initialize(delegate as BleDelegate?) {
        _delegate = delegate;
    }

    function setDelegate(delegate as BleDelegate) as Void {
        _delegate = delegate;
    }

    function getBaseUrl() as String {
        var url = "https://rower-api-service.onrender.com";
        try {
            var configuredUrl = Properties.getValue("backendUrl");
            if (configuredUrl != null && configuredUrl instanceof String && (configuredUrl as String).length() > 0) {
                url = configuredUrl as String;
            }
        } catch (ex) {
            System.println("Error reading backendUrl property: " + ex.getErrorMessage());
        }

        // Clean trailing slash
        if (url.substring(url.length() - 1, url.length()).equals("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    // Poll next race status and connected participants
    function fetchNextRace() as Void {
        var endpoint = getBaseUrl() + "/api/race/next";
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            null,
            options,
            method(:onRaceInfoReceived)
        );
    }

    function onRaceInfoReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                (_delegate as BleDelegate).onLobbyDataReceived(data as Dictionary);
            } else {
                (_delegate as BleDelegate).onLobbyDataReceived(null);
            }
        }
    }

    // Join race in waiting mode
    function joinRace(userId as String, userName as String) as Void {
        var endpoint = getBaseUrl() + "/api/race/join";
        var payload = {
            "userId" => userId,
            "userName" => userName
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onJoinRaceResponse)
        );
    }

    function onJoinRaceResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                (_delegate as BleDelegate).onJoinRaceReceived(data as Dictionary);
            } else {
                (_delegate as BleDelegate).onJoinRaceReceived(null);
            }
        }
    }

    // Check pending login requests from the Angular web front
    function checkPendingLogin(userId as String) as Void {
        var endpoint = getBaseUrl() + "/api/user/auth/pending?userId=" + userId;
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            null,
            options,
            method(:onPendingLoginReceived)
        );
    }

    function onPendingLoginReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                var d = data as Dictionary;
                if (d.hasKey("hasPending") && d.get("hasPending") == true) {
                    var reqId = d.get("requestId").toString();
                    var login = d.get("login").toString();
                    (_delegate as BleDelegate).onAuthRequestReceived(reqId, login);
                }
            }
        }
    }

    // Respond to web login request
    function respondWebLogin(requestId as String, approved as Boolean) as Void {
        var endpoint = getBaseUrl() + "/api/user/auth/respond";
        var payload = {
            "requestId" => requestId,
            "approved" => approved
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onLoginResponseDone)
        );
    }

    function onLoginResponseDone(responseCode as Number, data as Dictionary or String or Null) as Void {
        System.println("Web login response submitted: " + responseCode);
    }

    // Toggle Bot Racers in current race
    function toggleBots(enable as Boolean, raceId as String?) as Void {
        var endpoint = getBaseUrl() + "/api/race/bots";
        var payload = {
            "enable" => enable,
            "botCount" => 3
        };
        if (raceId != null) {
            payload.put("raceId", raceId);
        }
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onToggleBotsResponse)
        );
    }

    function onToggleBotsResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        System.println("Bots toggled response: " + responseCode);
        if (_delegate != null && responseCode == 200 && data != null && data instanceof Dictionary) {
            (_delegate as BleDelegate).onBotsToggled(data as Dictionary);
        }
    }

    // Synchronize activity progress & stroke data with backend
    function syncActivity(activityId as String, userId as String, userName as String, raceMode as String,
                          status as String, targetDistance as Number, model as RowerDataModel,
                          deviceName as String?, isFinal as Boolean) as Void {
        var now = System.getTimer() / 1000;
        // Throttle transmission to 1 second
        if (_isSending || (now - _lastSyncTime < 1)) {
            return;
        }

        var endpoint = getBaseUrl() + "/api/activity/sync";

        var payload = {
            "activityId" => activityId,
            "userId" => userId,
            "userName" => userName,
            "raceMode" => raceMode,
            "status" => status,
            "targetDistance" => targetDistance,
            "currentDistance" => model.totalDistance,
            "strokeRate" => model.strokeRate,
            "strokeCount" => model.strokeCount,
            "instantPower" => model.instantPower,
            "avgPower" => model.avgPower,
            "instantPace" => model.instantPace,
            "avgPace" => model.avgPace,
            "heartRate" => model.heartRate,
            "totalEnergy" => model.totalEnergy,
            "elapsedTime" => model.elapsedTime
        };

        if (deviceName != null) {
            payload.put("deviceName", deviceName);
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
            (isFinal ? method(:onFinalSyncResponse) : method(:onSyncResponse))
        );
    }

    function onSyncResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        _isSending = false;
        _lastSyncTime = System.getTimer() / 1000;
        if (responseCode == 200 && data != null && data instanceof Dictionary) {
            if (_delegate != null) {
                (_delegate as BleDelegate).onLiveSyncResponse(data as Dictionary);
            }
        } else if (responseCode != 200 && responseCode != 201) {
            System.println("Sync HTTP non-200: " + responseCode);
        }
    }

    function onFinalSyncResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        _isSending = false;
        _lastSyncTime = System.getTimer() / 1000;
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                (_delegate as BleDelegate).onFinalSyncResponse(data as Dictionary);
            } else {
                (_delegate as BleDelegate).onFinalSyncResponse(null);
            }
        }
    }
}
