export interface UserProfile {
  id: number;
  email: string;
  name: string;
  avatarUrl?: string;
  athleteLevel?: string;
  weightKg?: number;
  heightCm?: number;
  maxHeartRate?: number;
  vo2MaxEstimate?: number;
  createdAt?: string;
  updatedAt?: string;
}

