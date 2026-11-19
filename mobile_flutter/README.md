# RowerRace Mobile (Flutter / Dart)

Application mobile multiplateforme haute performance (**Android & iOS**) pour rameurs connectés en Bluetooth Low Energy (**BLE FTMS**), conçue pour disputer des régates multijoueur en temps réel contre des rameurs distants (montres Garmin + navigateur, autres mobiles Flutter ou bots).

---

## 1. Architecture & Interopérabilité Absolue

L'application agit simultanément comme **le capteur de télémétrie** (comme la montre Garmin) et **l'écran d'affichage de régate** (comme l'application web React) en s'appuyant **100 % nativement** sur l'infrastructure existante :
- **Serveur API REST & WebSocket :** Hébergé sur Render (`https://rower-api-service.onrender.com`).
- **Télémétrie `/boost` :** Envoi périodique et à chaque coup de rame du contrat exact attendu par `RestSyncManager` / `TelemetryController` avec `deviceToken` ou Bearer JWT.
- **WebSocket Socket.IO v4 :** Écoute des événements `race:leaderboard_update`, `race:status_change`, `race:private_update`.
- **Règles Anti-Triche :** Séquence salon $\rightarrow$ détection premier coup $\rightarrow$ `READY` $\rightarrow$ décompte 15s avec alerte rouge clignotante + haptique si mouvement $\rightarrow$ blocage à $0\,\text{m}$ à $T=0$ si non arrêté $\rightarrow$ boîte de confirmation d'abandon DNF.

---

## 2. Structure du Projet

```
mobile_flutter/
├── android/
│   └── app/src/main/AndroidManifest.xml   # Permissions BLE Android 12+ (BLUETOOTH_SCAN, CONNECT), WakeLock, Internet
├── ios/
│   └── Runner/Info.plist                  # NSBluetoothAlwaysUsageDescription & Background Modes
├── lib/
│   ├── core/
│   │   ├── config/app_config.dart         # URL Render par défaut + --dart-define=API_URL
│   │   ├── network/
│   │   │   ├── api_client.dart            # Dio HTTP + Intercepteurs JWT & deviceToken
│   │   │   └── realtime_socket_service.dart # Socket.IO v4 client résilient (heartbeat & reconnexion)
│   │   ├── storage/secure_storage_service.dart # Stockage chiffré (deviceId UUID v4, tokens, lastBleId)
│   │   └── theme/app_theme.dart           # Dark Carbon, Cyan néon, Ambre, Rouge
│   ├── features/
│   │   ├── auth/
│   │   │   ├── controllers/auth_controller.dart # Auth login, code 5 car., auto-provisioning deviceToken
│   │   │   ├── models/user_profile.dart   # Profil utilisateur, ligue (Or, Argent, Bronze), points
│   │   │   └── widgets/                   # Modales de connexion et pavé 5 cases majuscules
│   │   ├── ble/
│   │   │   ├── models/rowing_metrics.dart # SPM, Watts, /500m, distance, tare matérielle
│   │   │   ├── services/ble_ftms_service.dart # Décodeur 16-bit LE FTMS 0x2AD1, tare, physique Concept2
│   │   │   └── widgets/ble_scanner_sheet.dart # Feuille de scan & appairage BLE 1-tap
│   │   ├── home/
│   │   │   └── screens/home_screen.dart   # Accueil épuré (Bannière, 3 modes de course directs)
│   │   └── race/
│   │       ├── controllers/race_controller.dart # Machine à états de course, anti-triche, sync /boost
│   │       ├── models/                    # LiveRacerMetric, RaceSessionState, RacePhase
│   │       ├── screens/race_screen.dart   # Écran régate plein écran sans scroll, Wakelock, PopScope DNF
│   │       └── widgets/
│   │           ├── regatta_water_painter.dart # Plan d'eau 2D 60 FPS CustomPainter
│   │           ├── telemetry_hud_bar.dart # HUD basse visibilité (W, /500m, SPM, distance, chrono, rang)
│   │           ├── fullscreen_cockpit.dart # Vue cockpit plein écran gros chiffres
│   │           ├── false_start_overlay.dart # Alerte faux départ rouge clignotante + vibration
│   │           └── podium_finish_modal.dart # Podium Top 3, statistiques zéro NaN, points +XX pts
│   └── main.dart                          # Point d'entrée, SystemChrome, ProviderScope
├── test/
│   ├── ftms_decoder_test.dart             # Tests unitaires décodage FTMS 0x2AD1 & physique Concept2
│   └── race_anti_cheat_test.dart          # Tests unitaires machine à états et règles anti-triche
└── pubspec.yaml                           # Dépendances Flutter 3 / Dart 3
```

---

## 3. Prérequis & Installation

### Prérequis
- Flutter SDK $\ge 3.19.0$ (Dart $\ge 3.3.0$)
- Android Studio ou Xcode pour les émulateurs / appareils réels
- Un rameur compatible Bluetooth FTMS (Concept2 PM5, WaterRower ComModule, Merach, Domyos, etc.)

### Installation des dépendances
```bash
cd mobile_flutter
flutter pub get
```

---

## 4. Exécution & Configuration

### Démarrage avec l'URL backend par défaut (Render)
```bash
flutter run
```

### Démarrage avec une URL backend personnalisée (ex: local ou staging)
```bash
flutter run --dart-define=API_URL=https://rower-api-service.onrender.com
# Ou pour tester sur un backend Node local depuis un smartphone physique :
flutter run --dart-define=API_URL=http://192.168.1.50:3000
```

---

## 5. Exécution des Tests Unitaires

```bash
flutter test
```
Les tests valident :
1. Le décodage binaire des drapeaux 16-bit Little Endian FTMS `0x2AD1`.
2. L'inversion du drapeau "More Data" pour les coups de rame.
3. La dérivation Concept2 de l'allure à partir des Watts ($\text{pace} = \sqrt[3]{2.80 / W} \times 500$).
4. La tare matérielle `reTareToZero()`.
5. La machine à états anti-triche (passage `READY`, alerte décompte 15s, blocage à $0\,\text{m}$ au signal).

---

## 6. Compilation pour Déploiement

### Android (APK & App Bundle)
```bash
# APK Release
flutter build apk --release --dart-define=API_URL=https://rower-api-service.onrender.com

# Android App Bundle pour le Google Play Store
flutter build appbundle --release --dart-define=API_URL=https://rower-api-service.onrender.com
```

### iOS (IPA & Archive Xcode)
```bash
flutter build ipa --release --dart-define=API_URL=https://rower-api-service.onrender.com
```

---

## 7. Permissions & Déploiement Appareil Réel

- **Android 12+ (API 31+) :** Nécessite les permissions d'exécution `BLUETOOTH_SCAN` et `BLUETOOTH_CONNECT` avec l'attribut `neverForLocation` (déjà configuré dans [AndroidManifest.xml](file:///c:/Users/Emma/repos/connectiq/rower2backend/mobile_flutter/android/app/src/main/AndroidManifest.xml)).
- **Android 11 et inférieur :** Utilise `ACCESS_FINE_LOCATION` pour la découverte des périphériques BLE.
- **iOS :** Nécessite `NSBluetoothAlwaysUsageDescription` et `NSBluetoothPeripheralUsageDescription` (déjà configuré dans [Info.plist](file:///c:/Users/Emma/repos/connectiq/rower2backend/mobile_flutter/ios/Runner/Info.plist)).
- **Maintien de l'écran allumé :** Géré automatiquement via `wakelock_plus` dès l'entrée dans l'écran de course et relâché à la sortie.
