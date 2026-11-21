export type LeagueTier = "BRONZE" | "SILVER" | "GOLD";

export interface LeagueInfo {
  id: string;
  tier: LeagueTier;
  name: string;
  badge: string;
  minPoints: number;
  color: string;
  description: string;
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
  WEEKLY_LEAGUES.GOLD,
  WEEKLY_LEAGUES.SILVER,
  WEEKLY_LEAGUES.BRONZE,
  // Rétrocompatibilité
  { id: "diamond", tier: "GOLD", name: "Diamant", badge: "👑", minPoints: 1000, color: "#b9f2ff", description: "Élite mondiale et maîtres de l'aviron esport" },
  { id: "platinum", tier: "GOLD", name: "Platine", badge: "💎", minPoints: 600, color: "#00f0ff", description: "Compétiteurs de haut niveau et régatiers aguerris" },
];

export function getLeagueByTier(tier?: string): LeagueInfo {
  const t = String(tier || "BRONZE").toUpperCase() as LeagueTier;
  return WEEKLY_LEAGUES[t] || WEEKLY_LEAGUES.BRONZE;
}

export function getLeagueByPoints(points: number = 0): LeagueInfo {
  const pts = Math.max(0, points || 0);
  if (pts >= 300) return WEEKLY_LEAGUES.GOLD;
  if (pts >= 100) return WEEKLY_LEAGUES.SILVER;
  return WEEKLY_LEAGUES.BRONZE;
}

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

  if (isDuel) {
    const basePoints = 10;
    if (rank === 1) {
      const rankPoints = 10;
      const podiumBonus = 20;
      let higherRankedBonus = 0;
      const bonusParts: string[] = [];

      if (opponentLeagueTier && getTierWeight(opponentLeagueTier) > getTierWeight(playerLeagueTier)) {
        higherRankedBonus += 25;
        bonusParts.push("+25 pts ligue sup.");
      }

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
