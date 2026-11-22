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

export type RegattaMetricKey =
  | 'speed'
  | 'pace'
  | 'power'
  | 'position'
  | 'distToPrev'
  | 'distToLeader'
  | 'distToNext'
  | 'distRemaining'
  | 'distCovered'
  | 'force'
  | 'work'
  | 'avgSpeed'
  | 'avgPower'
  | 'avgPace'
  | 'chrono'
  | 'spm'
  | 'none';

export type LaneDataPosition = 'auto' | 'front' | 'back';

export interface RegattaPreferences {
  zoomLevel: number;
  selectedMetrics: RegattaMetricKey[];
  myLaneMetrics: [RegattaMetricKey, RegattaMetricKey];
  myLanePosition: LaneDataPosition;
  myHeaderMetric: RegattaMetricKey;
  opponentLaneMetrics: [RegattaMetricKey, RegattaMetricKey];
  opponentLanePosition: LaneDataPosition;
  opponentHeaderMetric: RegattaMetricKey;
  watermarkMetric: RegattaMetricKey;
}

export interface RegattaMetricOption {
  key: RegattaMetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  icon: string;
  desc: string;
}

export const REGATTA_METRICS_CATALOG: RegattaMetricOption[] = [
  { key: 'chrono', label: 'Chrono', shortLabel: 'CHRONO', unit: '', icon: '⏱️', desc: 'Temps écoulé depuis le départ' },
  { key: 'power', label: 'Puissance', shortLabel: 'PUISSANCE', unit: 'W', icon: '⚡', desc: 'Puissance instantanée développée en Watts' },
  { key: 'spm', label: 'Cadence', shortLabel: 'SPM', unit: 'spm', icon: '🚣', desc: 'Cadence de coups de rame par minute' },
  { key: 'speed', label: 'Vitesse', shortLabel: 'VITESSE', unit: 'km/h', icon: '🚀', desc: 'Vitesse instantanée du kayak' },
  { key: 'pace', label: 'Allure', shortLabel: 'ALLURE /500M', unit: '/500m', icon: '⏱️', desc: 'Allure instantanée aux 500m' },
  { key: 'position', label: 'Position', shortLabel: 'POSITION', unit: '', icon: '🏆', desc: 'Classement en direct dans la régate' },
  { key: 'distToPrev', label: 'Distance / joueur devant', shortLabel: 'ÉCART DEVANT', unit: 'm', icon: '⬆️', desc: 'Distance par rapport au joueur juste devant' },
  { key: 'distToLeader', label: 'Distance / premier', shortLabel: 'ÉCART 1ER', unit: 'm', icon: '👑', desc: 'Distance par rapport au leader de la course' },
  { key: 'distToNext', label: 'Distance / joueur derrière', shortLabel: 'ÉCART DERRIÈRE', unit: 'm', icon: '⬇️', desc: 'Distance par rapport au joueur qui suit' },
  { key: 'distRemaining', label: 'Distance restante', shortLabel: 'DIST. RESTANTE', unit: 'm', icon: '🎯', desc: 'Mètres restants jusqu’à la ligne d’arrivée' },
  { key: 'distCovered', label: 'Distance effectuée', shortLabel: 'DIST. EFFECTUÉE', unit: 'm', icon: '🚣', desc: 'Distance parcourue depuis le départ' },
  { key: 'force', label: 'Force', shortLabel: 'FORCE', unit: 'N', icon: '💪', desc: 'Force de traction par coup de rame (Newtons)' },
  { key: 'work', label: 'Travail', shortLabel: 'TRAVAIL', unit: 'J', icon: '🔋', desc: 'Travail mécanique par coup de rame (Joules)' },
  { key: 'avgSpeed', label: 'Vitesse moyenne', shortLabel: 'VITESSE MOY.', unit: 'km/h', icon: '📈', desc: 'Vitesse moyenne sur la course' },
  { key: 'avgPower', label: 'Puissance moyenne', shortLabel: 'PUISSANCE MOY.', unit: 'W', icon: '🔥', desc: 'Puissance moyenne en Watts sur la course' },
  { key: 'avgPace', label: 'Allure moyenne', shortLabel: 'ALLURE MOY.', unit: '/500m', icon: '⏳', desc: 'Allure moyenne aux 500m sur la course' },
];

