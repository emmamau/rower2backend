# 🚣 Simulateur de Charge Garmin FTMS (Jusqu'à 30 Montres)

Ce simulateur haute fidélité permet de tester la charge de la plateforme en simulant jusqu'à **30 montres Garmin réelles** connectées à des rameurs indoor (Concept2, WaterRower, SmartRow) transmettant leur télémétrie FTMS.

L'agent web intégré fournit un tableau de bord complet pour piloter la flotte, associer des comptes de test par PIN, engager les coureurs sur des courses privées/duels/publiques et monitorer la charge du serveur en temps réel.

---

## 🚀 Démarrage Rapide (Windows)

Double-cliquez simplement sur :
```cmd
simulator/start_simulator.bat
```

Ou manuellement via le terminal :
```bash
cd simulator
python -m pip install -r requirements.txt
python main.py
```
Puis ouvrez votre navigateur sur : **[http://localhost:8080](http://localhost:8080)**.

---

## 🌟 Fonctionnalités Clés

### 1. Agent Web Ergonomique (`http://localhost:8080`)
* **30 Montres Virtuelles individuelles :**
  * Modèles Garmin réalistes (*Forerunner 965*, *Fénix 7 Pro*, *Epix Pro*, *Enduro 3*, *Tactix 7*, etc.).
  * Rameurs simulés (*Concept2 RowErg PM5*, *FTMS Bluetooth*, *WaterRower*).
  * Cartes de contrôle individuelles avec jauges de distance, puissance (W), split (/500m), cadence (SPM) et fréquence cardiaque (BPM).
* **Observabilité & Métriques de Charge Serveur :**
  * **Débit réel :** requêtes par seconde (`req/s`).
  * **Latence réseau & backend :** RTT moyen, minimum, maximum et **p95** (95e percentile).
  * **Code HTTP :** Compteurs `200 OK`, `429 TooManyRequests` (limiteur de débit) et `500 Server Error`.
  * **Bassin 2D animé :** Visualisation de l'avancement des 30 bateaux sur 2000m en temps réel avec classement dynamique.

---

## 🛠️ Modes d'Utilisation

### A. Scénario 1-Clic : Initialisation et Course Complète
1. Cliquez sur le bouton jaune **`⚡ 1-Clic : Initialiser 30 comptes & pré-appairer`**.
   * Le script crée 30 comptes utilisateurs (`test_runner_01` à `30`).
   * Il génère les codes d'appairage Garmin et appaire les 30 montres virtuelles.
   * Les jetons (`deviceToken`) sont sauvegardés localement dans `simulator/virtual_watches.json`.
2. Créez un salon privé ou un duel sur le web (ex: PIN `A8K9Z`).
3. Saisissez ce code dans le champ **`PIN SALON`** de la barre d'outils et cliquez sur **`Engager sélection PIN`**.
4. Cliquez sur **`▶ Démarrer la Télémétrie`**.
   * Les 30 montres transmettent leur position au départ.
   * Dès que le salon passe en `RUNNING` (ou dès le premier coup de rame), la course s'élance !

### B. Scénario Appairage Manuel
1. Sur le frontend web de la plateforme, générez un code d'appairage à 6 caractères pour votre utilisateur.
2. Sur la carte de la montre souhaitée (ex: Montre #1), saisissez ce code dans le champ `PIN 6-CARACT` et cliquez sur **`Appairer`**.
3. La montre obtient son jeton officiel et est désormais liée à cet utilisateur.

### C. Scénario Course Publique
1. Sélectionnez les montres souhaitées (ou cliquez sur *Tout cocher*).
2. Cliquez sur **`Course Publique (Tous)`**.
3. Les montres interrogent le backend pour récupérer l'identifiant de la course horaire et s'enregistrent sur la grille de départ.

### D. Tests de Charge en Production (Bouclier Anti-Triche Actif)
1. Rendez-vous dans le **Dashboard Admin** (`/admin`), onglet **`🛡️ Anti-Triche & Charge`**.
2. Cliquez sur **`🚀 Ouvrir une session de test de charge (2 heures)`** : une clé secrète (ex: `LTK-7F9B1E4A`) est générée.
3. Copiez cette clé et collez-la dans le champ **`🔑 Clé Test Admin`** de l'agent web du simulateur (`http://localhost:8080`), puis cliquez sur **`Définir Clé`**.
4. Toutes les requêtes du simulateur seront acceptées par le backend. Dès l'expiration du délai (ou par clic sur *Réarmer le bouclier*), tout script non autorisé sera immédiatement bloqué (HTTP 403).

---

## ⚡ Modélisation Biomécanique Réaliste (Indiscernable d'un Vrai Joueur)

Le moteur applique fidèlement la physique officielle Concept2 intégrée au backend (`TelemetryValidator`) :
1. **Équation Concept2 :**
   $$\text{Vitesse } v = \left(\frac{P}{2.80}\right)^{1/3} \quad\text{et}\quad \text{Allure } /500m = \frac{500}{v}$$
2. **Fluctuations Humaines :**
   * Légère oscillation stochastique de puissance ($\pm 2.5\%$).
   * Cadence SPM physiquement liée à la puissance ($SPM = 18 + 0.45 \times \sqrt{P} \pm \text{jitter}$).
   * Dérive cardiaque progressive simulant la fatigue physiologique (montée de 130 à 175 BPM au fil des 2000m).
3. **Respect du Limiteur de Cadence (`garminBoostRateLimiter`) :**
   * Chaque montre émet sur `/api/garmin/boost` à **1 Hz** (1 paquet par seconde).
   * Comme chaque montre dispose de son propre `deviceToken` et `deviceId`, le backend autorise les 30 flux concurrents sans déclencher de blocage intempestif.

---

## 📁 Structure des Fichiers

| Fichier | Rôle |
|---|---|
| `main.py` | Serveur FastAPI exposant l'API de contrôle et le dashboard web |
| `engine.py` | Moteur asynchrone haute performance (`aiohttp`) simulant les 30 montres |
| `store.py` | Gestion de l'état des montres, calculs physiques et persistance JSON |
| `test_users_seeder.py` | Automatisation de la création et de l'appairage des comptes de test |
| `templates/index.html` | Interface Web responsive temps réel (thème Dark Pro Carbon) |
| `virtual_watches.json` | Fichier local contenant les tokens et réglages des montres |
| `start_simulator.bat` | Lanceur Windows en un double-clic |
