# Spécification de Conception : Personnalisation de l'Apparence et des Couleurs du Kayak

- **Date :** 17 Novembre 2026
- **Auteur :** Antigravity & Équipe Rower
- **Statut :** Validé / Prêt pour Implémentation

---

## 1. Contexte & Objectifs

Dans l'application Rower (régate d'aviron / kayak connectée avec montres Garmin et rameurs indoor), plusieurs embarcations évoluent simultanément sur un plan d'eau virtuel 2D. Actuellement, les bateaux se voient attribuer une couleur générique basée sur leur numéro de couloir, tandis que le joueur connecté bénéficie d'une mise en valeur fixe (couleur cyan et halo cyan).

Cette spécification définit une fonctionnalité complète permettant à tout utilisateur ayant créé un compte de **personnaliser les couleurs et l'aspect visuel de son kayak** (coque, pelles, motif de course, halo lumineux). Cela garantit :
1. Une reconnaissance visuelle immédiate de son propre kayak au milieu du peloton.
2. Une identité sportive et personnalisée valorisante dès la création du compte.
3. Une visibilité multijoueur complète (les autres participants et spectateurs voient le kayak personnalisé du joueur).

---

## 2. Parcours Utilisateur (UX Flow)

### 2.1 Étape Post-Inscription (Onboarding)
1. L'utilisateur remplit le formulaire d'inscription classique (`nom`, `prenom`, `anneeNaissance`, `sexe`, `pays`, `login`, `email`, `password`).
2. À la validation réussie (`submitAccountRegister`), au lieu de simplement afficher le profil textuel, l'application ouvre automatiquement un écran dédié : **`kayak-customizer`** avec un message d'accueil chaleureux :
   > *« Félicitations pour votre inscription ! Donnez du style à votre kayak pour le reconnaître facilement en course. »*
3. Cet écran présente :
   - Un **Aperçu interactif en direct (Live HD)** du kayak flottant sur l'eau, avec rames animées et reflets.
   - Des sélecteurs visuels de couleurs pour la coque et les pelles (palettes vives prédéfinies + sélecteur hexadécimal libre).
   - Un sélecteur de motif d'aspect : *Uni*, *Bande Racing*, *Bi-colore*, *Dégradé*.
   - Un choix de couleur de surbrillance / halo néon pour détacher le kayak sur le fond d'eau sombre.
4. L'utilisateur clique sur **« Enregistrer mon style 🛶 »** :
   - La personnalisation est sauvegardée sur le serveur via l'API REST et mise en cache localement (`localStorage`).
   - L'utilisateur est ensuite basculé vers l'onglet profil avec confirmation.
   - Un bouton **« Passer cette étape (style par défaut) »** permet de conserver le style standard sans bloquer le flux.

### 2.2 Modification ultérieure dans « Mon Profil »
1. Dans l'onglet « Mon Profil », une nouvelle carte **« 🛶 Mon Kayak personnalisé »** affiche le rendu miniature actuel du kayak de l'utilisateur.
2. Un bouton **« 🎨 Personnaliser mon kayak »** permet de réouvrir l'interface de personnalisation à tout moment pour modifier ses couleurs ou motifs.

---

## 3. Architecture Technique & Modèle de Données

### 3.1 Structure de Données `KayakCustomization`

```typescript
export type KayakPattern = 'solid' | 'racing-stripe' | 'dual-tone' | 'gradient';

export interface KayakCustomization {
  hullColor: string;       // Couleur principale de la coque (hex, ex: '#00e5ff')
  bladeColor: string;      // Couleur des pelles/rames (hex, ex: '#00f0ff')
  pattern: KayakPattern;   // Motif décoratif de la coque
  glowColor: string;       // Couleur du halo et du sillage (hex, ex: '#00f0ff')
}
```

Valeurs par défaut :
- `hullColor`: `'#00e5ff'`
- `bladeColor`: `'#00f0ff'`
- `pattern`: `'racing-stripe'`
- `glowColor`: `'#00f0ff'`

### 3.2 Backend & Persistance

