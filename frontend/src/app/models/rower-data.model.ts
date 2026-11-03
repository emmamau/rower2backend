export interface RowerData {
  id: string;
  activityId: string;
  userId: string;
  userName?: string;
  raceMode: 'race' | 'solo';
  targetDistance: number;
  status: 'waiting' | 'in_progress' | 'paused' | 'abandoned' | 'finished';

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
    maxDurationMinutes: number;
    status: string;
    totalParticipants: number;
  };
  secondsRemaining: number;
  formattedCountdown: string;
  totalParticipants: number;
  status: string;
}

export interface LeaderboardResponse {
  activityId: string;
  totalParticipants: number;
  leaderboard: RowerData[];
}

export interface PastRaceResult {
  race: {
    id: string;
    title: string;
    targetDistance: number;
    startTime: string;
    status: string;
    totalParticipants: number;
  };
  podium: Array<{
    userId: string;
    userName: string;
    netDistance: number;
    elapsedTime: number;
    avgSpeedKmh: number;
    status: string;
    finalRank?: number;
  }>;
}
