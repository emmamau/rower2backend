import Toybox.Lang;
import Toybox.Communications;
import Toybox.Application.Properties;
import Toybox.System;

class RestSyncManager {

    private var _isSending as Boolean = false;
    private var _hasPendingSync as Boolean = false;
    private var _pendingIsFinal as Boolean = false;
    private var _pendingActivityId as String = "";
    private var _pendingUserId as String = "";
    private var _pendingUserName as String = "";
    private var _pendingRaceMode as String = "";
    private var _pendingStatus as String = "";
    private var _pendingTargetDist as Number = 0;
    private var _pendingModel as RowerDataModel?;
    private var _pendingDeviceName as String?;
    private var _finalRetryCount as Number = 0;
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
            "deviceId" => UserManager.getDeviceId(),
            "action" => (action != null) ? action : "join"
        };
        var devToken = UserManager.getDeviceToken();
        if (devToken != null && (devToken as String).length() > 0) {
            payload.put("deviceToken", devToken);
        }
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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
                (_delegate as BleDelegate).onJoinRaceFailed(responseCode, data);
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
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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
                    UserManager.setGuestPaired(false);
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
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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
        // Never overwrite a queued final packet with an in-progress packet
        if (_hasPendingSync && _pendingIsFinal && !isFinal) {
            return;
        }
        // Serialize HTTP requests so an in-flight 999m packet never races against or drops the 1000m final packet
        if (_isSending) {
            _hasPendingSync = true;
            _pendingIsFinal = isFinal;
            _pendingActivityId = activityId;
            _pendingUserId = userId;
            _pendingUserName = userName;
            _pendingRaceMode = raceMode;
            _pendingStatus = status;
            _pendingTargetDist = targetDistance;
            _pendingModel = model;
            _pendingDeviceName = deviceName;
            return;
        }
        _hasPendingSync = false;
        _pendingIsFinal = false;
        if (isFinal) {
            _pendingActivityId = activityId;
            _pendingUserId = userId;
            _pendingUserName = userName;
            _pendingRaceMode = raceMode;
            _pendingStatus = status;
            _pendingTargetDist = targetDistance;
            _pendingModel = model;
            _pendingDeviceName = deviceName;
        } else {
            _finalRetryCount = 0;
        }

        var endpoint = getBaseUrl() + "/boost";

        var effPace = (model.instantPace > 0) ? model.instantPace : ((!model.isHalted && model.avgPace > 0) ? model.avgPace : 0);
        var effPower = (model.instantPower > 0) ? model.instantPower : ((!model.isHalted && model.avgPower > 0) ? model.avgPower : 0);
        var effSpm = (model.strokeRate > 0.0f) ? model.strokeRate : ((!model.isHalted && model.avgStrokeRate > 0.0f) ? model.avgStrokeRate : 0.0f);
        var sendDist = model.totalDistance;
        if ((status.equals("completed") || status.equals("finished")) && targetDistance > 0 && sendDist < targetDistance) {
            sendDist = targetDistance;
        }

        var metrics = {
            "distanceM" => sendDist,
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
            "currentDistance" => sendDist,
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
        payload.put("deviceId", UserManager.getDeviceId());

        if (deviceName != null) {
            payload.put("deviceName", deviceName);
            payload.put("rowerModel", deviceName);
        }
        payload.put("watchModel", UserManager.getWatchModel());

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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
        if (_hasPendingSync && _pendingModel != null) {
            var nextIsFinal = _pendingIsFinal;
            _hasPendingSync = false;
            _pendingIsFinal = false;
            syncActivity(
                _pendingActivityId, _pendingUserId, _pendingUserName, _pendingRaceMode,
                _pendingStatus, _pendingTargetDist, _pendingModel as RowerDataModel,
                _pendingDeviceName, nextIsFinal
            );
        }
    }

    function onFinalSyncResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        _isSending = false;
        _lastSyncTime = System.getTimer() / 1000;
        if (responseCode != 200 && responseCode != 201 && _finalRetryCount < 1 && _pendingModel != null && _pendingActivityId.length() > 0) {
            _finalRetryCount += 1;
            syncActivity(
                _pendingActivityId, _pendingUserId, _pendingUserName, _pendingRaceMode,
                _pendingStatus, _pendingTargetDist, _pendingModel as RowerDataModel,
                _pendingDeviceName, true
            );
            return;
        }
        _finalRetryCount = 0;
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                (_delegate as BleDelegate).onFinalSyncResponse(data as Dictionary);
            } else {
                (_delegate as BleDelegate).onFinalSyncResponse(null);
            }
        }
    }

    // Code Unique Universel à 5 Caractères (POST /api/session/claim)
    private var _lastClaimedCode as String = "";

    function claimSessionCode(code as String) as Void {
        _lastClaimedCode = code;
        var endpoint = getBaseUrl() + "/api/session/claim";
        var payload = {
            "code" => code,
            "deviceId" => UserManager.getDeviceId(),
            "pseudo" => UserManager.getDisplayPseudo(),
            "playerName" => UserManager.getDisplayPseudo()
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onClaimSessionResponse)
        );
    }

    function onClaimSessionResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                var d = data as Dictionary;
                if (d.hasKey("deviceToken") && d.get("deviceToken") != null) {
                    UserManager.setDeviceToken(d.get("deviceToken").toString());
                }
                var mode = d.hasKey("mode") ? d.get("mode").toString() : "paired";
                var isLinkCode = false;
                if (d.hasKey("isLinkCode") && d.get("isLinkCode") == true) {
                    isLinkCode = true;
                } else if (d.hasKey("type") && d.get("type").toString().equals("account_link")) {
                    isLinkCode = true;
                } else if (mode.equals("paired")) {
                    isLinkCode = true;
                }

                if (isLinkCode) {
                    UserManager.setGuestPaired(false);
                    var userLogin = "";
                    if (d.hasKey("login") && d.get("login") != null) {
                        userLogin = d.get("login").toString();
                    } else if (d.hasKey("playerName") && d.get("playerName") != null) {
                        userLogin = d.get("playerName").toString();
                    } else if (d.hasKey("userName") && d.get("userName") != null) {
                        userLogin = d.get("userName").toString();
                    } else if (d.hasKey("userId") && d.get("userId") != null) {
                        userLogin = d.get("userId").toString();
                    }
                    if (userLogin.length() > 0) {
                        UserManager.setGuestPseudo(userLogin);
                        UserManager.setPairedUserId(userLogin);
                    }
                    (_delegate as BleDelegate).onPairingSuccess(d);
                } else {
                    if (mode.equals("room") || mode.equals("cockpit")) {
                        UserManager.setGuestPaired(true);
                    }
                    if (d.hasKey("playerName") && d.get("playerName") != null) {
                        var pName = d.get("playerName").toString();
                        if (pName.length() > 0 && pName.find("Rameur_") != 0) {
                            UserManager.setGuestPseudo(pName);
                        }
                    }
                    if (d.hasKey("userId") && d.get("userId") != null) {
                        UserManager.setPairedUserId(d.get("userId").toString());
                    }
                    var isRoomJoin = mode.equals("room") ||
                        (d.hasKey("roomId") && d.get("roomId") != null && d.get("roomId").toString().length() > 0);
                    if (isRoomJoin) {
                        (_delegate as BleDelegate).onPinJoinSuccess(d);
                    } else {
                        (_delegate as BleDelegate).onPairingSuccess(d);
                    }
                }
            } else {
                // Notifier l'échec de validation du code PIN
                if (responseCode == 404 || responseCode == 400 || responseCode == 401 || responseCode == 403 || responseCode == 409 || responseCode == 410) {
                    (_delegate as BleDelegate).onPinJoinFailed(responseCode, data);
                } else if (_lastClaimedCode.length() > 0) {
                    // En cas d'échec sur /api/session/claim (ex: timeout ou réseau), tenter le fallback claimGuestTicket pour compatibilité
                    claimGuestTicket(_lastClaimedCode);
                } else {
                    (_delegate as BleDelegate).onPinJoinFailed(responseCode, data);
                }
            }
        }
    }

    // Parcours 2 : Validation atomique du Ticket Invité 5 caractères (POST /api/garmin/claim-ticket)
    function claimGuestTicket(ticketPin as String) as Void {
        var endpoint = getBaseUrl() + "/api/garmin/claim-ticket";
        var payload = {
            "ticketPin" => ticketPin,
            "pin" => ticketPin,
            "deviceId" => UserManager.getDeviceId()
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            endpoint,
            payload,
            options,
            method(:onClaimTicketResponse)
        );
    }

    function onClaimTicketResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null) {
            if (responseCode == 200 && data != null && data instanceof Dictionary) {
                var d = data as Dictionary;
                if (d.hasKey("deviceToken") && d.get("deviceToken") != null) {
                    UserManager.setDeviceToken(d.get("deviceToken").toString());
                    UserManager.setGuestPaired(true);
                }
                if (d.hasKey("guestName") && d.get("guestName") != null) {
                    UserManager.setGuestPseudo(d.get("guestName").toString());
                } else if (d.hasKey("userName") && d.get("userName") != null) {
                    UserManager.setGuestPseudo(d.get("userName").toString());
                }
                if (d.hasKey("userId") && d.get("userId") != null) {
                    UserManager.setPairedUserId(d.get("userId").toString());
                } else if (d.hasKey("guestName") && d.get("guestName") != null) {
                    UserManager.setPairedUserId(d.get("guestName").toString());
                }
                (_delegate as BleDelegate).onPinJoinSuccess(d);
            } else {
                (_delegate as BleDelegate).onPinJoinFailed(responseCode, data);
            }
        }
    }

    // Machine à États BLE : Notification READY du rameur au serveur (POST /api/rooms/:roomId/status)
    function notifyRoomReady(roomId as String, ready as Boolean, userId as String) as Void {
        if (roomId == null || roomId.length() == 0) {
            return;
        }
        var endpoint = getBaseUrl() + "/api/rooms/" + roomId + "/status";
        var devToken = UserManager.getDeviceToken();
        var payload = {
            "ready" => ready,
            "userId" => userId
        };
        if (devToken != null && (devToken as String).length() > 0) {
            payload.put("deviceToken", devToken);
        }

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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
            method(:onRoomReadyResponse)
        );
    }

    function onRoomReadyResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (_delegate != null && responseCode == 200 && data != null && data instanceof Dictionary) {
            (_delegate as BleDelegate).onRoomReadyConfirmed(data as Dictionary);
        }
    }

    // Join private room using POST /api/rooms/join with deviceToken & quota verification
    function joinRoomByCode(code as String, userId as String, userName as String) as Void {
        if (code != null && code.length() == 5) {
            claimSessionCode(code);
            return;
        }
        // Si la montre n'est pas encore liée à un compte web, tenter le Parcours 2 atomique (claim-ticket)
        if (!UserManager.isPaired() || UserManager.isGuestSession()) {
            claimGuestTicket(code);
            return;
        }
        var endpoint = getBaseUrl() + "/api/rooms/join";
        var devToken = UserManager.getDeviceToken();
        var isRowerAwake = false;
        if (_delegate != null) {
            var mdl = (_delegate as BleDelegate).getModel();
            isRowerAwake = (mdl.instantPower > 0 || mdl.strokeRate > 0.0f);
        }
        var payload = {
            "pin" => code,
            "code" => code,
            "userId" => userId,
            "userName" => userName,
            "ready" => isRowerAwake
        };
        if (devToken != null && (devToken as String).length() > 0) {
            payload.put("deviceToken", devToken);
        }

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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

    // Leave / abandon private room (POST /api/rooms/leave)
    function leaveRoom(roomId as String, userId as String) as Void {
        if (roomId == null || roomId.length() == 0) {
            return;
        }
        var endpoint = getBaseUrl() + "/api/rooms/leave";
        var devToken = UserManager.getDeviceToken();
        var payload = {
            "roomId" => roomId,
            "code" => roomId,
            "userId" => userId
        };
        if (devToken != null && (devToken as String).length() > 0) {
            payload.put("deviceToken", devToken);
        }

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "x-garmin-signature" => "CIQ_OFFICIAL_ROWER_V1"
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
            method(:onLeaveRoomResponse)
        );
    }

    function onLeaveRoomResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        // Silently handled or logged
    }
}