export const VALID_REGATTA_METRIC_KEYS: RegattaMetricKey[] = REGATTA_METRICS_CATALOG.map((m) => m.key);

export const DEFAULT_REGATTA_METRICS: RegattaMetricKey[] = [
  'position',
  'power',
  'pace',
  'distCovered',
  'distRemaining',
  'distToPrev',
];

export const DEFAULT_REGATTA_PREFERENCES: RegattaPreferences = {
  zoomLevel: 1,
  selectedMetrics: [...DEFAULT_REGATTA_METRICS],
  myLaneMetrics: ['position', 'distRemaining'],
  myLanePosition: 'auto',
  myHeaderMetric: 'distCovered',
  opponentLaneMetrics: ['distRemaining', 'pace'],
  opponentLanePosition: 'auto',
  opponentHeaderMetric: 'distCovered',
  watermarkMetric: 'chrono',
};

export function sanitizeRegattaPreferences(prefs?: any): RegattaPreferences {
  const rawZoom = Number(prefs?.zoomLevel);
  const zoomLevel = Number.isFinite(rawZoom)
    ? Math.min(4, Math.max(1, Math.round(rawZoom * 2) / 2))
    : DEFAULT_REGATTA_PREFERENCES.zoomLevel;

  const validSet = new Set<string>([...VALID_REGATTA_METRIC_KEYS, 'none']);
  const uniqueMetrics: RegattaMetricKey[] = [];

  if (Array.isArray(prefs?.selectedMetrics)) {
    for (const item of prefs.selectedMetrics) {
      const k = String(item || '').trim() as RegattaMetricKey;
      if (validSet.has(k) && k !== 'none' && !uniqueMetrics.includes(k)) {
        uniqueMetrics.push(k);
      }
    }
  }

  if (uniqueMetrics.length === 0) {
    uniqueMetrics.push(...DEFAULT_REGATTA_METRICS);
  } else if (uniqueMetrics.length < 3) {
    for (const fallbackKey of DEFAULT_REGATTA_METRICS) {
      if (!uniqueMetrics.includes(fallbackKey)) {
        uniqueMetrics.push(fallbackKey);
      }
      if (uniqueMetrics.length >= 3) break;
    }
  }

  // Sanitize lane metrics helper
  const sanitizeMetricPair = (pair: any, fallback: [RegattaMetricKey, RegattaMetricKey]): [RegattaMetricKey, RegattaMetricKey] => {
    if (!Array.isArray(pair) || pair.length < 2) return [...fallback];
    const k1 = String(pair[0] || '').trim() as RegattaMetricKey;
    const k2 = String(pair[1] || '').trim() as RegattaMetricKey;
    const validK1 = validSet.has(k1) ? k1 : fallback[0];
    const validK2 = validSet.has(k2) ? k2 : fallback[1];
    return [validK1, validK2];
  };

  const sanitizePosition = (pos: any): LaneDataPosition => {
    const s = String(pos || '').trim().toLowerCase();
    return (s === 'front' || s === 'back' || s === 'auto') ? s : 'auto';
  };

  const sanitizeSingleMetric = (key: any, fallback: RegattaMetricKey): RegattaMetricKey => {
    const s = String(key || '').trim() as RegattaMetricKey;
    return validSet.has(s) ? s : fallback;
  };

  return {
    zoomLevel,
    selectedMetrics: uniqueMetrics,
    myLaneMetrics: sanitizeMetricPair(prefs?.myLaneMetrics, DEFAULT_REGATTA_PREFERENCES.myLaneMetrics),
    myLanePosition: sanitizePosition(prefs?.myLanePosition),
    myHeaderMetric: sanitizeSingleMetric(prefs?.myHeaderMetric, DEFAULT_REGATTA_PREFERENCES.myHeaderMetric),
    opponentLaneMetrics: sanitizeMetricPair(prefs?.opponentLaneMetrics, DEFAULT_REGATTA_PREFERENCES.opponentLaneMetrics),
    opponentLanePosition: sanitizePosition(prefs?.opponentLanePosition),
    opponentHeaderMetric: sanitizeSingleMetric(prefs?.opponentHeaderMetric, DEFAULT_REGATTA_PREFERENCES.opponentHeaderMetric),
    watermarkMetric: sanitizeSingleMetric(prefs?.watermarkMetric, DEFAULT_REGATTA_PREFERENCES.watermarkMetric),
  };
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
  language?: string; // Langue préférée ('fr', 'en', 'de', 'es', 'it', 'pt')
  isSubscriber?: boolean; // Droit de créer des salons privés
  is_subscriber?: boolean;
  subscriptionTier?: string;
  subscription_tier?: string;
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
  is_admin?: boolean;
  role?: string;
  isRevoked?: boolean;
  isGarminPaired?: boolean;
  pairedDevice?: {
    deviceId?: string;
    deviceToken?: string;
    pairedAt?: string;
  };
  kayakCustomization?: KayakCustomization;
  regattaPreferences?: RegattaPreferences;
  duelsWon?: number;
  duelsLost?: number;
  duelsDrawn?: number;
  duelPoints?: number;
  duelPreferences?: DuelPreferences;
  acceptsDuels?: boolean;
  referredBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DuelTimeWindow {
  startTime: string;
  endTime: string;
}

export interface DuelPreferences {
  acceptsDuels: boolean;
  isAbsent: boolean;
  absenceStartDate?: string | null;
  absenceEndDate?: string | null;
  refusedDays: number[]; // 0 = Dimanche ... 6 = Samedi
  availableWindows: DuelTimeWindow[];
  timezone?: string;
}

export type DuelChallengeStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REFUSED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FORFEIT'
  | 'COMPLETED';

export interface DuelChallenge {
  id: string;
  challengerUserId: string;
  challengerLogin: string;
  challengerName: string;
  challengedUserId: string;
  challengedLogin: string;
  challengedName: string;
  challengedEmail?: string;
  inviteToken?: string;
  slotStart: string;
  slotEnd: string;
  timezone: string;
  targetDistance: number;
  title: string;
  roomId?: string;
  roomCode?: string;
  roomPin?: string;
  status: DuelChallengeStatus;
  expiresAt: string;
  respondedAt?: string | null;
  cancelledAt?: string | null;
  cancelledByUserId?: string | null;
  winnerUserId?: string | null;
  forfeitUserId?: string | null;
  isDraw?: boolean;
  challengerPointsDelta: number;
  challengedPointsDelta: number;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableDuelPlayer {
  id: string;
  login: string;
  name: string;
  country?: string;
  gender?: string;
  birthYear?: number | null;
  currentLeague?: string;
  duelsWon: number;
  duelsLost: number;
  duelsDrawn: number;
  duelPoints: number;
  duelPreferences?: DuelPreferences;
}

export interface DuelLeaderboardItem {
  rank: number;
  id: string;
  login: string;
  name: string;
  currentLeague: string;
  country?: string;
  gender?: string;
  birthYear?: number | null;
  age?: number | null;
  duelsWon: number;
  duelsLost: number;
  duelsDrawn: number;
  duelPoints: number;
  totalDuels: number;
  acceptsDuels: boolean;
}

export interface MyDuelChallengesResponse {
  success: boolean;
  received: DuelChallenge[];
  sent: DuelChallenge[];
  blockedSlots: DuelChallenge[];
  stats: {
    duelsWon: number;
    duelsLost: number;
    duelsDrawn: number;
    duelPoints: number;
  };
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
  duelInviteToken?: string;
  duelPreferences?: DuelPreferences;
  website_url?: string;
  bot_trap?: string;
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
  subscriptionTier?: string;
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

export interface UserLastRaceSummary {
  hasRaced: boolean;
  rank?: number;
  rankDisplay?: string;
  distance?: number;
  timeFormatted?: string;
  date?: string | Date;
  dateFormatted?: string;
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
