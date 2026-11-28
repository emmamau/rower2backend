/**
 * Logique pure de la caméra suiveuse (mode `follow_camera`) du canevas de course.
 * Aucune dépendance Angular / DOM : testable unitairement.
 */

/** Échelle réelle : 1 mètre = 16 px (un kayak de 8 à 10 m ≈ 130 à 160 px). */
export const PIXELS_PER_METER = 16;
/** Le kayak suivi est placé à 25 % depuis le bord gauche de l'écran. */
export const FOLLOW_ANCHOR_RATIO = 0.25;
/** En fin de course, la ligne d'arrivée s'immobilise à 85 % de la largeur. */
export const FINISH_VIEW_RATIO = 0.85;
/** Vitesse de rattrapage du lissage de la caméra (1/s). */
export const CAMERA_SMOOTHING_RATE = 7;
/** Espacement des bouées de couloir (m). */
export const BUOY_SPACING_M = 25;
/** Espacement des repères de distance (m) et des panneaux marquants (m). */
export const DISTANCE_MARK_M = 100;
export const SIGN_MARK_M = 500;
/** Zones rouges des bouées : 100 premiers mètres et 250 derniers mètres. */
export const BUOY_RED_START_M = 100;
export const BUOY_RED_END_M = 250;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Position cible de la caméra (px monde) pour un kayak suivi à `followedDistM`. */
export function computeFollowCameraTarget(
  followedDistM: number,
  raceDistanceM: number,
  canvasWidth: number
): number {
  const desired = followedDistM * PIXELS_PER_METER - canvasWidth * FOLLOW_ANCHOR_RATIO;
  const maxCam = Math.max(0, raceDistanceM * PIXELS_PER_METER - canvasWidth * FINISH_VIEW_RATIO);
  return clamp(desired, 0, maxCam);
}

/** Lissage exponentiel indépendant du framerate. */
export function smoothCameraX(current: number, target: number, dtSec: number, rate = CAMERA_SMOOTHING_RATE): number {
  const k = 1 - Math.exp(-rate * Math.max(0, dtSec));
  return current + (target - current) * k;
}

export function boatScreenX(distM: number, cameraX: number): number {
  return distM * PIXELS_PER_METER - cameraX;
}

/** Plage de distances (m) visible, avec une marge en pixels (culling). */
export function visibleRangeM(cameraX: number, canvasWidth: number, marginPx = 0): { startM: number; endM: number } {
  return {
    startM: (cameraX - marginPx) / PIXELS_PER_METER,
    endM: (cameraX + canvasWidth + marginPx) / PIXELS_PER_METER,
  };
}

/** Multiples de `stepM` dans [startM, endM] (culling des bouées et repères). */
export function multiplesInRange(stepM: number, startM: number, endM: number, maxM: number): number[] {
  const out: number[] = [];
  const first = Math.max(0, Math.ceil(startM / stepM)) * stepM;
  for (let m = first; m <= Math.min(endM, maxM); m += stepM) {
    out.push(m);
  }
  return out;
}

export type BuoyColor = 'red' | 'white' | 'yellow';

/** Rouge sur les 100 premiers / 250 derniers mètres, blanc/jaune au milieu. */
export function buoyColorAt(distM: number, raceDistanceM: number): BuoyColor {
  if (distM <= BUOY_RED_START_M || distM >= raceDistanceM - BUOY_RED_END_M) return 'red';
  return Math.round(distM / BUOY_SPACING_M) % 2 === 0 ? 'yellow' : 'white';
}

export function formatGapMeters(gapM: number): string {
  const rounded = Math.round(gapM);
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${Math.abs(rounded)} m`;
}

export interface OffscreenCandidate {
  userId: string;
  name: string;
  dist: number;
}

export interface OffscreenBadge {
  userId: string;
  name: string;
  gapM: number;
  side: 'left' | 'right';
  label: string;
}

/**
 * Kayaks hors du champ principal (boatScreenX < 0 ou > largeur), triés par proximité
 * du kayak suivi, avec un nombre maximum de badges par côté.
 */
export function computeOffscreenBadges(
  boats: OffscreenCandidate[],
  followedId: string,
  followedDistM: number,
  cameraX: number,
  canvasWidth: number,
  maxPerSide = 3
): { left: OffscreenBadge[]; right: OffscreenBadge[]; hiddenLeft: number; hiddenRight: number } {
  const left: OffscreenBadge[] = [];
  const right: OffscreenBadge[] = [];
  for (const b of boats) {
    if (b.userId === followedId) continue;
    const sx = boatScreenX(b.dist, cameraX);
    const gapM = b.dist - followedDistM;
    if (sx < 0) {
      left.push({ userId: b.userId, name: b.name, gapM, side: 'left', label: `◀ ${b.name} (${formatGapMeters(gapM)})` });
    } else if (sx > canvasWidth) {
      right.push({ userId: b.userId, name: b.name, gapM, side: 'right', label: `${b.name} (${formatGapMeters(gapM)}) ▶` });
    }
  }
  left.sort((a, b) => Math.abs(a.gapM) - Math.abs(b.gapM));
  right.sort((a, b) => Math.abs(a.gapM) - Math.abs(b.gapM));
  return {
    left: left.slice(0, maxPerSide),
    right: right.slice(0, maxPerSide),
    hiddenLeft: Math.max(0, left.length - maxPerSide),
    hiddenRight: Math.max(0, right.length - maxPerSide),
  };
}
