export interface RowerData {
  id: string;
  activityId: string;
  userId: string;
  userName?: string;
  avatarUrl?: string;
  raceMode: 'race' | 'solo';
  targetDistance: number;
  status: 'waiting' | 'in_progress' | 'paused' | 'finished';

  initialDistance: number;
  currentDistance: number;
  netDistance: number;
  progressPercent: number;

  lastStrokeRate: number;
  lastStrokeCount: number;
  lastPower: number;
  lastPace: number;
  lastHeartRate: number;
  lastResistance: number;

  avgPower: number;
  avgPace: number;
  avgStrokeRate: number;
  totalStrokes: number;
  totalEnergy: number;
  elapsedTime: number;
  avgSpeedKmh: number;

  finalRank?: number;
  finishedAt?: string;
  updatedAt?: string;
}

export interface NextRaceInfo {
  race: {
    id: string;
    title: string;
    targetDistance: number;
    startTime: string;
    intervalMinutes: number;
    status: string;
    totalParticipants: number;
  };
  secondsRemaining: number;
  formattedCountdown: string;
  totalParticipants: number;
}

export interface LeaderboardResponse {
  activityId: string;
  totalParticipants: number;
  leaderboard: RowerData[];
}
