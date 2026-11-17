export type KayakPattern = 'solid' | 'racing-stripe' | 'dual-tone' | 'gradient';

export interface KayakCustomization {
  hullColor: string;
  bladeColor: string;
  pattern: KayakPattern;
  glowColor: string;
}

export const DEFAULT_KAYAK_CUSTOMIZATION: KayakCustomization = {
  hullColor: '#00e5ff',
  bladeColor: '#00f0ff',
  pattern: 'racing-stripe',
  glowColor: '#00f0ff',
};

export function normalizeHexColor(color: any, fallback: string): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  const match3 = /^#([0-9A-Fa-f]{3})$/.exec(trimmed);
  if (match3) {
    const [r, g, b] = match3[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#([0-9A-Fa-f]{6})$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return fallback;
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHexColor(hex, '#00f0ff').replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function sanitizeKayakCustomization(custom?: any): KayakCustomization {
  const hullColor = normalizeHexColor(custom?.hullColor, '#00e5ff');
  const bladeColor = normalizeHexColor(custom?.bladeColor, '#00f0ff');
  const glowColor = normalizeHexColor(custom?.glowColor, '#00f0ff');
  const validPatterns = ['solid', 'racing-stripe', 'dual-tone', 'gradient'];
  const pattern: KayakPattern = (custom?.pattern && validPatterns.includes(custom.pattern))
    ? custom.pattern
    : 'racing-stripe';

  return { hullColor, bladeColor, pattern, glowColor };
}

export type LeagueTier = 'BRONZE' | 'SILVER' | 'GOLD';
export type LeagueOutcome = 'PROMOTED' | 'RELEGATED' | 'MAINTAINED' | 'FROZEN';

export interface UserProfile {
  id: string; // Identifiant ou login
  name: string; // Nom d'affichage ou login du joueur
  login?: string; // Login unique
  email?: string; // Email
  lastName?: string; // Nom
  firstName?: string; // Prénom
  birthYear?: number; // Année de naissance
  gender?: string; // Sexe ('M' | 'F' | 'Autre')
  country?: string; // Pays
  isSubscriber?: boolean; // Droit de créer des salons privés
  subscriptionTier?: string;
  subscriptionStatus?: string;
  isConfirmed?: boolean; // Confirmé via montre Garmin
  watchUserId?: string; // ID de la montre Garmin
  watchModel?: string;
  rowerModel?: string;
  totalRaces?: number;
  totalWins?: number;
  podiums?: number;
  points?: number; // Points carrière / historiques
  totalCareerPoints?: number; // Points cumulés sur toute la carrière
  weeklyPoints?: number; // Points de la semaine en cours
  league?: string;
  currentLeague?: LeagueTier; // Ligue active ('BRONZE' | 'SILVER' | 'GOLD')
  isResting?: boolean; // Mode vacances / repos
  leagueName?: string;
  leagueBadge?: string;
  bestRank?: number;
  lastRank?: number;
  isAdmin?: boolean;
  role?: string;
  isRevoked?: boolean;
  isGarminPaired?: boolean;
  pairedDevice?: {
    deviceId?: string;
    deviceToken?: string;
    pairedAt?: string;
  };
  kayakCustomization?: KayakCustomization;
  createdAt?: string;
  updatedAt?: string;
}

export interface RegisterUserDto {
  nom: string;
  prenom: string;
  anneeNaissance: number;
  sexe: string;
  pays: string;
  login: string;
  email: string;
  password: string;
  watchUserId?: string;
  deviceToken?: string;
  guestPairingToken?: string;
  guestToken?: string;
  guestUserId?: string;
}

export interface LoginDto {
  login: string;
  password: string;
  watchUserId?: string;
  deviceToken?: string;
  guestPairingToken?: string;
  guestUserId?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  token?: string;
  role?: string;
  user: UserProfile;
  isSubscriber?: boolean;
  isAdmin?: boolean;
  isGarminPaired?: boolean;
  pairedDevice?: {
    deviceId?: string;
    deviceToken?: string;
    pairedAt?: string;
  };
  confirmationRequestId?: string;
}

export interface UserHistoryItem {
  activityId: string;
  targetDistance: number;
  netDistance: number;
  elapsedTime: number;
  status: string;
  finalRank?: number;
  createdAt?: string;
}

export interface UserProfileResponse {
  user: UserProfile;
  isGarminPaired?: boolean;
  pairedDevice?: {
    deviceId?: string;
    deviceToken?: string;
    pairedAt?: string;
  };
  generalRank?: number;
  totalPlayers?: number;
  history: UserHistoryItem[];
}

export interface GeneralLeaderboardResponse {
  success: boolean;
  players: UserProfile[];
}

export interface LeagueStandingItem {
  user_id: string;
  user_name: string;
  display_name: string;
  current_league: LeagueTier;
  is_resting: boolean;
  weekly_points: number;
  weekly_races_count: number;
  weekly_best_pace_ms: number | null;
  total_career_points: number;
  country: string;
  tier_rank: number;
  zone: 'PROMOTION' | 'RELEGATION' | 'MAINTAIN' | 'FROZEN';
  isFrozen: boolean;
}

export interface LeagueStandingsResponse {
  success: boolean;
  tier: LeagueTier;
  totalPlayers: number;
  totalActive: number;
  promoThreshold: number;
  relegateThreshold: number;
  standings: LeagueStandingItem[];
}

export interface WeeklyLeagueHistoryItem {
  id: number;
  user_id: string;
  week_start_date: string;
  previous_league: LeagueTier;
  new_league: LeagueTier;
  outcome: LeagueOutcome;
  final_points: number;
  final_rank: number | null;
  seen_by_user: boolean;
  created_at: string;
}

export interface UnseenSummaryResponse {
  success: boolean;
  summary: WeeklyLeagueHistoryItem | null;
}
