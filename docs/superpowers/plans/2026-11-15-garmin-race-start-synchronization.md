# Synchronisation du Départ de Course Garmin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empêcher le passage prématuré de la montre Garmin en mode course (`STATE_RACING` / affichage de la grille de données) tant que le backend est toujours en phase d'attente (`status == "waiting"`, `internalStatus == "LOBBY"` ou en attente d'autres coureurs/hôte).

**Architecture:** 
1. Dans `BleDelegate.mc`, supprimer les démarrages autonomes non synchronisés basés uniquement sur `countdown <= 0` dans `onTick()`, `onModelUpdated()` et `onLobbyDataReceived()`.
2. Verrouiller la montre en phase d'attente (`STATE_WAITING_START`) dès l'inscription ou la connexion à une course, et exiger soit une transition explicite via le décompte synchrone final 5s (`STATE_COUNTDOWN_5S` -> `cd <= 0`), soit la confirmation backend `isRunning` (`status: "in_progress"` / `internalStatus: "RUNNING"`).
3. Dans `RowerView.mc` et `BleDelegate.mc`, réinitialiser proprement le compte à rebours de lobby et l'identifiant d'activité lors du retour au menu ou de la sortie de course pour éviter qu'un compte à rebours expiré à 0 ou un ID résiduel ne déclenche immédiatement un faux départ.
4. Couvrir l'ensemble par des tests de régression unitaires dans `RowerPowerTest.mc`.

**Tech Stack:** Garmin Connect IQ (Monkey C 3.2.0+, SDK 9.2.0), Node.js / TypeScript pour le backend Rower2.

**Spec:** Correction du bug de transition prématurée Garmin vers la page de course en cours.

## Global Constraints
- Ne pas modifier le protocole BLE SmartRow/FTMS ni altérer la capture des métriques FIT.
- Préserver le comportement du mode Solo local (démarrage au premier coup de rame).
- Préserver le comportement du décompte synchrone final 5s (`STATE_COUNTDOWN_5S`).
- Tous les tests de régression existants et nouveaux doivent compiler et réussir.

---

### Task 1: Nettoyage et Réinitialisation du Lobby dans `RowerView.mc`

**Files:**
- Modify: `garmin/source/RowerView.mc:220-235`
- Modify: `garmin/source/RowerView.mc:470-485`
- Test: `garmin/source/RowerPowerTest.mc`

**Interfaces:**
- Produces: `RowerView.resetLobbyState() as Void`
- Consumes: `_nextRaceCountdown`, `_isPrivateSalon`, `_privateGameMode`

- [ ] **Step 1: Écrire le test unitaire pour la réinitialisation du lobby**

Ajouter dans `garmin/source/RowerPowerTest.mc` :
```monkeyc
//! Regression test: Resetting lobby state restores countdown and cleans up private flags
(:test)
function testLobbyResetRestoresDefaultCountdown(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);

    // Simulate expired countdown
    view.setLobbyInfo(0, 1, 2000);
    Test.assertEqual(0, view.getCountdown());

    // Reset lobby
    view.resetLobbyState();
    Test.assertEqual(600, view.getCountdown());
    Test.assertEqual(false, view.isPrivateSalon());

    return true;
}
```

- [ ] **Step 2: Vérifier l'échec de la compilation (méthode `resetLobbyState` manquante)**

Exécuter :
```powershell
cd garmin; & "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d enduro3 -f monkey.jungle -y C:\Users\Emma\repos\connectiq\rower2backend\developer_key.der -o bin/rower_test.prg --unit-test
```
Résultat attendu : Erreur de compilation `Could not find symbol 'resetLobbyState'`.

- [ ] **Step 3: Implémenter `resetLobbyState` dans `RowerView.mc`**

Dans `garmin/source/RowerView.mc`, ajouter :
```monkeyc
    public function resetLobbyState() as Void {
        _nextRaceCountdown = 600;
        _isPrivateSalon = false;
        _privateGameMode = "";
        _connectedPlayers = 1;
        _assignedLane = 1;
        _hasBotsEnabled = false;
        _falseStartLocked = false;
        WatchUi.requestUpdate();
    }
```
Et dans `setAppState(state as Number)`, si `state == STATE_MENU`, appeler automatiquement `resetLobbyState()`.

- [ ] **Step 4: Vérifier la réussite de la compilation et du test**

Exécuter la compilation :
```powershell
cd garmin; & "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d enduro3 -f monkey.jungle -y C:\Users\Emma\repos\connectiq\rower2backend\developer_key.der -o bin/rower_test.prg --unit-test
```
Résultat attendu : `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add garmin/source/RowerView.mc garmin/source/RowerPowerTest.mc
git commit -m "fix(garmin): add resetLobbyState to prevent stale zero countdown on menu transition"
```

