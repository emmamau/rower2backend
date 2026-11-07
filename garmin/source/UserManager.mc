import Toybox.Lang;
import Toybox.Math;
import Toybox.Application.Storage;
import Toybox.Application.Properties;
import Toybox.System;

class UserManager {
    private static const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private static const ALPHA_NUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    // Generates a 5-character random base62 string for immutable unique system suffix (without delimiter collisions)
    static function generateSuffix5() as String {
        var result = "";
        for (var i = 0; i < 5; i++) {
            var idx = Math.rand() % 62;
            if (idx < 0) {
                idx = -idx;
            }
            result += BASE64_CHARS.substring(idx, idx + 1);
        }
        return result;
    }

    // Generates 10-character free prefix on install (customizable by player in app settings)
    static function generateDefaultPrefix() as String {
        var result = "Row";
        for (var i = 0; i < 7; i++) {
            var idx = Math.rand() % 32;
            if (idx < 0) {
                idx = -idx;
            }
            result += ALPHA_NUM.substring(idx, idx + 1);
        }
        return result;
    }

    // Retrieves or creates the immutable 5-character base62 system suffix
    static function getSuffix() as String {
        var suffix = Storage.getValue("userUniqueSuffix");
        if (suffix != null && suffix instanceof String && (suffix as String).length() == 5 && (suffix as String).find("_") == null) {
            return suffix as String;
        }
        var newSuffix = generateSuffix5();
        Storage.setValue("userUniqueSuffix", newSuffix);
        return newSuffix;
    }

    // Retrieves the 10-character user customizable prefix (or default generated on installation)
    static function getPrefix() as String {
        try {
            var propVal = Properties.getValue("userLoginPrefix");
            if (propVal != null && propVal instanceof String && (propVal as String).length() > 0) {
                var p = (propVal as String);
                if (p.length() > 10) {
                    p = p.substring(0, 10);
                }
                return p;
            }
        } catch (ex) {
        }
        try {
            var loginVal = Properties.getValue("userLogin");
            if (loginVal != null && loginVal instanceof String && (loginVal as String).length() > 0) {
                var l = (loginVal as String);
                var sepIdx = l.find("_");
                if (sepIdx != null && sepIdx > 0) {
                    l = l.substring(0, sepIdx);
                }
                if (l.length() > 10) {
                    l = l.substring(0, 10);
                }
                if (l.length() > 0) {
                    return l;
                }
            }
        } catch (ex) {
        }
        var storedPrefix = Storage.getValue("userLoginPrefix");
        if (storedPrefix != null && storedPrefix instanceof String && (storedPrefix as String).length() > 0) {
            var sp = storedPrefix as String;
            if (sp.length() > 10) {
                sp = sp.substring(0, 10);
            }
            return sp;
        }
        var newPrefix = generateDefaultPrefix();
        Storage.setValue("userLoginPrefix", newPrefix);
        try {
            Properties.setValue("userLoginPrefix", newPrefix);
        } catch (ex) {
        }
        return newPrefix;
    }

    // Full 2-part Unique Player ID: {Prefix}_{5-char Base64 Suffix}
    static function getUserId() as String {
        // If legacy full ID stored and matches format, keep for backwards compatibility
        var prefix = getPrefix();
        var suffix = getSuffix();
        var fullId = prefix + "_" + suffix;
        Storage.setValue("userLogin", fullId);
        return fullId;
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

