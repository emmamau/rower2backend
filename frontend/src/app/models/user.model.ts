export interface UserProfile {
  id: string | number;
  email?: string;
  name: string;
  avatarUrl?: string;
  athleteLevel?: string;
  weightKg?: number;
  heightCm?: number;
  maxHeartRate?: number;
  vo2MaxEstimate?: number;
  totalRaces?: number;
  totalWins?: number;
  podiums?: number;
  createdAt?: string;
  updatedAt?: string;
}