---

### Task 2: Suppression des Déclencheurs de Démarrage Autonomes Intempestifs dans `BleDelegate.mc`

**Files:**
- Modify: `garmin/source/BleDelegate.mc:974-1027`
- Modify: `garmin/source/BleDelegate.mc:1240-1254`
- Modify: `garmin/source/BleDelegate.mc:1515-1532`
- Test: `garmin/source/RowerPowerTest.mc`

**Interfaces:**
- Modifie: Comportement des méthodes `onTick()`, `onModelUpdated()`, `onLobbyDataReceived()`, `joinNextRaceWaiting()`
- Règles:
  1. `onModelUpdated()` (paquets BLE du rameur) ne doit JAMAIS déclencher `handleRaceStartTrigger()` tant que `_activityStatus` est `"waiting"`.
  2. `onTick()` ne doit JAMAIS déclencher `handleRaceStartTrigger()` depuis `STATE_WAITING_START` ou `STATE_LOBBY` au seul motif que `cd <= 0`.
  3. `onLobbyDataReceived()` ne doit déclencher `handleRaceStartTrigger()` que si le backend confirme formellement `isRunning == true`.
  4. `joinNextRaceWaiting()` doit initialiser `_isWaitingForReadyOrHost = true` pour verrouiller l'attente du signal backend.

- [ ] **Step 1: Écrire les tests unitaires prouvant que `countdown == 0` et `status == "waiting"` ne démarrent pas la course**

Ajouter dans `garmin/source/RowerPowerTest.mc` :
```monkeyc
//! Regression test: Zero countdown with waiting backend status MUST NOT trigger race start
(:test)
function testPublicRaceWaitingWithZeroCountdownDoesNotStart(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);
    var del = new BleDelegate(model);
    del.setView(view);

    // User joins next race -> state should be STATE_WAITING_START
    del.joinNextRaceWaiting();
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());

    // Backend payload returns status "waiting" with secondsRemaining 0
    del.onLobbyDataReceived({
        "status" => "waiting",
        "secondsRemaining" => 0,
        "totalParticipants" => 1,
        "targetDistance" => 2000,
        "race" => {
            "id" => "PUB_RACE_1",
            "internalStatus" => "LOBBY",
            "status" => "waiting",
            "targetDistance" => 2000
        }
    });

    // Watch MUST remain in STATE_WAITING_START
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());

    // Simulate BLE packet arriving from rower with strokes while waiting
    model.strokeRate = 28.0f;
    model.instantPower = 200;
    del.onTick();

    // Must STILL be in STATE_WAITING_START, NOT in STATE_RACING
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());

    return true;
}

//! Regression test: Post-race pause payload MUST NOT start the race
(:test)
function testPostRacePauseDoesNotStartRace(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);
    var del = new BleDelegate(model);
    del.setView(view);

    del.joinNextRaceWaiting();
    del.onLobbyDataReceived({
        "status" => "post_race_pause",
        "isPostRacePause" => true,
        "secondsRemaining" => 90,
        "pauseRemainingSeconds" => 90,
        "race" => {
            "id" => "PUB_PREV_RACE",
            "internalStatus" => "COMPLETED",
            "status" => "post_race_pause"
        }
    });

    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());
    del.onTick();
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());

    return true;
}
```

- [ ] **Step 2: Corriger `joinNextRaceWaiting()` dans `BleDelegate.mc`**

Lignes 1533-1546 :
Remplacer :
```monkeyc
        _raceMode = "race";
        _activityStatus = "waiting";
        _isWaitingForReadyOrHost = false;
        _activityId = "";
        _isBotDuel = false;
        if (_view != null) {
            var view = _view as RowerView;
            view.setPrivateSalonMode(false, "");
            view.setIsLateJoiner(false);
            view.setAppState(RowerView.STATE_WAITING_START);
        }
```
Par :
```monkeyc
        _raceMode = "race";
        _activityStatus = "waiting";
        _isWaitingForReadyOrHost = true; // Verrouille le lobby pour empêcher tout auto-démarrage intempestif
        _activityId = "";
        _isBotDuel = false;
        if (_view != null) {
            var view = _view as RowerView;
            view.resetLobbyState();
            view.setPrivateSalonMode(false, "");
            view.setIsLateJoiner(false);
            view.setAppState(RowerView.STATE_WAITING_START);
        }
```

- [ ] **Step 3: Corriger `onTick()` dans `BleDelegate.mc`**

