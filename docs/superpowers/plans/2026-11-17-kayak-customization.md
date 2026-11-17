# Kayak Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to customize their kayak's colors (hull, blades, glow) and pattern (solid, racing-stripe, dual-tone, gradient) immediately after account registration and anytime from their profile, with real-time 2D canvas rendering and multiplayer synchronization.

**Architecture:** Extend the user domain model in backend & frontend with `KayakCustomization`, provide a `PUT /api/user/kayak` REST endpoint, include custom kayak data in live race packets (`LiveRacerMetric`), build a responsive interactive customizer with real-time live preview into the frontend account modal/onboarding flow, and update the 2D canvas renderer (`regatta-canvas.component.ts`) to render personalized hulls, stripes, dual-tone finishes, gradients, blades, and neon glow.

**Tech Stack:** TypeScript, Angular 17+ (standalone components), Node.js, Express, Sequelize (PostgreSQL/SQLite), HTML5 Canvas 2D API, WebSockets.

**Spec:** [docs/superpowers/specs/2026-11-17-kayak-customization-design.md](file:///c:/Users/Emma/repos/connectiq/rower2backend/docs/superpowers/specs/2026-11-17-kayak-customization-design.md)

## Global Constraints

- Customization interface type:
  ```typescript
  export type KayakPattern = 'solid' | 'racing-stripe' | 'dual-tone' | 'gradient';
  export interface KayakCustomization {
    hullColor: string;
    bladeColor: string;
    pattern: KayakPattern;
    glowColor: string;
  }
  ```
- Defaults: `hullColor: '#00e5ff'`, `bladeColor: '#00f0ff'`, `pattern: 'racing-stripe'`, `glowColor: '#00f0ff'`.
- Colors must be validated as hex color codes (`^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$`).
- Backward compatible: Bots, guests, and uncustomized users fall back gracefully to default lane colors.
- Maintain existing test suites green.

---

### Task 1: Shared Models & Types (Backend & Frontend)

**Files:**
- Modify: `frontend/src/app/models/user.model.ts`
- Modify: `frontend/src/app/services/socket.service.ts`
- Modify: `backend/src/models/user.model.ts`
- Modify: `backend/src/models/User.ts`
- Modify: `backend/src/services/user-store.service.ts`
- Modify: `backend/src/websocket/socket.gateway.ts`

**Interfaces:**
- Produces: `KayakPattern`, `KayakCustomization`, and optional `kayakCustomization?: KayakCustomization` on `UserProfile`, `UserAttributes`, `StoredUser`, and `LiveRacerMetric`.

- [ ] **Step 1: Update frontend user models and socket metrics**

In `frontend/src/app/models/user.model.ts`, add:
```typescript
export type KayakPattern = 'solid' | 'racing-stripe' | 'dual-tone' | 'gradient';

export interface KayakCustomization {
  hullColor: string;
  bladeColor: string;
  pattern: KayakPattern;
  glowColor: string;
}
```
Add `kayakCustomization?: KayakCustomization;` to `UserProfile`.

In `frontend/src/app/services/socket.service.ts`, add `kayak?: KayakCustomization;` to `LiveRacerMetric`.

- [ ] **Step 2: Update backend models, user store, and socket gateway**

In `backend/src/models/user.model.ts`:
Define `KayakCustomization` and add `kayakCustomization?: KayakCustomization;` to `UserAttributes`.
In the sequelize definition:
```typescript
kayakCustomization: {
  type: DataTypes.JSON,
  allowNull: true,
}
```
In `backend/src/models/User.ts`:
Add `kayakCustomization?: KayakCustomization;` to `UserAttributes` and model definition.

In `backend/src/services/user-store.service.ts`:
Add `kayakCustomization?: KayakCustomization;` to `StoredUser`.

In `backend/src/websocket/socket.gateway.ts`:
Add `kayak?: KayakCustomization;` to `LiveRacerMetric`.

- [ ] **Step 3: Verify TypeScript builds in backend**

Run: `npx tsc --noEmit` in `backend` directory.
Expected: PASS with 0 type errors.

- [ ] **Step 4: Commit shared types**

```bash
git add frontend/src/app/models/user.model.ts frontend/src/app/services/socket.service.ts backend/src/models/ backend/src/services/user-store.service.ts backend/src/websocket/socket.gateway.ts
git commit -m "feat(models): add KayakCustomization interface across frontend and backend"
```

---

### Task 2: Backend API Endpoints & Race Telemetry Synchronization

**Files:**
- Create: `backend/tests/kayak-customization.test.js`
- Modify: `backend/src/controllers/user.controller.ts`
- Modify: `backend/src/routes/user.routes.ts`
- Modify: `backend/src/services/race-manager.service.ts`

**Interfaces:**
- Produces: `PUT /api/user/kayak` (body: `{ userId: string, kayakCustomization: KayakCustomization }`, returns `{ success: boolean, user: UserProfile }`).
- Consumes: `userStore.getUserById(userId)`, `userStore.updateUser(userId, { kayakCustomization })`.
- Produces in `toLiveMetrics`: populates `metric.kayak = participant.kayak || user.kayakCustomization`.

- [ ] **Step 1: Write backend unit/integration tests**

Create `backend/tests/kayak-customization.test.js`:
```javascript
const assert = require("assert");
const http = require("http");

describe("Kayak Customization API & Telemetry", () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    // import backend dist/src and start ephemeral server
    const appModule = require("../dist/index");
    app = appModule.default || appModule.app || appModule;
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after((done) => {
    if (server) server.close(done);
    else done();
  });

  it("should register a user with default or custom kayak customization", async () => {
    const registerPayload = {
      nom: "TestKayak",
      prenom: "Racer",
      anneeNaissance: 1990,
      sexe: "M",
      pays: "France",
      login: "kayak_pilot_" + Date.now().toString().slice(-6),
      email: `pilot_${Date.now()}@test.com`,
      password: "password123",
      kayakCustomization: {
        hullColor: "#ff0055",
        bladeColor: "#ffe600",
        pattern: "racing-stripe",
        glowColor: "#ff0055",
      },
    };

    const res = await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerPayload),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.success, true);
    assert.ok(data.user);
    assert.strictEqual(data.user.kayakCustomization?.hullColor, "#ff0055");
  });

  it("should update kayak customization via PUT /api/user/kayak", async () => {
    const login = "kayak_update_" + Date.now().toString().slice(-6);
    await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nom: "Pilot",
        prenom: "Custom",
        anneeNaissance: 1992,
        sexe: "F",
        pays: "France",
        login,
        email: `${login}@test.com`,
        password: "password123",
      }),
    });

    const updateRes = await fetch(`${baseUrl}/api/user/kayak`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: login,
        kayakCustomization: {
          hullColor: "#39ff14",
          bladeColor: "#00f0ff",
          pattern: "dual-tone",
          glowColor: "#39ff14",
        },
      }),
    });
    const updateData = await updateRes.json();
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateData.success, true);
    assert.strictEqual(updateData.user.kayakCustomization.pattern, "dual-tone");
    assert.strictEqual(updateData.user.kayakCustomization.hullColor, "#39ff14");
  });

  it("should reject invalid color formats on PUT /api/user/kayak", async () => {
    const res = await fetch(`${baseUrl}/api/user/kayak`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "any_user",
        kayakCustomization: {
          hullColor: "not-a-color",
          bladeColor: "#000",
          pattern: "solid",
          glowColor: "#111",
        },
      }),
    });
    assert.strictEqual(res.status, 400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails before implementation**

Run: `node --test backend/tests/kayak-customization.test.js`
Expected: FAIL (404 on `/api/user/kayak`).

- [ ] **Step 3: Implement controller and route handlers in backend**

In `backend/src/controllers/user.controller.ts`:
Add helper:
```typescript
function isValidHexColor(color: any): boolean {
  return typeof color === "string" && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color.trim());
}

