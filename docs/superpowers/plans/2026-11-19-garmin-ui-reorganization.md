# Garmin UI Reorganization & Offline Solo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Garmin Connect IQ app menu structure to start directly on a 4-option Main Menu before pairing, provide a sub-menu "Autres choix" for secondary options (Kayak, Data screens, History), defer platform pairing to PIN entry or public race selection, and implement an offline "Seul" solo rowing mode with direct BLE rower connection and local FIT recording without platform network connectivity.

**Architecture:**
- The watch application entry point `RowerView` defaults to `STATE_MENU` (Main Menu) instead of `STATE_SCANNING`.
- A new UI state `STATE_SUBMENU_MORE = 18` handles the "Autres choix" sub-menu.
- `BleDelegate.startScan()` removes the `UserManager.isPaired()` constraint, allowing BLE connection to the rower for solo mode without any platform pairing.
- The "Seul" mode runs purely offline: connects to FTMS/SmartRow BLE, tare metrics, starts local `ActivityRecording.Session` (FIT file), disables REST telemetry synchronization, and handles local pause/resume/save/discard.
- Platform pairing and lobby entry only trigger upon entering a PIN code or choosing "Course publique".

**Tech Stack:** Connect IQ Monkey C (SDK 9.2.0), Toybox (WatchUi, BluetoothLowEnergy, ActivityRecording, FitContributor, Communications).

---

## Global Constraints
- Target devices: `fr970`, `enduro3` as defined in `manifest.xml`.
- Preserves all existing network telemetry logic for online races (`_raceMode == "race"`).
- Strict backward compatibility with Garmin physical buttons (START/SELECT, UP, DOWN, BACK) and touchscreen gestures.

---

### Task 1: Internationalization Strings

**Files:**
- Modify: `garmin/source/I18n.mc:130-185`

**Interfaces:**
- Produces: `I18n.getText("MENU_MORE")`, `I18n.getText("SUBMENU_MORE_TITLE")`, `I18n.getText("SUBMENU_KAYAK")`, updated `I18n.getText("MENU_SOLO")`.

- [ ] **Step 1: Add new translation keys in `garmin/source/I18n.mc`**
  - Add `MENU_MORE` returning "Autres choix" (FR), "More Options" (EN), "Weitere Optionen" (DE), "Otras opciones" (ES), "Altre opzioni" (IT), "Outras opcoes" (PT).
  - Update `MENU_SOLO` returning "Seul" (FR), "Solo" (EN/DE/ES/IT/PT).
  - Add `SUBMENU_MORE_TITLE` returning "AUTRES CHOIX" (FR), "MORE OPTIONS" (EN).
  - Add `SUBMENU_KAYAK` returning "Kayak" (FR/EN).

- [ ] **Step 2: Verify compilation**
  Run: `& "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d fr970 -f garmin\monkey.jungle -y developer_key.der -o garmin\bin\test.prg`
  Expected: BUILD SUCCESSFUL

---

### Task 2: Sub-Menu State & Menu Layout in `RowerView`

**Files:**
- Modify: `garmin/source/RowerView.mc`

**Interfaces:**
- Consumes: `I18n.getText("MENU_MORE")`, `I18n.getText("SUBMENU_MORE_TITLE")`
- Produces: `RowerView.STATE_SUBMENU_MORE`, `getMainMenuItemCount() == 4`, `getSubMenuItemCount() == 3`, `nextSubMenu()`, `prevSubMenu()`, `getSubMenuIndex()`

- [ ] **Step 1: Add `STATE_SUBMENU_MORE = 18` and sub-menu navigation members**
  - Define `public static const STATE_SUBMENU_MORE = 18;`
  - Initialize `_currentState = STATE_MENU;` by default.
  - Add `private var _subMenuIndex as Number = 0;`
  - Add `nextSubMenu()`, `prevSubMenu()`, `getSubMenuIndex()`, `getSubMenuItemCount()`.

- [ ] **Step 2: Update `getMainMenuItemCount()` and `drawMainMenu`**
  - Set `getMainMenuItemCount()` to always return 4:
    1. Entrer un code pin
    2. Course publique
    3. Seul
    4. Autres choix
  - In `onUpdate`: render `STATE_MENU` with these 4 items.
  - In `onUpdate`: handle `_currentState == STATE_SUBMENU_MORE` rendering `drawGarminMenuScreen` with:
    1. "Kayak : " + `UserManager.getDisplayPseudo()`
    2. "Ecrans de données"
    3. "Historique"

