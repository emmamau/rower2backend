# Solution Complète : Rameur FTMS vers Garmin Connect IQ & Backend PostgreSQL Render

Cette solution comprend :
1. **L'application Garmin Connect IQ** en Monkey C pour montre Garmin.
2. **Le backend Node.js / TypeScript** avec Sequelize ORM et PostgreSQL.
3. **Le fichier Blueprint `render.yaml`** pour le déploiement automatique sur Render (base PostgreSQL managée + API web).
4. **Le paramétrage dynamique de l'URL du backend** via les réglages de l'application Connect IQ (Garmin Connect Mobile / Express).

---

## 📁 Architecture du Projet

```text
rower2backend/
├── backend/
│   ├── src/
│   │   ├── database.ts          # Connexion Sequelize & configuration SSL PostgreSQL
│   │   ├── index.ts             # Serveur Express, endpoints REST et initialisation DB
│   │   └── models/
│   │       └── RowerData.ts     # Schéma de table Sequelize pour toutes les métriques FTMS
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── garmin/
│   ├── manifest.xml             # Permissions BLE, Communications, Senseurs et cibles montres
│   ├── monkey.jungle            # Configuration de build Connect IQ
│   ├── resources/
│   │   ├── strings/strings.xml  # Libellés (Support multilingue)
│   │   ├── settings/settings.xml# Paramètre utilisateur pour l'URL du Backend Render
│   │   └── drawables/           # Icônes de l'application
│   └── source/
│       ├── RowerApp.mc          # Point d'entrée Connect IQ
│       ├── RowerView.mc         # Interface utilisateur Garmin (Cadence, Puissance, Allure, Distance)
│       ├── RowerDelegate.mc     # Gestion des interactions physiques/boutons
│       ├── BleDelegate.mc       # Scan, appairage et décodeur de trame FTMS 0x2AD1
│       ├── RowerDataModel.mc    # Modèle de données normalisé
│       └── RestSyncManager.mc   # Client HTTP REST avec lecture de la configuration d'URL
├── render.yaml                  # Déploiement automatique Infrastructure-as-Code Render
└── README.md
```

---

## 1. Déploiement sur Render (`render.yaml`)

Le fichier [`render.yaml`](file:///c:/Users/Emma/repos/connectiq/rower2backend/render.yaml) provisionne automatiquement :
1. **Une base de données PostgreSQL managée** (`rower-postgres-db`).
2. **Le service web Node.js** (`rower-api-service`).
3. **L'injection automatique des identifiants et de l'URL de connexion** : Render transmet dynamiquement la variable d'environnement `DATABASE_URL` créée par la base de données au backend avant son lancement.
4. Au démarrage du backend, **Sequelize synchronise automatiquement le schéma** (`sequelize.sync({ alter: true })`) et crée la table `ftms_rower_data` avec tous ses index.

### Déployer sur Render :
1. Poussez ce dépôt sur GitHub ou GitLab.
2. Connectez-vous sur votre tableau de bord [Render.com](https://render.com).
3. Cliquez sur **Blueprints** -> **New Blueprint Instance**.
4. Liez votre dépôt : Render va détecter le fichier `render.yaml` et lancer la création de la base de données et du service web.
5. Une fois déployé, notez l'URL publique de votre service web (ex : `https://rower-api-service.onrender.com`).

---

## 2. Backend Node.js / TypeScript & PostgreSQL

### API Endpoints exposés :
- `GET /health` : Vérification du statut de l'API et de la connexion PostgreSQL.
- `POST /api/rower/data` : Enregistrement d'un relevé instantané FTMS envoyé par la montre Garmin.
- `POST /api/rower/batch` : Enregistrement par lot de métriques FTMS.
- `GET /api/rower/latest` : Récupération du dernier état du rameur (avec filtres optionnels `sessionId`, `deviceId`).
- `GET /api/rower/history` : Historique avec pagination pour dashboards et analyses.

### Métriques enregistrées dans `ftms_rower_data` :
- `strokeRate` (Cadence de coups / min, précision 0.5)
- `strokeCount` (Nombre total de coups)
- `instantPower` & `avgPower` (Puissance en Watts)
- `instantPace` & `avgPace` (Allure en secondes pour 500m)
- `totalDistance` (Distance totale en mètres)
- `elapsedTime` & `remainingTime` (Temps écoulé / restant en secondes)
- `resistanceLevel` (Niveau de résistance du rameur)
- `totalEnergy`, `energyPerHour`, `energyPerMinute` (Calories dépensées)
- `heartRate` (Fréquence cardiaque en bpm si transmise par le rameur)
- `metabolicEq` (METs)
- `rawFlags` (Flags binaires 16-bit d'origine FTMS)

---

## 3. Application Garmin Connect IQ

### Fonctionnement :
1. **Détection BLE** : Scanne les périphériques diffusant le service standard Bluetooth SIG **Fitness Machine Service (FTMS)** `0x1826`.
2. **Connexion & Abonnements** : Se connecte et active les notifications de la caractéristique **Rower Data** `0x2AD1`.
3. **Décodage temps réel** : Décode le masque binaire Little-Endian FTMS et extrait l'ensemble des données dynamiques.
4. **Affichage sur la montre** :
   - Grand affichage de la cadence (SPM) et du nombre de coups.
   - Puissance instantanée (Watts) et Allure (/500m).
   - Distance (mètres) et Temps écoulé (MM:SS).
   - Fréquence cardiaque (BPM) et Calories (kcal).
5. **Appel REST HTTP** : Utilise `Communications.makeWebRequest` pour transmettre les données en JSON au backend Node.js.
6. **Mise à jour dynamique de l'URL** :
   - Définie dans [`garmin/resources/settings/settings.xml`](file:///c:/Users/Emma/repos/connectiq/rower2backend/garmin/resources/settings/settings.xml).
   - Peut être modifiée à tout moment par l'utilisateur depuis son smartphone dans l'application **Garmin Connect Mobile** ou sur ordinateur via **Garmin Express** sans recompiler l'application.

---

## 4. Compilation et Test

### Backend en local :
```bash
cd backend
npm install
npm run build
npm start
```

### Application Garmin :
Ouvrez le dossier `garmin` dans VS Code avec l'extension **Monkey C**, sélectionnez votre modèle de montre (ex: Fenix 7, Forerunner 965, etc.) et lancez le simulateur Connect IQ (`Ctrl+F5`).

