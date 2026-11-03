export interface UserProfile {
  id: string; // Identifiant de la montre
  name: string; // Login du joueur
  totalRaces?: number;
  totalWins?: number;
  podiums?: number;
  createdAt?: string;
  updatedAt?: string;
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
  history: UserHistoryItem[];
}