1. **Modèle Sequelize `User`** (`backend/src/models/user.model.ts` et `backend/src/models/User.ts`) :
   - Ajout de l'attribut `kayakCustomization`:
     ```typescript
     kayakCustomization?: KayakCustomization;
     ```
     Stocké sous forme de colonne JSON (PostgreSQL / SQLite).
2. **`UserStoreService`** (`backend/src/services/user-store.service.ts`) :
   - Mémorisation dans `inMemoryUsers`.
   - Prise en compte dans `updateUser` et dans la création lors de `registerUser`.
3. **Endpoints API REST** (`backend/src/controllers/user.controller.ts` & `backend/src/routes/user.routes.ts`) :
   - `PUT /api/user/kayak` :
     - Accepte `{ userId, kayakCustomization }`.
     - Valide le format hexadécimal des couleurs et le type de motif.
     - Sauvegarde en base et retourne le profil mis à jour.
   - `GET /api/user/profile/:userId` : renvoie `kayakCustomization` dans le `UserProfile`.

### 3.3 Synchronisation Multijoueur Temps Réel

1. **`LiveRacerMetric`** (`frontend/src/app/services/socket.service.ts` & `backend/src/websocket/socket.gateway.ts`) :
   - Extension de l'interface avec `kayak?: KayakCustomization`.
2. **`RaceManagerService.toLiveMetrics`** (`backend/src/services/race-manager.service.ts`) :
   - Associe la personnalisation du kayak de chaque participant humain (depuis son profil ou participant de course).
   - Les paquets de télémétrie envoyés via WebSocket à l'ensemble des clients connectés contiennent ainsi le look de chaque rameur.

---

## 4. Rendu Graphique dans le Canvas de Régate

Dans `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts` :
1. **Lecture des styles** :
   - `const custom = boat.kayak || (isUser ? this.activeUserKayak : null);`
   - Si présent, les couleurs et motifs personnalisés remplacent les couleurs génériques.
2. **Tracé de la coque (`hull`)** :
   - Remplissage de base avec `custom.hullColor`.
   - **`racing-stripe`** : Dessin de deux fines bandes longitudinales blanches/contrastées suivant le profil dynamique de la coque.
   - **`dual-tone`** : Masquage ou demi-plan coupant le bateau pour afficher une proue vive et une poupe contrastée.
   - **`gradient`** : Dégradé linéaire horizontal (`createLinearGradient(x - hullRx, y, x + hullRx, y)`) entre `hullColor` et `bladeColor` / teintes associées.
   - **`solid`** : Finition monochrome unie et épurée.
3. **Pelles de rames (`oar blades`)** :
   - Dessin des pelles bâbord et tribord avec `custom.bladeColor`.
4. **Halo & Sillage** :
   - Halo dynamique `ctx.shadowColor = custom.glowColor`.
   - Sillage arrière teinté subtilement avec `custom.glowColor`.

---

## 5. Gestion des Erreurs & Cas Limites

- **Données manquantes ou corrompues** : Si les codes hexadécimaux sont invalides ou absents, l'application applique silencieusement les valeurs par défaut sans planter le canvas.
- **Utilisateurs non inscrits / Bots / Invités** : Les bateaux sans compte conservent la palette de couleurs de ligne automatique (`boatColors[laneIdx % 8]`).
- **Mode hors-ligne / Déconnexion réseau** : La personnalisation est mémorisée dans `localStorage` (`rower_kayak_customization`) et appliquée localement même si l'appel API échoue.

---

## 6. Plan de Test & Vérification

1. **Tests Automatisés Backend** :
   - Test de mise à jour `PUT /api/user/kayak` avec validation des formats et persistance.
   - Test d'enregistrement `POST /api/user/register` incluant ou recevant une personnalisation de kayak.
   - Vérification de la transmission dans `toLiveMetrics`.
2. **Tests Frontend & Build** :
   - Compilation Angular sans avertissement ni erreur de types.
   - Test manuel du parcours : Inscription -> Écran de personnalisation -> Enregistrement -> Affichage sur le profil -> Affichage sur le canvas de course.
