import Toybox.Lang;
import Toybox.Math;
import Toybox.Application.Storage;
import Toybox.Application.Properties;
import Toybox.System;

class UserManager {
    private static const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    private static const ALPHA_NUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    // Generates a 5-character random base64 string for immutable unique system suffix
    static function generateSuffix5() as String {
        var result = "";
        for (var i = 0; i < 5; i++) {
            var idx = Math.rand() % 64;
            if (idx < 0) {
                idx = -idx;
            }
            result += BASE64_CHARS.substring(idx, idx + 1);
        }
        return result;
    }

    // Generates random 4-char prefix on install (customizable by subscribers)
    static function generateDefaultPrefix() as String {
        var result = "Row";
        for (var i = 0; i < 3; i++) {
            var idx = Math.rand() % 32;
            if (idx < 0) {
                idx = -idx;
            }
            result += ALPHA_NUM.substring(idx, idx + 1);
        }
        return result;
    }

    // Retrieves or creates the immutable 5-character base64 system suffix
    static function getSuffix() as String {
        var suffix = Storage.getValue("userUniqueSuffix");
        if (suffix != null && suffix instanceof String && (suffix as String).length() == 5) {
            return suffix as String;
        }
        var newSuffix = generateSuffix5();
        Storage.setValue("userUniqueSuffix", newSuffix);
        return newSuffix;
    }

    // Retrieves the user customizable prefix (or default generated on installation)
    static function getPrefix() as String {
        try {
            var propVal = Properties.getValue("userLoginPrefix");
            if (propVal != null && propVal instanceof String && (propVal as String).length() > 0) {
                return propVal as String;
            }
        } catch (ex) {
        }
        var storedPrefix = Storage.getValue("userLoginPrefix");
        if (storedPrefix != null && storedPrefix instanceof String && (storedPrefix as String).length() > 0) {
            return storedPrefix as String;
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

