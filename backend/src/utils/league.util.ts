/**
 * Système de points et progression en ligues hebdomadaires (Rower Race)
 * 
 * Règles d'attribution des points à la fin d'une course :
 * 1. Abandon (is_dnf = true ou non finisher) : 0 point.
 * 2. Mode BOT :
 *    - Victoire (1er) : 5 points
 *    - Défaite (2e+) : 2 points
 *    - Plafond : 3 courses rémunérées par jour (Europe/Paris), 0 point au-delà.
 * 3. Modes Humains (DUEL_1V1 et MULTIPLAYER) :
 *    - basePoints = 10
 *    - rankBonus = (totalHumanFinishers - playerRank) * 15
 *    - podiumBonus = 20 (1er), 10 (2e), 5 (3e), 0 (4e+)
 *    - multiplier = 1.2 en MULTIPLAYER, 1.0 en DUEL_1V1
 *    - pointsEarned = Math.round((basePoints + rankBonus + podiumBonus) * multiplier)
 */

export type LeagueTier = "BRONZE" | "SILVER" | "GOLD";
export type LeagueOutcome = "PROMOTED" | "RELEGATED" | "MAINTAINED" | "FROZEN";

export interface LeagueInfo {
  id: string; // 'BRONZE' | 'SILVER' | 'GOLD' (ou 'bronze', etc.)
  tier: LeagueTier;
  name: string;
  badge: string;
  minPoints: number;
  color: string;
  description?: string;
}

export const WEEKLY_LEAGUES: Record<LeagueTier, LeagueInfo> = {
  GOLD: {
    id: "gold",
    tier: "GOLD",
    name: "Or",
    badge: "🥇",
    minPoints: 300,
    color: "#ffd700",
    description: "Élite des rameurs confirmés et réguliers sur les podiums",
  },
  SILVER: {
    id: "silver",
    tier: "SILVER",
    name: "Argent",
    badge: "🥈",
    minPoints: 100,
    color: "#c0c0c0",
    description: "Rameurs intermédiaires en progression constante",
  },
  BRONZE: {
    id: "bronze",
    tier: "BRONZE",
    name: "Bronze",
    badge: "🥉",
    minPoints: 0,
    color: "#cd7f32",
    description: "Ligue d'accès et d'entraînement pour tous les rameurs",
  },
};

export const LEAGUES: LeagueInfo[] = [
  { id: "diamond", tier: "GOLD", name: "Diamant", badge: "👑", minPoints: 1000, color: "#b9f2ff" },
  { id: "platinum", tier: "GOLD", name: "Platine", badge: "💎", minPoints: 600, color: "#00f0ff" },
  WEEKLY_LEAGUES.GOLD,
  WEEKLY_LEAGUES.SILVER,
  WEEKLY_LEAGUES.BRONZE,
];

export interface CalculateRacePointsOptions {
  raceMode: "BOT" | "SOLO" | "DUEL_1V1" | "MULTIPLAYER" | "RACE" | string;
  playerRank: number;
  totalHumanFinishers?: number;
  isFinisher?: boolean;
  isDnf?: boolean;
  todayRewardedBotRacesCount?: number;
  playerLeagueTier?: "BRONZE" | "SILVER" | "GOLD" | string;
  playerWins?: number;
  opponentLeagueTier?: "BRONZE" | "SILVER" | "GOLD" | string;
  opponentWins?: number;
}

export interface PointsBreakdown {
  basePoints: number;
  rankPoints: number;
  podiumBonus: number;
  higherRankedBonus: number;
  pelotonMultiplier: number;
  totalPoints: number;
  description: string;
}

function getTierWeight(tier?: string): number {
  const t = String(tier || "").toUpperCase();
  if (t === "GOLD" || t === "OR") return 3;
  if (t === "SILVER" || t === "ARGENT") return 2;
  if (t === "BRONZE") return 1;
  return 1;
}

/**
 * Calcule les points gagnés et le détail décomposé selon les spécifications officielles de ligue
 */
