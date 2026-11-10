import Toybox.Lang;
import Toybox.Math;
import Toybox.Application.Storage;
import Toybox.Application.Properties;
import Toybox.System;

class UserManager {
    // Identifiant joueur : renvoie exclusivement le login/username du compte appairé
    static function getUserId() as String {
        var paired = getPairedUserId();
        if (paired != null && paired.length() > 0) {
            return paired;
        }
        try {
            var propLogin = Properties.getValue("userLogin");
            if (propLogin != null && propLogin instanceof String && (propLogin as String).length() > 0) {
                return propLogin as String;
            }
        } catch (ex) {
        }
        var stored = Storage.getValue("userLogin");
        if (stored != null && stored instanceof String && (stored as String).length() > 0) {
            return stored as String;
        }
        var guestPseudo = Storage.getValue("guestPseudo");
        if (guestPseudo != null && guestPseudo instanceof String && (guestPseudo as String).length() > 0) {
            return guestPseudo as String;
        }
        return "Rameur_42";
    }

    static function isGuestSession() as Boolean {
        var isGuestFlag = Storage.getValue("isGuestPaired");
        if (isGuestFlag != null && isGuestFlag instanceof Boolean && (isGuestFlag as Boolean) == true) {
            return true;
        }
        if (!isPaired()) {
            return true;
        }
        var uid = getPairedUserId();
        if (uid != null && (uid as String).find("guest_") == 0) {
            return true;
        }
        return false;
    }

    static function setGuestPaired(isGuest as Boolean) as Void {
        Storage.setValue("isGuestPaired", isGuest);
    }

    static function setGuestPseudo(pseudo as String) as Void {
        Storage.setValue("guestPseudo", pseudo);
        Storage.setValue("userLogin", pseudo);
    }

    static function getDisplayPseudo() as String {
        if (isGuestSession()) {
            var gp = Storage.getValue("guestPseudo");
            if (gp != null && gp instanceof String && (gp as String).length() > 0) {
                return gp as String;
            }
            var ul = Storage.getValue("userLogin");
            if (ul != null && ul instanceof String && (ul as String).length() > 0 && (ul as String).find("guest_") != 0) {
                return ul as String;
            }
        }
        return getUserId();
    }

    static function getActiveProfileLabel() as String {
        var displayName = getDisplayPseudo();
        if (isPaired() && !isGuestSession()) {
            return "Joueur : " + displayName + " (Compte Web)";
        }
        return "Joueur : " + displayName + " (Invite)";
    }

    // Identifiant matériel unique de la montre pour l'appairage sécurisé
    static function getDeviceId() as String {
        var devId = Storage.getValue("deviceId");
        if (devId != null && devId instanceof String && (devId as String).length() > 0) {
            return devId as String;
        }
        try {
            var settings = System.getDeviceSettings();
            if (settings has :uniqueIdentifier && settings.uniqueIdentifier != null) {
                devId = settings.uniqueIdentifier as String;
                Storage.setValue("deviceId", devId);
                return devId as String;
            }
        } catch (ex) {
        }
        var newDevId = "garmin_" + (System.getTimer() % 100000);
        Storage.setValue("deviceId", newDevId);
        return newDevId;
    }

    // Jeton cryptographique persistant UUID v4 (deviceToken)
    static function getDeviceToken() as String? {
        var token = Storage.getValue("deviceToken");
        if (token != null && token instanceof String && (token as String).length() > 0) {
            return token as String;
        }
        return null;
    }

    static function setDeviceToken(token as String) as Void {
        Storage.setValue("deviceToken", token);
    }

    static function deleteDeviceToken() as Void {
        Storage.deleteValue("deviceToken");
    }

    static function isPaired() as Boolean {
        var t = getDeviceToken();
        return t != null && t.length() > 0;
    }

    static function getPairedUserId() as String? {
        var uid = Storage.getValue("pairedUserId");
        if (uid != null && uid instanceof String && (uid as String).length() > 0) {
            return uid as String;
        }
        return null;
    }

    static function setPairedUserId(userId as String) as Void {
        Storage.setValue("pairedUserId", userId);
    }

    static function clearPairing() as Void {
        Storage.deleteValue("deviceToken");
        Storage.deleteValue("pairedUserId");
        Storage.deleteValue("isGuestPaired");
    }

    // Alias for explicit user login display
    static function getUserLogin() as String {
        return getUserId();
    }

    // Get watch device model string
    static function getWatchModel() as String {
        var model = "Garmin Watch";
        try {
            var settings = System.getDeviceSettings();
            if (settings has :partNumber && settings.partNumber != null) {
                model = "Garmin " + settings.partNumber;
            }
        } catch (ex) {
        }
        return model;
    }
}