const VALID_PATTERNS = ["solid", "racing-stripe", "dual-tone", "gradient"];
```
Implement `updateKayakCustomization`:
```typescript
export const updateKayakCustomization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, kayakCustomization } = req.body || {};
    const cleanUserId = String(userId || "").trim();

    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis." });
      return;
    }
    if (!kayakCustomization || typeof kayakCustomization !== "object") {
      res.status(400).json({ success: false, message: "La configuration du kayak est requise." });
      return;
    }

    const { hullColor, bladeColor, pattern, glowColor } = kayakCustomization;
    if (!isValidHexColor(hullColor) || !isValidHexColor(bladeColor) || !isValidHexColor(glowColor)) {
      res.status(400).json({ success: false, message: "Les couleurs doivent être au format hexadécimal (#RRGGBB)." });
      return;
    }
    if (!VALID_PATTERNS.includes(pattern)) {
      res.status(400).json({ success: false, message: "Le motif choisi est invalide." });
      return;
    }

    const cleanCustomization = {
      hullColor: hullColor.trim(),
      bladeColor: bladeColor.trim(),
      pattern,
      glowColor: glowColor.trim(),
    };

    const user = await userStore.getUserById(cleanUserId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const updated = await userStore.updateUser(cleanUserId, { kayakCustomization: cleanCustomization });
    res.status(200).json({
      success: true,
      message: "Style du kayak mis à jour avec succès.",
      user: sanitizeUser(updated || user),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || "Erreur lors de la mise à jour du kayak." });
  }
};
```
In `backend/src/routes/user.routes.ts`:
Add:
```typescript
router.put("/kayak", userController.updateKayakCustomization);
```
In `backend/src/controllers/user.controller.ts`:
In `registerUser`: also persist `kayakCustomization` if provided in `req.body` (or default).
In `backend/src/services/race-manager.service.ts`:
In `toLiveMetrics`: check `userStore.getUserById(userId)?.kayakCustomization` or `participantInfo?.kayak`, and attach `kayak` to returned `LiveRacerMetric`.

- [ ] **Step 4: Run backend tests to verify they pass**

Run: `npm run build` in `backend`, then `node --test backend/tests/kayak-customization.test.js`.
Expected: PASS with all tests passing.

- [ ] **Step 5: Commit backend endpoints and telemetry sync**

```bash
git add backend/src/controllers/user.controller.ts backend/src/routes/user.routes.ts backend/src/services/race-manager.service.ts backend/tests/kayak-customization.test.js
git commit -m "feat(api): implement kayak customization endpoint and live race telemetry propagation"
```

---

### Task 3: 2D Canvas Regatta Rendering Engine Update

**Files:**
- Modify: `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`

**Interfaces:**
- Consumes: `LiveRacerMetric.kayak`, `@Input() myKayakCustomization?: KayakCustomization`.
- Produces: Visual patterns (`solid`, `racing-stripe`, `dual-tone`, `gradient`), customized hull/blade/glow colors on canvas.

- [ ] **Step 1: Extend BoatRenderState**

In `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`:
```typescript
import { LiveRacerMetric } from '../../services/socket.service';
import { KayakCustomization } from '../../models/user.model';