- [ ] **Step 3: Verify compilation**
  Run: `& "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d fr970 -f garmin\monkey.jungle -y developer_key.der -o garmin\bin\test.prg`
  Expected: BUILD SUCCESSFUL

---

### Task 3: Uncouple BLE Scan from Web Pairing & Enhance Solo Mode in `BleDelegate`

**Files:**
- Modify: `garmin/source/BleDelegate.mc`

**Interfaces:**
- Produces: Unblocked `startScan()`, `startSoloSession()` with automatic BLE connection and zero platform REST sync.

- [ ] **Step 1: Remove web pairing guard in `startScan()`**
  - Delete `if (!UserManager.isPaired()) { return; }` so BLE scanning works for offline solo rowing.

- [ ] **Step 2: Enhance `startSoloSession()`**
  - Set `_raceMode = "solo"`.
  - Check if BLE rower is connected; if not, trigger `startScan()`.
  - Tare hardware model, create FIT session, set `_activityStatus = "in_progress"`.
  - In `saveAndExitSession()` and `discardSession()`, verify telemetry/sync is skipped for `"solo"`.

- [ ] **Step 3: Verify compilation**
  Run: `& "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d fr970 -f garmin\monkey.jungle -y developer_key.der -o garmin\bin\test.prg`
  Expected: BUILD SUCCESSFUL

---

### Task 4: Navigation & Input Delegation in `RowerDelegate`

**Files:**
- Modify: `garmin/source/RowerDelegate.mc`

**Interfaces:**
- Consumes: `RowerView.STATE_SUBMENU_MORE`, `_bleDelegate.startSoloSession()`, `_view.nextSubMenu()`, etc.

- [ ] **Step 1: Update `onSelect()`**
  - In `STATE_MENU`:
    - Index 0: `_view.resetRoomPinDigits()`, `_view.setAppState(RowerView.STATE_PIN_INPUT)`
    - Index 1: Course Publique. If `UserManager.isPaired()`, call `_bleDelegate.joinNextRaceWaiting()`. If not, call `_view.resetPairingDigits()`, `_view.setAppState(RowerView.STATE_PAIRING_INPUT)`.
    - Index 2: Seul. Call `_bleDelegate.startSoloSession()`.
    - Index 3: Autres choix. Call `_view.setAppState(RowerView.STATE_SUBMENU_MORE)`.
  - In `STATE_SUBMENU_MORE`:
    - Index 0: Kayak. Call `_view.resetPseudoDigits()`, `_view.setAppState(RowerView.STATE_PSEUDO_INPUT)`.
    - Index 1: Ecrans de données. Call `openDataScreenConfig()`.
    - Index 2: Historique. Call `_view.setAppState(RowerView.STATE_HISTORY)`.

- [ ] **Step 2: Update `onNextPage()`, `onPreviousPage()`, `onBack()`**
  - `onNextPage()`: in `STATE_SUBMENU_MORE`, call `_view.nextSubMenu()`.
  - `onPreviousPage()`: in `STATE_SUBMENU_MORE`, call `_view.prevSubMenu()`.
  - `onBack()`:
    - In `STATE_MENU`: `return false;` (exit watch app).
    - In `STATE_SUBMENU_MORE`: `_view.setAppState(RowerView.STATE_MENU); return true;`.
    - In `STATE_HISTORY`: `_view.setAppState(RowerView.STATE_SUBMENU_MORE); return true;`.
    - In `STATE_PSEUDO_INPUT`: `_view.setAppState(RowerView.STATE_SUBMENU_MORE); return true;`.

- [ ] **Step 3: Verify compilation**
  Run: `& "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d fr970 -f garmin\monkey.jungle -y developer_key.der -o garmin\bin\test.prg`
  Expected: BUILD SUCCESSFUL

---

### Task 5: Unit Tests Update & Full Validation

**Files:**
- Modify: `garmin/source/RowerPowerTest.mc`

- [ ] **Step 1: Update unit tests for new menu & sub-menu specifications**
  - Update `testGarminMenuOptionsDynamic` to assert 4 items for `getMainMenuItemCount()` and 3 items for `getSubMenuItemCount()`.
  - Test transitions between `STATE_MENU` and `STATE_SUBMENU_MORE`.
  - Test solo mode setup.

- [ ] **Step 2: Run unit test suite build and verify**
  Run: `& "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -t -d fr970 -f garmin\monkey.jungle -y developer_key.der -o garmin\bin\test-unit.prg`
  Expected: BUILD SUCCESSFUL
