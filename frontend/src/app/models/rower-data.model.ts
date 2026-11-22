import { KayakCustomization, DuelChallenge } from './user.model';

export interface RowerData {
  id: string;
  activityId: string;
  userId: string;
  userName?: string;
  isBot?: boolean;
  isPaired?: boolean;
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
  kayak?: KayakCustomization;
}

export interface PrivateRoomParticipant {
  userId: string;
  userName: string;
  joinedAt: string;
  lane?: number;
  ready?: boolean;
  connectionState?: 'CONNECTED' | 'READY';
  isBot?: boolean;
  isPaired?: boolean;
  kayak?: KayakCustomization;
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
    scheduledStartTimeEpoch?: number;
    timezone?: string;
    botCount?: number;
    botMinPace?: number;
    botMaxPace?: number;
    botStartMode?: 'countdown' | 'first_stroke';
    autoStart?: boolean;
    hasBots?: boolean;
    isBotDuel?: boolean;
    isDuel1v1?: boolean;
    duelChallenge?: DuelChallenge;
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
  duelChallenge?: DuelChallenge;
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
  startMode?: 'manual' | 'scheduled';
  scheduledStartTime?: string;
  scheduledStartTimeEpoch?: number;
  timezone?: string;
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
  timezone?: string;
  botCount?: number;
  botMinPace?: number;
  botMaxPace?: number;
  botStartMode?: 'first_stroke' | 'countdown';
  isBotDuel?: boolean;
  isDuel1v1?: boolean;
  isSolo?: boolean;
  gameMode?: string;
  mode?: string;
}

export interface RoomInviteRequest {
  hostUserId: string;
  emails: string[];
  includeCalendarInvite?: boolean;
  lang?: string;
}

export interface RoomInviteResponse {
  success: boolean;
  count: number;
  recipients: string[];
  maxAllowed?: number;
  hasCalendarInvite?: boolean;
  error?: string;
  code?: string;
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
  startMode?: 'manual' | 'scheduled';
  scheduledStartTime?: string;
}

export interface LeaderboardResponse {
  activityId: string;
  totalParticipants: number;
  leaderboard: RowerData[];
}

export interface RoomCreationQuotaInfo {
  success: boolean;
  isWatchConnected: boolean;
  isUserAdmin: boolean;
  tier: string;
  tierName?: string;
  maxBots?: number;
  maxParticipants?: number;
  maxDistance?: number;
  canCreateDuel1v1?: boolean;
  concurrent: {
    current: number;
    max: number;
    remaining: number;
  };
  weekly: {
    current: number;
    max: number;
    remaining: number;
  };
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
