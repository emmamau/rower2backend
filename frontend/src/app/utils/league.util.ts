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