Lignes 1011-1026 :
Supprimer la branche :
```monkeyc
} else if ((state == RowerView.STATE_WAITING_START || state == RowerView.STATE_LOBBY) && cd <= 0) {
    handleRaceStartTrigger(view, isRowing);
}
```
Ne conserver que :
```monkeyc
            if (!_isWaitingForReadyOrHost) {
                if (state == RowerView.STATE_WAITING_START && cd <= 5 && cd > 0) {
                    view.set5sCountdown(cd);
                    view.setAppState(RowerView.STATE_COUNTDOWN_5S);
                    vibrateSingleTick(false);
                } else if (state == RowerView.STATE_COUNTDOWN_5S) {
                    if (cd > 0) {
                        view.set5sCountdown(cd);
                        vibrateSingleTick(false);
                    } else {
                        handleRaceStartTrigger(view, isRowing);
                    }
                }
            }
```

- [ ] **Step 4: Corriger `onModelUpdated()` dans `BleDelegate.mc`**

Lignes 1247-1254 :
Remplacer :
```monkeyc
        // 1. If race is already running or countdown reached 0 (and not waiting in LOBBY for READY/Host), transition immediately to racing
        if ((_activityStatus.equals("in_progress") || (!_isWaitingForReadyOrHost && view.getCountdown() <= 0)) &&
            (state == RowerView.STATE_WAITING_START || state == RowerView.STATE_COUNTDOWN_5S || state == RowerView.STATE_LOBBY)) {
            var isRowing = (_model.strokeRate > 0 || _model.instantPower > 0);
            handleRaceStartTrigger(view, isRowing);
            state = view.getAppState();
        }
```
Par :
```monkeyc
        // 1. If race is already running (e.g. late join or already started), update state
        if (_activityStatus.equals("in_progress") &&
            (state == RowerView.STATE_WAITING_START || state == RowerView.STATE_COUNTDOWN_5S || state == RowerView.STATE_LOBBY)) {
            var isRowing = (_model.strokeRate > 0 || _model.instantPower > 0);
            handleRaceStartTrigger(view, isRowing);
            state = view.getAppState();
        }
```

- [ ] **Step 5: Corriger `onLobbyDataReceived()` dans `BleDelegate.mc`**

Lignes 1460-1530 :
1. Détecter `internalStatus` dans `data` ET dans `data.get("race")`.
2. Détecter `status == "waiting"` ou `status == "post_race_pause"` : marquer `isWaitingLobby = true` pour les courses publiques aussi bien que privées.
3. Ne déclencher le départ dans `onLobbyDataReceived` QUE si `isRunning == true` :
```monkeyc
            var curState = view.getAppState();
            if (isRunning &&
                (curState == RowerView.STATE_LOBBY || curState == RowerView.STATE_WAITING_START || curState == RowerView.STATE_COUNTDOWN_5S || curState == RowerView.STATE_PENDING_APPROVAL)) {
                var isRowing = (_model.strokeRate > 0 || _model.instantPower > 0);
                handleRaceStartTrigger(view, isRowing);
            } else if (!isRunning && !_isWaitingForReadyOrHost && countdown > 0 && countdown <= 5 && curState == RowerView.STATE_WAITING_START) {
                view.set5sCountdown(countdown);
                view.setAppState(RowerView.STATE_COUNTDOWN_5S);
            }
```

- [ ] **Step 6: Vérifier la compilation et exécuter les tests**

Compiler avec monkeyc :
```powershell
cd garmin; & "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d enduro3 -f monkey.jungle -y C:\Users\Emma\repos\connectiq\rower2backend\developer_key.der -o bin/rower_test.prg --unit-test
```
Résultat attendu : `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add garmin/source/BleDelegate.mc garmin/source/RowerPowerTest.mc
git commit -m "fix(garmin): prevent premature race start when backend is in waiting or pause phase"
```

---

### Task 3: Sécurisation du Déclenchement au Coup de Rame (Solo vs Course) et Nettoyage de `_activityId`

**Files:**
- Modify: `garmin/source/BleDelegate.mc:988-1005`
- Modify: `garmin/source/BleDelegate.mc:1700-1745`
- Test: `garmin/source/RowerPowerTest.mc`

**Interfaces:**
- Règle 1 : Seules les sessions Solo ou Bot Duel hors décompte peuvent être lancées par un coup de rame. Une course en ligne (`_raceMode == "race"`) ne doit JAMAIS démarrer au premier coup de rame si `_activityId` contenait un ancien libellé solo.
- Nettoyage : `saveAndExitSession()` et `discardSession()` doivent systématiquement réinitialiser `_activityId = ""`.