export function calculateRacePointsBreakdown(options: CalculateRacePointsOptions): PointsBreakdown {
  const {
    raceMode,
    playerRank,
    totalHumanFinishers = 1,
    isFinisher = true,
    isDnf = false,
    todayRewardedBotRacesCount = 0,
    playerLeagueTier = "BRONZE",
    playerWins = 0,
    opponentLeagueTier,
    opponentWins = 0,
  } = options;

  // 1. Abandon (DNF) ou non finisher
  if (isDnf || !isFinisher || playerRank <= 0) {
    return {
      basePoints: 0,
      rankPoints: 0,
      podiumBonus: 0,
      higherRankedBonus: 0,
      pelotonMultiplier: 1.0,
      totalPoints: 0,
      description: "0 pt (Abandon / DNF)",
    };
  }

  const normalizedMode = String(raceMode || "").toUpperCase();

  // 2. Mode BOT / SOLO
  if (normalizedMode === "BOT" || normalizedMode === "SOLO") {
    if (todayRewardedBotRacesCount >= 3) {
      return {
        basePoints: 0,
        rankPoints: 0,
        podiumBonus: 0,
        higherRankedBonus: 0,
        pelotonMultiplier: 1.0,
        totalPoints: 0,
        description: "0 pt (Plafond bot atteint : max 3 par jour)",
      };
    }
    const isWin = playerRank === 1;
    const pts = isWin ? 10 : 5;
    return {
      basePoints: pts,
      rankPoints: 0,
      podiumBonus: 0,
      higherRankedBonus: 0,
      pelotonMultiplier: 1.0,
      totalPoints: pts,
      description: isWin ? "+10 pts : Victoire contre bot" : "+5 pts : Entraînement bot terminé",
    };
  }

  const rank = Math.max(1, playerRank);
  const finishers = Math.max(1, totalHumanFinishers);
  const isDuel = normalizedMode === "DUEL_1V1" || (normalizedMode === "DUEL" || (normalizedMode === "RACE" && finishers === 2));

  // 3. Mode DUEL 1V1
  if (isDuel) {
    const basePoints = 10;
    if (rank === 1) {
      const rankPoints = 10; // 1 rameur battu
      const podiumBonus = 20; // 1ère place
      let higherRankedBonus = 0;
      const bonusParts: string[] = [];

      // Bonus Ligue supérieure (+25 pts)
      if (opponentLeagueTier && getTierWeight(opponentLeagueTier) > getTierWeight(playerLeagueTier)) {
        higherRankedBonus += 25;
        bonusParts.push("+25 pts ligue sup.");
      }

      // Bonus Palmarès victoires supérieur (+15 pts)
      if (Number(opponentWins) > Number(playerWins)) {
        higherRankedBonus += 15;
        bonusParts.push("+15 pts palmarès sup.");
      }

      const total = basePoints + rankPoints + podiumBonus + higherRankedBonus;
      const desc = higherRankedBonus > 0
        ? `+${total} pts : Victoire duel (40) ${bonusParts.join(" ")}`
        : `+${total} pts : Victoire duel (Base 10 + Battu 10 + Podium 20)`;

      return {
        basePoints,
        rankPoints,
        podiumBonus,
        higherRankedBonus,
        pelotonMultiplier: 1.0,
        totalPoints: total,
        description: desc,
      };
    } else {
      // Défaite en duel : points de participation
      return {
        basePoints,
        rankPoints: 0,
        podiumBonus: 0,
        higherRankedBonus: 0,
        pelotonMultiplier: 1.0,
        totalPoints: basePoints,
        description: `+${basePoints} pts : Duel terminé (Base de participation)`,
      };
    }
  }

  // 4. Mode MULTIPLAYER (peloton)
  const basePoints = 10;
  const beatenRacers = Math.max(0, finishers - rank);
  const rankPoints = beatenRacers * 10;

  let podiumBonus = 0;
  if (rank === 1) podiumBonus = 20;
  else if (rank === 2) podiumBonus = 10;
  else if (rank === 3) podiumBonus = 5;

  const pelotonMultiplier = finishers > 4 ? 1.25 : 1.0;
  const rawSum = basePoints + rankPoints + podiumBonus;
  const total = Math.round(rawSum * pelotonMultiplier);

  let desc = `+${total} pts : Base ${basePoints}`;
  if (rankPoints > 0) desc += ` + ${beatenRacers} battu(s) (${rankPoints})`;
  if (podiumBonus > 0) desc += ` + Podium (${podiumBonus})`;
  if (pelotonMultiplier > 1.0) desc += ` × Peloton (+25%)`;

  return {
    basePoints,
    rankPoints,
    podiumBonus,
    higherRankedBonus: 0,
    pelotonMultiplier,
    totalPoints: total,
    description: desc,
  };
}

/**
 * Calcule les points gagnés selon les spécifications officielles de ligue
 */
export function calculateRacePointsEarned(options: CalculateRacePointsOptions): number {
  return calculateRacePointsBreakdown(options).totalPoints;
}

export const BASE_FINISH_POINTS = 10;
export const RACE_FACTOR = 5;

/**
 * Fonction historique pour compatibilité et tests unitaires
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

/**
 * Détermine si le niveau de ligue d'un joueur satisfait les prérequis exigés pour un salon privé
 */
export function isLeagueEligible(userLeagueId?: string, userPoints?: number, requiredLeagueId?: string): boolean {
  if (!requiredLeagueId) return true;
  const target = LEAGUES.find((l) => l.id.toLowerCase() === requiredLeagueId.toLowerCase());
  if (!target) return true;
  let pts = userPoints;
  if (pts === undefined || pts === null || isNaN(pts)) {
    const userL = LEAGUES.find((l) => l.id.toLowerCase() === (userLeagueId || "BRONZE").toLowerCase());
    pts = userL ? userL.minPoints : 0;
  }
  return pts >= target.minPoints;
}

/**
 * Normalise ou déduit la ligue à partir du nom ou des points
 */
export function getLeagueByPoints(points: number = 0): LeagueInfo {
  const pts = Math.max(0, points || 0);
  for (const league of LEAGUES) {
    if (pts >= league.minPoints) {
      return league;
    }
  }
  return WEEKLY_LEAGUES.BRONZE;
}

export function getLeagueByTier(tier?: string): LeagueInfo {
  const t = String(tier || "BRONZE").toUpperCase() as LeagueTier;
  return WEEKLY_LEAGUES[t] || WEEKLY_LEAGUES.BRONZE;
}

/**
 * Génère une allure réaliste de bot selon la distribution asymétrique pondérée
 * @returns Allure en secondes pour 500m (entre 110s et 165s)
 */
export function generateRealisticBotPace(): number {
  const roll = Math.random();
  if (roll < 0.6) {
    return Math.round(140 + Math.random() * (165 - 140));
  } else if (roll < 0.9) {
    return Math.round(125 + Math.random() * (140 - 125));
  } else {
    return Math.round(110 + Math.random() * (125 - 110));
  }
}

/**
 * Calcule la puissance (Watts) et la cadence (SPM) selon la formule officielle Concept2
 */
export function calculateBotPhysics(paceSec: number): { power: number; spm: number; speedMs: number } {
  const pace = Math.max(60, paceSec);
  const speedMs = 500 / pace;
  const power = Math.round(2.8 * Math.pow(speedMs, 3));
  const spm = Math.round(18 + (speedMs / 5.0) * 14);
  return { power, spm, speedMs };
}
