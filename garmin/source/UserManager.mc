import Toybox.Lang;
import Toybox.Math;
import Toybox.Application.Storage;
import Toybox.Application.Properties;
import Toybox.System;

class UserManager {
    private static const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    // Generates a 6-character random base64 string
    static function generateDefaultId() as String {
        var result = "";
        for (var i = 0; i < 6; i++) {
            var idx = Math.rand() % 64;
            if (idx < 0) {
                idx = -idx;
            }
            result += BASE64_CHARS.substring(idx, idx + 1);
        }
        return result;
    }

    // Retrieves existing userLogin or generates and persists a new 6-char base64 ID
    static function getUserId() as String {
        // 1. Check user configured setting/property
        try {
            var propVal = Properties.getValue("userLogin");
            if (propVal != null && propVal instanceof String && (propVal as String).length() > 0) {
                return propVal as String;
            }
        } catch (ex) {
            System.println("Error reading userLogin property: " + ex.getErrorMessage());
        }

        // 2. Check local persistent storage
        var storedId = Storage.getValue("userLogin");
        if (storedId != null && storedId instanceof String && (storedId as String).length() > 0) {
            return storedId as String;
        }

        // 3. Generate default random 6-character base64 identifier
        var newId = generateDefaultId();
        Storage.setValue("userLogin", newId);
        try {
            Properties.setValue("userLogin", newId);
        } catch (ex) {
            // Ignore if setting cannot be written directly on all API levels
        }
        System.println("Generated default anonymous player ID: " + newId);
        return newId;
    }
}

