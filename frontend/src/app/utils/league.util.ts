export interface LeagueInfo {
  id: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  name: string;
  badge: string;
  minPoints: number;
  color: string;
  description?: string;
}

export const LEAGUES: LeagueInfo[] = [
  { id: "diamond", name: "Diamant", badge: "👑", minPoints: 1000, color: "#b9f2ff", description: "Élite mondiale et maîtres de l'aviron esport" },
  { id: "platinum", name: "Platine", badge: "💎", minPoints: 600, color: "#00f0ff", description: "Compétiteurs de haut niveau et régatiers aguerris" },
  { id: "gold", name: "Or", badge: "🥇", minPoints: 300, color: "#ffd700", description: "Rameurs confirmés et réguliers sur les podiums" },
  { id: "silver", name: "Argent", badge: "🥈", minPoints: 100, color: "#c0c0c0", description: "Rameurs intermédiaires en progression constante" },
  { id: "bronze", name: "Bronze", badge: "🥉", minPoints: 0, color: "#cd7f32", description: "Ligue d'accès et d'entraînement pour tous les rameurs" },
];

export function getLeagueByPoints(points: number = 0): LeagueInfo {
  const pts = Math.max(0, points || 0);
  for (const league of LEAGUES) {
    if (pts >= league.minPoints) {
      return league;
    }
  }
  return LEAGUES[LEAGUES.length - 1];
}
