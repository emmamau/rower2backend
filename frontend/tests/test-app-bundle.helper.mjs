import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '../src/app');

function collectFiles(dir, ext, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'private-room-manager' && entry.name !== 'admin-dashboard' && entry.name !== 'regatta-canvas') {
        collectFiles(fullPath, ext, results);
      }
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Lit et agrège app.html ainsi que tous les templates HTML des sous-composants découpés de AppComponent.
 * Maintient l'ordre logique du DOM pour que les vérifications d'index et de structure continuent de fonctionner.
 */
export function readAppHtmlBundle() {
  const orderedPaths = [
    path.join(appDir, 'components/race-overlays/race-overlays.component.html'),
    path.join(appDir, 'components/app-header/app-header.component.html'),
    path.join(appDir, 'components/modals/account-modal/account-modal.component.html'),
    path.join(appDir, 'components/modals/race-history-modal/race-history-modal.component.html'),
    path.join(appDir, 'components/modals/unified-config-modal/unified-config-modal.component.html'),
    path.join(appDir, 'components/modals/standings-modal/standings-modal.component.html'),
    path.join(appDir, 'components/modals/legal-terms-modal/legal-terms-modal.component.html'),
    path.join(appDir, 'app.html'),
    path.join(appDir, 'components/regatta-view/regatta-view.component.html'),
    path.join(appDir, 'components/cockpit-view/cockpit-view.component.html'),
    path.join(appDir, 'components/home-dashboard/home-dashboard.component.html'),
    path.join(appDir, 'components/seo-footer/seo-footer.component.html'),
    path.join(appDir, 'components/modals/subscription-modal/subscription-modal.component.html'),
    path.join(appDir, 'components/modals/statistics-modal/statistics-modal.component.html')
  ];

  return orderedPaths
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, 'utf8'))
    .join('\n');
}

/**
 * Lit et agrège app.ts ainsi que les fichiers TS des sous-composants découpés de AppComponent.
 */
export function readAppTsBundle() {
  const files = collectFiles(appDir, '.ts');
  return files.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
}
