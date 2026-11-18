# Solution Complète : Suivi Rameur FTMS (Backend Express + Frontend Angular + Application Garmin Connect IQ)

Cette solution monorepo permet de suivre en temps réel et d'archiver les séances d'entraînement et les régates sur rameur compatible Bluetooth FTMS.

L'architecture du dépôt est rigoureusement structurée autour de **3 applications interconnectées** :

```
rower2backend/
├── backend/                       # 1. API REST Node.js / Express / TypeScript / PostgreSQL
│   ├── src/                       # Contrôleurs, middleware, routes, services temps réel
│   ├── tests/                     # 24 suites de tests automatisés (sécurité, régate, télémétrie)
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                      # 2. Application Web Dashboard & Régate Angular 21
│   ├── src/                       # Composants (Cockpit, Régate Canvas, Salons, Administration)
│   ├── public/                    # Assets statiques et manifestes
│   ├── scripts/set-env.js         # Injection dynamique de l'URL API pour Render
│   └── package.json
│
├── garmin/                        # 3. Application Montre Connectée Garmin Connect IQ (Monkey C)
│   ├── source/                    # Code Monkey C (BLE FTMS, UI, Télémétrie REST, I18n)
│   ├── resources/                 # XML drawables, strings, settings, fit_contributions
│   ├── tools/                     # Outils de génération des assets promotionnels du store
│   ├── manifest.xml               # Permissions et montres Garmin supportées
│   ├── monkey.jungle              # Définitions de compilation Connect IQ
│   └── test_fenix7-settings.json  # Paramètres simulateur montre
│
├── docs/                          # Documentation technique, spécifications et captures d'écran
├── render.yaml                    # Blueprint d'orchestration Render (BDD Postgres, API, Frontend)
└── .gitignore                     # Protection globale contre les artefacts de build et clés
```

---

## 🏗️ Déploiement Blueprint sur Render (`render.yaml`)

Le fichier [`render.yaml`](./render.yaml) orchestre automatiquement la chaîne complète :

```yaml
databases:
  - name: rower-postgres-db
    databaseName: rower_db
    user: rower_user
    plan: free

services:
  # 1. API Backend Node.js
  - type: web
    name: rower-api-service
    env: node
    plan: free
    rootDir: backend
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: rower-postgres-db
          property: connectionString

  # 2. Application Front Web Angular
  - type: web
    name: rower-dashboard-frontend
    env: static
    plan: free
    rootDir: frontend
    buildCommand: npm install && npm run build
    staticPublishPath: dist/frontend/browser
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    envVars:
      - key: API_URL
        fromService:
          type: web
          name: rower-api-service
          property: host
```

### Transmission de l'URL API au frontend :
1. Dans `render.yaml`, la variable `API_URL` est fournie dynamiquement au frontend à partir de la propriété `host` du service backend `rower-api-service`.
2. Lors du build Render (`npm run build`), le script [`frontend/scripts/set-env.js`](./frontend/scripts/set-env.js) s'exécute automatiquement **avant** `ng build`.
3. Il lit la variable d'environnement `API_URL`, formate le protocole HTTPS si nécessaire, et génère le fichier `src/environments/environment.prod.ts`.
4. Angular compile ensuite l'application en intégrant directement l'URL d'API de Render dans les bundles de production.

---

## 💻 Démarrage en local (Développement)

### 1. Démarrer le Backend
```bash
cd backend
npm install
npm run build
npm start
```
*Le serveur écoute sur `http://localhost:3000`.*

### 2. Démarrer le Frontend Angular
```bash
cd frontend
npm install
npm start
```
*Accessible sur `http://localhost:4200`.*

### 3. Application Garmin
- Fichier binaire pour test direct (USB) : `garmin/bin/RowerApp_fenix7.prg`.
- Fichier de déploiement pour le store : `garmin/bin/RowerApp.iq`.
- Outil de génération des bannières du store : `garmin/tools/generate_store_assets/generate_all.ps1`.
- Configuration de l'URL : modifiable à tout moment dans les réglages de l'application via Garmin Connect Mobile.
