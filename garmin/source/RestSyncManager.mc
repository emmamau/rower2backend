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
        return "https://rower-api-service.onrender.com";
    }

    // Poll next race status and connected participants
    function fetchNextRace() as Void {
        var endpoint = getBaseUrl() + "/api/race/next";
        if (_delegate != null) {
            var del = _delegate as BleDelegate;
            if (del.isInPrivateRace()) {
                endpoint = getBaseUrl() + "/api/v1/races/private/" + del.getActivityId();
            }
        }
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

    // Join race in waiting mode or with specific action
    function joinRace(userId as String, userName as String, action as String?) as Void {
        var endpoint = getBaseUrl() + "/api/race/join";
        var payload = {
            "userId" => userId,
            "userName" => userName,
            "action" => (action != null) ? action : "join"
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

    // Pair watch with 6-character code entered on watch
    function pairWatch(pairingCode as String) as Void {
        var endpoint = getBaseUrl() + "/api/garmin/pair";
        var payload = {
            "pairingCode" => pairingCode,
            "deviceId" => UserManager.getDeviceId()
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
            method(:onPairResponse)
        );
    }

    function onPairResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        System.println("Pair response: " + responseCode);
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                var d = data as Dictionary;
                if (d.hasKey("deviceToken") && d.get("deviceToken") != null) {
                    var token = d.get("deviceToken").toString();
                    UserManager.setDeviceToken(token);
                    if (d.hasKey("userId") && d.get("userId") != null) {
                        UserManager.setPairedUserId(d.get("userId").toString());
                    }
                    (_delegate as BleDelegate).onPairingSuccess(d);
                    return;
                }
            }
            (_delegate as BleDelegate).onPairingFailed(responseCode);
        }
    }

    // Reset pairing from watch
    function resetPairing() as Void {
        var endpoint = getBaseUrl() + "/api/garmin/reset";
        var token = UserManager.getDeviceToken();
        var payload = {
            "deviceToken" => (token != null ? token : "")
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        UserManager.clearPairing();

        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onResetPairingResponse)
        );
    }

    function onResetPairingResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        System.println("Reset pairing response: " + responseCode);
        if (_delegate != null) {
            (_delegate as BleDelegate).onPairingResetDone();
        }
    }

    // Toggle Bot Racers in current race (calibrated with user level)
    function toggleBots(enable as Boolean, raceId as String?, userId as String?) as Void {
        var endpoint = getBaseUrl() + "/api/race/bots";
        var payload = {
            "enable" => enable,
            "botCount" => 3
        };
        if (raceId != null) {
            payload.put("raceId", raceId);
        }
        if (userId != null) {
            payload.put("userId", userId);
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

    // Fetch user profile stats (Points, General Rank, Last Rank, Best Rank)
    function fetchUserProfile(userId as String) as Void {
        var endpoint = getBaseUrl() + "/api/user/profile/" + userId;
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            null,
            options,
            method(:onUserProfileReceived)
        );
    }

    function onUserProfileReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null && responseCode == 200 && data != null && data instanceof Dictionary) {
            (_delegate as BleDelegate).onUserProfileData(data as Dictionary);
        }
    }

    // Synchronize activity progress & stroke data with backend
    function syncActivity(activityId as String, userId as String, userName as String, raceMode as String,
                          status as String, targetDistance as Number, model as RowerDataModel,
                          deviceName as String?, isFinal as Boolean) as Void {
        var now = System.getTimer() / 1000;
        // Throttle live transmission to >= 1s, never drop final completion/abandon packet
        if (!isFinal && (_isSending || (now - _lastSyncTime < 1))) {
            return;
        }

        var endpoint = getBaseUrl() + "/boost";

        var effPace = (model.instantPace > 0) ? model.instantPace : ((!model.isHalted && model.avgPace > 0) ? model.avgPace : 0);
        var effPower = (model.instantPower > 0) ? model.instantPower : ((!model.isHalted && model.avgPower > 0) ? model.avgPower : 0);
        var effSpm = (model.strokeRate > 0.0f) ? model.strokeRate : ((!model.isHalted && model.avgStrokeRate > 0.0f) ? model.avgStrokeRate : 0.0f);

        var metrics = {
            "distanceM" => model.totalDistance,
            "splitSec" => effPace,
            "powerWatts" => effPower,
            "strokeRate" => effSpm,
            "spm" => effSpm,
            "heartRate" => model.heartRate
        };

        var payload = {
            "raceId" => activityId,
            "userId" => userId,
            "userName" => userName,
            "raceMode" => raceMode,
            "status" => status,
            "targetDistance" => targetDistance,
            "seq" => model.strokeCount,
            "timestamp" => System.getTimer(),
            "elapsedTime" => model.elapsedTime,
            "currentDistance" => model.totalDistance,
            "instantPower" => effPower,
            "instantPace" => effPace,
            "strokeRate" => effSpm,
            "spm" => effSpm,
            "metrics" => metrics
        };

        var devToken = UserManager.getDeviceToken();
        if (devToken != null && (devToken as String).length() > 0) {
            payload.put("deviceToken", devToken);
        }

        if (deviceName != null) {
            payload.put("deviceName", deviceName);
            payload.put("rowerModel", deviceName);
        }
        payload.put("watchModel", UserManager.getWatchModel());

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
        };
        if (devToken != null && (devToken as String).length() > 0) {
            headers.put("Authorization", "Bearer " + (devToken as String));
        }

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
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

    // Join private room using POST /api/rooms/join with deviceToken & quota verification
    function joinRoomByCode(code as String, userId as String, userName as String) as Void {
        var endpoint = getBaseUrl() + "/api/rooms/join";
        var devToken = UserManager.getDeviceToken();
        var payload = {
            "code" => code,
            "userId" => userId,
            "userName" => userName
        };
        if (devToken != null && (devToken as String).length() > 0) {
            payload.put("deviceToken", devToken);
        }

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
        };
        if (devToken != null && (devToken as String).length() > 0) {
            headers.put("Authorization", "Bearer " + (devToken as String));
        }

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onPinVerified)
        );
    }

    // Backward-compatible alias
    function checkPinCode(pin as String, userId as String, userName as String) as Void {
        joinRoomByCode(pin, userId, userName);
    }

    function onPinVerified(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                (_delegate as BleDelegate).onPinJoinSuccess(data as Dictionary);
            } else {
                (_delegate as BleDelegate).onPinJoinFailed(responseCode, data);
            }
        }
    }

    // Polling participant approval status from host
    function checkApprovalStatus(raceId as String, userId as String) as Void {
        var endpoint = getBaseUrl() + "/api/v1/races/private/" + raceId + "/participant-status?userId=" + userId;
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            null,
            options,
            method(:onApprovalStatusReceived)
        );
    }

    function onApprovalStatusReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null) {
            (_delegate as BleDelegate).onApprovalStatusResponse(responseCode, data);
        }
    }
}
