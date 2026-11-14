export interface RowerData {
  id: string;
  activityId: string;
  userId: string;
  userName?: string;
  isBot?: boolean;
  raceMode: 'race' | 'solo';
  targetDistance: number;
  status: 'waiting' | 'in_progress' | 'paused' | 'abandoned' | 'finished' | 'out_of_time';

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
  country?: string;
  finishedAt?: string;
  updatedAt?: string;
}

export interface PrivateRoomParticipant {
  userId: string;
  userName: string;
  joinedAt: string;
  lane?: number;
  ready?: boolean;
  connectionState?: 'CONNECTED' | 'READY';
}

export interface GuestTicketResponse {
  success: boolean;
  ticketPin: string;
  pinCode: string;
  guestName: string;
  guestUserId: string;
  lane: number;
  raceId: string;
  roomCode: string;
  targetDistance: number;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface NextRaceInfo {
  race: {
    id: string;
    code?: string;
    pinCode?: string;
    type?: 'PUBLIC_HOURLY' | 'PRIVATE_INVITE';
    title: string;
    targetDistance: number;
    startTime: string;
    intervalMinutes: number;
    maxDurationMinutes: number;
    maxParticipants?: number;
    hostUserId?: string;
    hostUserName?: string;
    startMode?: 'manual' | 'scheduled';
    scheduledStartTime?: string;
    botCount?: number;
    botMaxPace?: number;
    autoStart?: boolean;
    hasBots?: boolean;
    isBotDuel?: boolean;
    isDuel1v1?: boolean;
    isSolo?: boolean;
    gameMode?: 'solo' | 'bot_duel' | 'duel_1v1' | 'multi';
    waitingStatusMessage?: string;
    internalStatus?: string;
    status: string;
    totalParticipants: number;
    requireApproval?: boolean;
    participants?: PrivateRoomParticipant[];
    pendingParticipants?: PrivateRoomParticipant[];
    createdAt?: string;
  };
  code?: string;
  pinCode?: string;
  inviteUrl?: string;
  secondsRemaining: number;
  remainingSeconds?: number;
  maxDurationSeconds?: number;
  elapsedSeconds?: number;
  waitingForHost?: boolean;
  waitingStatusMessage?: string;
  formattedCountdown: string;
  totalParticipants: number;
  requireApproval?: boolean;
  pendingParticipants?: PrivateRoomParticipant[];
  status: string;
}

export interface CreatePrivateRaceRequest {
  title: string;
  targetDistance: number;
  maxParticipants: number;
  hostUserId: string;
  hostUserName?: string;
  countdownMinutes?: number;
  requireApproval?: boolean;
  startMode?: 'manual' | 'scheduled';
  scheduledStartTime?: string;
  botCount?: number;
  botMaxPace?: number;
  isBotDuel?: boolean;
  isDuel1v1?: boolean;
  isSolo?: boolean;
  gameMode?: string;
  mode?: string;
}

export interface PrivateRacePayload extends NextRaceInfo {
  success?: boolean;
  id?: string;
  raceId?: string;
  lane?: number;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
}

export interface SavedPrivateSalon {
  id: string;
  code: string;
  pinCode?: string;
  title: string;
  targetDistance: number;
  isHost: boolean;
  savedAt: string;
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
