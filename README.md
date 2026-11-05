# Solution Complète : Suivi Rameur FTMS (Garmin Connect IQ + Backend Node.js/PostgreSQL + Dashboard Web Angular)

Cette solution permet de suivre en temps réel et d'archiver les séances d'entraînement sur rameur compatible Bluetooth FTMS.

Elle se compose de 3 couches interconnectées :
1. **L'application montre Garmin Connect IQ** (`garmin/`) : collecte les trames BLE FTMS (0x2AD1), affiche la télémétrie sur la montre et l'envoie par requête HTTP REST vers le backend.
2. **Le backend Node.js / TypeScript** (`backend/`) : API REST Express avec ORM Sequelize stockant les métriques dans PostgreSQL.
3. **Le Dashboard Web Angular** (`frontend/`) : application web moderne affichant les données en direct (polling réactif, cadence SPM, puissance en Watts, allure /500m, cardio, historique).
4. **Déploiement Blueprint Render** (`render.yaml`) : déploiement automatisé « zéro config » de la base PostgreSQL managée, du service web API et du frontend statique.

---

## 🏗️ Déploiement Blueprint sur Render (`render.yaml`)

Le fichier [`render.yaml`](file:///c:/Users/Emma/repos/connectiq/rowerRace/render.yaml) orchestre automatiquement la chaîne complète :

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

### Comment l'URL de l'API est transmise au frontend avant compilation :
1. Dans `render.yaml`, la variable `API_URL` est fournie dynamiquement au frontend à partir de la propriété `host` du service backend `rower-api-service`.
2. Lors du build Render (`npm run build`), le script [`frontend/scripts/set-env.js`](file:///c:/Users/Emma/repos/connectiq/rowerRace/frontend/scripts/set-env.js) s'exécute automatiquement **avant** `ng build`.
3. Il lit la variable d'environnement `API_URL`, formate le protocole HTTPS si nécessaire, et génère le fichier `src/environments/environment.prod.ts`.
4. Angular compile ensuite l'application en intégrant directement l'URL d'API de Render dans les bundles de production.

---

## 🛠️ Résolution du bogue TypeScript de déploiement Render
L'erreur :
```text
src/index.ts(2,18): error TS7016: Could not find a declaration file for module 'cors'.
```
survenait car Render installe les dépendances avec `NODE_ENV=production`, ce qui exclut par défaut les `devDependencies`. Les paquets typés `@types/cors`, `@types/express`, `@types/node` et `typescript` ont été déplacés dans les `dependencies` de `backend/package.json`. Le build `npm run build` (`tsc`) passe désormais sans aucune erreur.

---

## 💻 Démarrage en local (Développement)

### 1. Démarrer le Backend
```bash
cd backend
npm install
npm run build
npm start
```
*Le serveur tourne sur `http://localhost:3000`.*

### 2. Démarrer le Frontend Angular
```bash
cd frontend
npm install
npm start
```
*Accessible sur `http://localhost:4200`.*

### 3. Application Garmin
- Fichier binaire pour test direct (USB) : [`garmin/bin/RowerApp_fenix7.prg`](file:///c:/Users/Emma/repos/connectiq/rowerRace/garmin/bin/RowerApp_fenix7.prg).
- Fichier de déploiement pour le store : [`garmin/bin/RowerApp.iq`](file:///c:/Users/Emma/repos/connectiq/rowerRace/garmin/bin/RowerApp.iq).
- Configuration de l'URL : modifiable à tout moment dans les réglages de l'application via Garmin Connect Mobile.