- [ ] **Step 1: Écrire le test unitaire pour la réinitialisation de `_activityId` et l'absence de départ au coup de rame en course**

Ajouter dans `garmin/source/RowerPowerTest.mc` :
```monkeyc
//! Regression test: Stroke during race waiting mode must wake BLE, not start the race
(:test)
function testStrokeDuringRaceWaitingWakesBleWithoutStartingRace(logger as Logger) as Boolean {
    var model = new RowerDataModel();
    var view = new RowerView(model);
    var del = new BleDelegate(model);
    del.setView(view);

    del.joinNextRaceWaiting();
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());

    // Row stroke while waiting
    model.strokeRate = 24.0f;
    model.instantPower = 180;
    del.onTick();

    // Must remain in STATE_WAITING_START
    Test.assertEqual(RowerView.STATE_WAITING_START, view.getAppState());
    Test.assertEqual(false, del.isSessionActive());

    return true;
}
```

- [ ] **Step 2: Corriger la règle du premier coup de rame dans `BleDelegate.mc`**

Lignes 990-994 de `BleDelegate.mc` :
Remplacer :
```monkeyc
            // Règle 1 : En salon Solo (ou Duel Bot hors décompte), le premier coup de rame déclenche immédiatement le départ
            if ((view.getPrivateGameMode().equals("solo") || (_isBotDuel && _isWaitingForReadyOrHost) || (_activityId != null && _activityId.find("solo") != null)) && isRowing && _activityStatus.equals("waiting")) {
                handleRaceStartTrigger(view, false);
                return;
            }
```
Par :
```monkeyc
            // Règle 1 : En salon Solo (ou Duel Bot hors décompte), le premier coup de rame déclenche immédiatement le départ
            // STRICTEMENT réservé au mode solo ou bot duel (JAMAIS en course multijoueur en ligne)
            if (_raceMode.equals("solo") || view.getPrivateGameMode().equals("solo") || (_isBotDuel && _isWaitingForReadyOrHost)) {
                if (isRowing && _activityStatus.equals("waiting")) {
                    handleRaceStartTrigger(view, false);
                    return;
                }
            }
```

- [ ] **Step 3: Réinitialiser `_activityId = ""` dans `saveAndExitSession()` et `discardSession()`**

Dans `BleDelegate.mc` :
- Dans `saveAndExitSession()` (ligne 1709) : ajouter `_activityId = "";`.
- Dans `discardSession()` (ligne 1734) : ajouter `_activityId = "";`.

- [ ] **Step 4: Vérifier la compilation et exécuter les tests**

Compiler avec monkeyc :
```powershell
cd garmin; & "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d enduro3 -f monkey.jungle -y C:\Users\Emma\repos\connectiq\rower2backend\developer_key.der -o bin/rower_test.prg --unit-test
```
Résultat attendu : `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add garmin/source/BleDelegate.mc garmin/source/RowerPowerTest.mc
git commit -m "fix(garmin): restrict stroke auto-start to solo mode and clear activityId on exit"
```

---

### Task 4: Validation Globale et Non-Régression

**Files:**
- Test: `garmin/source/RowerPowerTest.mc`
- Build: `garmin/bin/rower_test.prg`

- [ ] **Step 1: Compiler la suite complète de tests de l'application Garmin**

```powershell
cd garmin; & "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d enduro3 -f monkey.jungle -y C:\Users\Emma\repos\connectiq\rower2backend\developer_key.der -o bin/rower_test.prg --unit-test
```
Résultat attendu : `BUILD SUCCESSFUL`.

- [ ] **Step 2: Exécuter la suite de tests sur le simulateur Connect IQ**

```powershell
Start-Process "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\simulator.exe"
Start-Sleep -Seconds 3
cd garmin; & "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeydo.bat" bin/rower_test.prg enduro3 /t
```
Vérifier que les nouveaux tests (`testLobbyResetRestoresDefaultCountdown`, `testPublicRaceWaitingWithZeroCountdownDoesNotStart`, `testPostRacePauseDoesNotStartRace`, `testStrokeDuringRaceWaitingWakesBleWithoutStartingRace`) réussissent sans aucune régression.

- [ ] **Step 3: Compilation finale de production (sans flag --unit-test)**

```powershell
cd garmin; & "C:\Users\Emma\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin\monkeyc.bat" -d enduro3 -f monkey.jungle -y C:\Users\Emma\repos\connectiq\rower2backend\developer_key.der -o bin/rower.prg
```
Résultat attendu : `BUILD SUCCESSFUL`.
