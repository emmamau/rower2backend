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
  points?: number;
  league?: string;
  leagueName?: string;
  leagueBadge?: string;
  bestRank?: number;
  lastRank?: number;
  isAdmin?: boolean;
  isGarminPaired?: boolean;
  pairedDevice?: {
    deviceId?: string;
    deviceToken?: string;
    pairedAt?: string;
  };
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
  guestPairingToken?: string;
  guestToken?: string;
}

export interface LoginDto {
  login: string;
  password: string;
  watchUserId?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
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