interface BoatRenderState {
  // ... existing fields ...
  kayak?: KayakCustomization;
}
```
Add Input:
```typescript
@Input() myKayakCustomization?: KayakCustomization;
```
In `setRacers`: copy `r.kayak` to `boat.kayak`. If `boat.userId === this.activeUserId && this.myKayakCustomization`, prioritize `this.myKayakCustomization`.

- [ ] **Step 2: Implement canvas drawing logic for customized kayaks**

In `drawCanvasScene`:
Resolve active boat style:
```typescript
const custom = boat.kayak || (isUser ? this.myKayakCustomization : undefined);
const effectiveHullColor = custom?.hullColor || (isUser ? '#00e5ff' : boat.color);
const effectiveBladeColor = custom?.bladeColor || (isUser ? '#00f0ff' : boat.color);
const effectiveGlowColor = custom?.glowColor || (isUser ? '#00f0ff' : '#ffe600');
const effectivePattern = custom?.pattern || (isUser ? 'racing-stripe' : 'solid');
```
1. **Dynamic Glow / Halo**:
```typescript
if (isUser || isFocused || custom) {
  ctx.save();
  ctx.shadowColor = effectiveGlowColor;
  ctx.shadowBlur = (isUser || isFocused) ? (14 + Math.sin(nowSec * 5) * 5) : 8;
  ctx.strokeStyle = effectiveGlowColor;
  ctx.lineWidth = (isUser || isFocused) ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y, hullRx + 4, hullRy + 3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
```
2. **Oar Blades (`pelles`)**:
```typescript
ctx.fillStyle = effectiveBladeColor;
ctx.strokeStyle = '#ffffff';
// ... draw oar ellipses ...
```
3. **Hull Profile & Patterns**:
```typescript
// Coque de base
ctx.save();
ctx.beginPath();
ctx.moveTo(x + hullRx, y);
ctx.quadraticCurveTo(x, y - hullRy, x - hullRx, y);
ctx.quadraticCurveTo(x, y + hullRy, x + hullRx, y);
ctx.closePath();

if (effectivePattern === 'gradient') {
  const grad = ctx.createLinearGradient(x - hullRx, y, x + hullRx, y);
  grad.addColorStop(0, effectiveBladeColor);
  grad.addColorStop(1, effectiveHullColor);
  ctx.fillStyle = grad;
  ctx.fill();
} else if (effectivePattern === 'dual-tone') {
  ctx.fillStyle = effectiveHullColor;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = effectiveBladeColor;
  ctx.fillRect(x - hullRx, y - hullRy * 2, hullRx, hullRy * 4); // stern half
  ctx.restore();
} else {
  ctx.fillStyle = effectiveHullColor;
  ctx.fill();
}

// Racing stripes pattern
if (effectivePattern === 'racing-stripe') {
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = isCompact ? 1.0 : 1.4;
  ctx.beginPath();
  ctx.moveTo(x - hullRx + 2, y - 1.2);
  ctx.lineTo(x + hullRx - 2, y - 1.2);
  ctx.moveTo(x - hullRx + 2, y + 1.2);
  ctx.lineTo(x + hullRx - 2, y + 1.2);
  ctx.stroke();
  ctx.restore();
}

ctx.strokeStyle = isUser ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
ctx.lineWidth = isUser ? 1.5 : 1;
ctx.stroke();
ctx.restore();
```

- [ ] **Step 3: Verify frontend compilation**

Run: `npm run build` in `frontend`.
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit canvas updates**

```bash
git add frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts
git commit -m "feat(canvas): render customizable hull colors, patterns, blades and glow"
```

---

### Task 4: Frontend UI - Kayak Customizer Component, Onboarding & Profile Integration

**Files:**
- Modify: `frontend/src/app/services/rower.service.ts`
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.css`

**Interfaces:**
- Consumes: `rowerService.updateKayakCustomization(userId, customization)`.
- Produces: `accountModalTab: 'login' | 'register' | 'profile' | 'forgot' | 'kayak-customizer'`, mini preview canvas with live feedback, and profile integration.

- [ ] **Step 1: Add updateKayakCustomization in RowerService**

In `frontend/src/app/services/rower.service.ts`:
```typescript
updateKayakCustomization(userId: string, kayakCustomization: KayakCustomization): Observable<{ success: boolean; message: string; user: UserProfile }> {
  return this.http.put<{ success: boolean; message: string; user: UserProfile }>(
    `${this.apiUrl}/user/kayak`,
    { userId, kayakCustomization }
  );
}
```

- [ ] **Step 2: Add state and controller methods in App component**

In `frontend/src/app/app.ts`:
1. Expand `accountModalTab`: `'login' | 'register' | 'profile' | 'forgot' | 'kayak-customizer'`.
2. Add customization state:
```typescript
customKayakHullColor = '#00e5ff';
customKayakBladeColor = '#00f0ff';
customKayakPattern: KayakPattern = 'racing-stripe';
customKayakGlowColor = '#00f0ff';
isSavingKayak = false;
isPostRegisterOnboarding = false;

readonly presetColors = [
  { name: 'Cyan Néon', hex: '#00e5ff' },
  { name: 'Bleu Royal', hex: '#0055ff' },
  { name: 'Rouge Racing', hex: '#ff0055' },
  { name: 'Orange Éclair', hex: '#ff6600' },
  { name: 'Or Vainqueur', hex: '#ffe600' },
  { name: 'Vert Émeraude', hex: '#39ff14' },
  { name: 'Violet Pulsar', hex: '#b026ff' },
  { name: 'Noir Carbone', hex: '#1a1f2c' },
  { name: 'Blanc Pur', hex: '#ffffff' }
];

readonly patternOptions: { id: KayakPattern; label: string; icon: string; desc: string }[] = [
  { id: 'solid', label: 'Uni Épuré', icon: '🎨', desc: 'Finition classique monochrome' },
  { id: 'racing-stripe', label: 'Bande Racing', icon: '⚡', desc: 'Double liseré central athlétique' },
  { id: 'dual-tone', label: 'Bi-Colore', icon: '🌗', desc: 'Contraste marqué proue / poupe' },
  { id: 'gradient', label: 'Dégradé', icon: '🌈', desc: 'Fusion fluide de teintes sportives' }
];
```
3. Load customization from user / localStorage on init and when loading profile:
```typescript
syncKayakCustomizationFromUser(user?: UserProfile): void {
  const custom = user?.kayakCustomization || this.getLocalKayakCustomization();
  if (custom) {
    this.customKayakHullColor = custom.hullColor || '#00e5ff';
    this.customKayakBladeColor = custom.bladeColor || '#00f0ff';
    this.customKayakPattern = custom.pattern || 'racing-stripe';
    this.customKayakGlowColor = custom.glowColor || '#00f0ff';
  }
}
```
4. Update `submitAccountRegister`:
On registration success:
```typescript
this.isPostRegisterOnboarding = true;
this.accountModalTab = 'kayak-customizer';
```
5. Implement `saveKayakCustomization()` and `skipKayakCustomization()`:
Saves to backend via `rowerService.updateKayakCustomization`, updates `localStorage.setItem('rower_kayak_customization', ...)` and transitions to profile tab with success message.
6. Pass `myKayakCustomization` to `app-regatta-canvas` in template:
`[myKayakCustomization]="currentKayakCustomization"`.

- [ ] **Step 3: Add UI markup and styles in app.html & app.css**

In `frontend/src/app/app.html`:
1. Add Tab button in modal header when registered or during onboarding:
```html
@if (isRegisteredUser) {
  <button type="button" class="modal-tab-btn" [class.active]="accountModalTab === 'kayak-customizer'" (click)="openKayakCustomizer()">
    🛶 Mon Kayak
  </button>
}
```
2. Add `@if (accountModalTab === 'kayak-customizer')`:
- Onboarding banner if `isPostRegisterOnboarding`.
- Live preview canvas showing kayak with current parameters.
- Swatches and pickers for `HullColor`, `BladeColor`, `GlowColor`.
- Interactive pattern selector tiles with icons.
- Action buttons: "Enregistrer mon style 🛶" and "Passer / Conserver le style par défaut".
3. In Profile tab (`accountModalTab === 'profile'`), add:
- "🛶 Mon Kayak personnalisé" card with visual preview and "🎨 Personnaliser mon kayak" button triggering `openKayakCustomizer()`.

In `frontend/src/app/app.css`:
- Add sleek modern styling matching the dark cyberpunk/aquatic theme:
  - Color swatches with active rings and hover effects.
  - Pattern selection grid with active borders and glowing highlights.
  - Live preview container with animated water reflection.
  - Responsive flex/grid layout for mobile and desktop.

- [ ] **Step 4: Build frontend and verify no compile errors**

Run: `npm run build` in `frontend`.
Expected: PASS with clean build.

- [ ] **Step 5: Commit frontend UI and profile integration**

```bash
git add frontend/src/app/services/rower.service.ts frontend/src/app/app.ts frontend/src/app/app.html frontend/src/app/app.css
git commit -m "feat(ui): add kayak customizer view, onboarding flow, live preview, and profile integration"
```

---

### Task 5: End-to-End Verification & Documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-11-17-kayak-customization.md` (check off steps)
- Create: `<Artifact Directory>/walkthrough.md`

- [ ] **Step 1: Run full backend test suite**

Run: `npm test` in `backend`.
Expected: All tests pass.

- [ ] **Step 2: Run full frontend build**

Run: `npm run build` in `frontend`.
Expected: Build succeeded with 0 errors.

- [ ] **Step 3: Manual flow verification**

1. Register new user -> immediately lands on Kayak Customizer tab with welcome message.
2. Change hull color to Ruby Red, blades to Gold, pattern to Dual-Tone. Verify live preview updates immediately.
3. Save -> confirmation message displayed, profile tab opened, "Mon Kayak" card shows updated configuration.
4. Join race -> Canvas renders user's customized kayak with dual-tone ruby/gold and glowing halo.
5. Edit kayak from profile -> change pattern to racing stripes -> save -> verify immediate update.

- [ ] **Step 4: Final commit and plan completion**

```bash
git commit -m "chore: complete kayak customization feature implementation and verification"
```
