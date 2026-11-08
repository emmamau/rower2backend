/**
 * Système de points et progression en ligues (Rower Race)
 * 
 * 1. Règles d'attribution des points à la fin d'une course :
 *    - Prime d'accomplissement : Base fixe BaseFinish = 10 points garantie pour tout joueur qui franchit la ligne d'arrivée.
 *    - Points de performance : proportionnels au classement final et au nombre total de participants (N) :
 *      Points = BaseFinish + ((N - position + 1) / N) * (FacteurCourse * N)
 *      avec FacteurCourse = 5
 *      Garantit qu'une victoire face à un peloton fourni rapporte significativement plus qu'une victoire en duel à 2.
 * 
 * 2. Système de Ligues :
 *    - Bronze  : 0 à 99 pts (🥉)
 *    - Argent  : 100 à 299 pts (🥈)
 *    - Or      : 300 à 599 pts (🥇)
 *    - Platine : 600 à 999 pts (💎)
 *    - Diamant : 1000+ pts (👑)
 * 
 * 3. Équilibrage des Bots (Allures réalistes et distribution asymétrique) :
 *    - Plage d'allure : 1 min 50 s / 500 m (110s) à 2 min 45 s / 500 m (165s)
 *    - 60 % de bots de niveau modéré/faible entre 2m20s (140s) et 2m45s (165s)
 *    - 30 % de bots de niveau intermédiaire entre 2m05s (125s) et 2m20s (140s)
 *    - 10 % de bots rapides (tête de course) entre 1m50s (110s) et 2m05s (125s)
 */

export const BASE_FINISH_POINTS = 10;
export const RACE_FACTOR = 5;

/**
 * Calcule les points obtenus à la fin d'une course
 * @param position Classement du coureur (1 = vainqueur)
 * @param totalParticipants Nombre total de participants ayant pris part à la course (N)
 * @param isFinisher True si le joueur a franchi la ligne d'arrivée (false en cas d'abandon / temps dépassé)
 */
export function calculateRacePoints(position: number, totalParticipants: number, isFinisher: boolean): number {
  if (!isFinisher || position <= 0) {
    return 0;
  }
  const N = Math.max(1, totalParticipants);
  const pos = Math.max(1, Math.min(position, N));
  const performancePoints = Math.round(((N - pos + 1) / N) * (RACE_FACTOR * N));
  return BASE_FINISH_POINTS + performancePoints;
}

export interface LeagueInfo {
  id: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  name: string;
  badge: string;
  minPoints: number;
  color: string;
}

export const LEAGUES: LeagueInfo[] = [
  { id: "diamond", name: "Diamant", badge: "👑", minPoints: 1000, color: "#b9f2ff" },
  { id: "platinum", name: "Platine", badge: "💎", minPoints: 600, color: "#00f0ff" },
  { id: "gold", name: "Or", badge: "🥇", minPoints: 300, color: "#ffd700" },
  { id: "silver", name: "Argent", badge: "🥈", minPoints: 100, color: "#c0c0c0" },
  { id: "bronze", name: "Bronze", badge: "🥉", minPoints: 0, color: "#cd7f32" },
];

/**
 * Détermine la ligue d'un joueur à partir de son total de points
 */
export function getLeagueByPoints(points: number = 0): LeagueInfo {
  const pts = Math.max(0, points || 0);
  for (const league of LEAGUES) {
    if (pts >= league.minPoints) {
      return league;
    }
  }
  return LEAGUES[LEAGUES.length - 1];
}

/**
 * Génère une allure réaliste de bot selon la distribution asymétrique pondérée
 * @returns Allure en secondes pour 500m (entre 110s et 165s)
 */
export function generateRealisticBotPace(): number {
  const roll = Math.random();
  if (roll < 0.60) {
    // 60 % de bots entre 2m20s (140s) et 2m45s (165s) - niveau débutant / loisir
    return Math.round(140 + Math.random() * (165 - 140));
  } else if (roll < 0.90) {
    // 30 % de bots entre 2m05s (125s) et 2m20s (140s) - niveau modéré / régulier
    return Math.round(125 + Math.random() * (140 - 125));
  } else {
    // 10 % de bots rapides entre 1m50s (110s) et 2m05s (125s) - défi de tête de course
    return Math.round(110 + Math.random() * (125 - 110));
  }
}

/**
 * Calcule la puissance (Watts) et la cadence (SPM) selon la formule officielle Concept2
 */
export function calculateBotPhysics(paceSec: number): { power: number; spm: number; speedMs: number } {
  const pace = Math.max(60, paceSec);
  const speedMs = 500 / pace;
  const power = Math.round(2.80 * Math.pow(speedMs, 3));
  const spm = Math.round(18 + (speedMs / 5.0) * 14);
  return { power, spm, speedMs };
}
