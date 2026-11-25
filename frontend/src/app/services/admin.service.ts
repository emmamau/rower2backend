import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AdminPublicRaceSettings {
  id?: number;
  isEnabled: boolean;
  raceDistanceM: number;
  maxDurationSec: number;
  maxPlayers: number;
  botCount: number;
  interRaceDelaySec: number;
  overtakeThresholdM?: number;
  inactivityAbandonSec?: number;
}

export interface AdminUserItem {
  id: string;
  name: string;
  login?: string;
  email?: string;
  role: string;
  subscriptionTier: string;
  currentLeague?: string;
  leagueName?: string;
  isRevoked: boolean;
  totalRaces?: number;
  customConcurrentRooms?: number | null;
  customWeeklyRooms?: number | null;
  createdAt?: string;
}

export interface AdminUsersResponse {
  success: boolean;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  users: AdminUserItem[];
}

export interface AdminUserDetailsResponse {
  success: boolean;
  user: AdminUserItem & {
    firstName?: string;
    lastName?: string;
    birthYear?: number;
    gender?: string;
    country?: string;
    language?: string;
    subscriptionStatus?: string;
    watchUserId?: string;
    watchModel?: string;
    rowerModel?: string;
    isConfirmed?: boolean;
    totalWins?: number;
    podiums?: number;
    totalCareerPoints?: number;
    bestRank?: number;
    lastRank?: number;
    duelsWon?: number;
    duelsLost?: number;
    duelsDrawn?: number;
    duelPoints?: number;
    activitiesCount?: number;
    activeRoomsCount?: number;
    pairingInfo?: {
      deviceToken?: string;
      watchUserId?: string;
      model?: string;
      pairedAt?: string;
    } | null;
  };
}

export interface AdminActiveRoomParticipant {
  userId: string;
  userName: string;
  lane?: number;
  isBot: boolean;
  ready: boolean;
  connectionState?: string;
}

export interface AdminActiveRoomItem {
  id: string;
  code?: string;
  pin?: string;
  title?: string;
  status: string;
  hostUserId?: string;
  hostUserName?: string;
  targetDistance: number;
  maxParticipants: number;
  gameMode?: string;
  startMode?: string;
  scheduledStartTime?: string;
  participantsCount: number;
  humansCount: number;
  botsCount: number;
  participants: AdminActiveRoomParticipant[];
  createdAt?: string;
  startedAt?: string;
}

export interface AdminActiveRoomsResponse {
  success: boolean;
  total: number;
  rooms: AdminActiveRoomItem[];
}

export interface AdminSystemMetricsResponse {
  success: boolean;
  metrics: {
    uptimeSeconds: number;
    nodeVersion: string;
    dbStatus: string;
    memory: {
      heapUsedMb: number;
      heapTotalMb: number;
      rssMb: number;
    };
    sockets: {
      connectedSockets: number;
      onlineUsersCount: number;
      onlineUsers: string[];
    };
    rooms: {
      activePrivateRoomsCount: number;
      isPublicRaceEnabled: boolean;
      currentPublicRaceId: string | null;
      currentPublicRaceStatus: string;
    };
  };
}

export interface AdminStatsTimelineItem {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  newUsers: number;
  newSubscribers: number;
  publicRaces: number;
  privateRooms: number;
  duelsCompleted: number;
  participants: number;
  distanceMeters: number;
  distanceKm: number;
}

export interface AdminStatsGlobalKPIs {
  totalUsers: number;
  activeUsers: number;
  paidSubscribersCount: number;
  paidSubscribersRatio: number;
  subscribersBreakdown: {
    free: number;
    intermediate: number;
    premium: number;
  };
  totalRacesCount: number;
  publicRacesCount: number;
  privateRoomsCount: number;
  totalDuelsCompleted: number;
  totalDuelsTotal: number;
  totalParticipantsCount: number;
  totalDistanceMeters: number;
  totalDistanceKm: number;
}

export interface AdminStatsResponse {
  success: boolean;
  period: 'day' | 'week' | 'month';
  limit: number;
  global: AdminStatsGlobalKPIs;
  timeline: AdminStatsTimelineItem[];
}

export interface SubscriptionPlanItem {
  id?: number;
  code: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly: number;
  maxBotsPerRace: number;
  maxRaceDistanceM: number;
  maxPlayersPerRoom: number;
  maxConcurrentRooms: number;
  maxRoomsPerWeek: number;
  canCreateDuel1v1: boolean;
  canScheduleRaces: boolean;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private apiUrl: string;

  constructor(private http: HttpClient) {
    this.apiUrl = (environment.apiUrl || 'https://rower-api-service.onrender.com').trim().replace(/\/$/, '');
  }

  private getAuthHeaders(): HttpHeaders {
    let token = '';
    if (typeof localStorage !== 'undefined') {
      token = localStorage.getItem('rower_auth_token') || '';
    }
    return new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : ''
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Courses Publiques
  // ---------------------------------------------------------------------------

  getPublicRaceSettings(): Observable<{ success: boolean; settings: AdminPublicRaceSettings; liveStatus: any }> {
    return this.http.get<{ success: boolean; settings: AdminPublicRaceSettings; liveStatus: any }>(
      `${this.apiUrl}/api/admin/public-races/settings`,
      { headers: this.getAuthHeaders() }
    );
  }

  updatePublicRaceSettings(settings: Partial<AdminPublicRaceSettings>): Observable<{ success: boolean; message: string; settings: AdminPublicRaceSettings }> {
    return this.http.put<{ success: boolean; message: string; settings: AdminPublicRaceSettings }>(
      `${this.apiUrl}/api/admin/public-races/settings`,
      settings,
      { headers: this.getAuthHeaders() }
    );
  }

  togglePublicRaces(isEnabled: boolean): Observable<{ success: boolean; isEnabled: boolean; message: string }> {
    return this.http.post<{ success: boolean; isEnabled: boolean; message: string }>(
      `${this.apiUrl}/api/admin/public-races/toggle`,
      { is_enabled: isEnabled },
      { headers: this.getAuthHeaders() }
    );
  }

  abortAndResetPublicRace(): Observable<{ success: boolean; message: string; oldRaceId?: string; newRace?: any }> {
    return this.http.post<{ success: boolean; message: string; oldRaceId?: string; newRace?: any }>(
      `${this.apiUrl}/api/admin/public-races/abort-and-reset`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Gestion des Utilisateurs
  // ---------------------------------------------------------------------------

  getUsers(filters: { search?: string; role?: string; tier?: string; status?: string; page?: number; limit?: number }): Observable<AdminUsersResponse> {
    let params = new HttpParams();
    if (filters.search) params = params.set('search', filters.search.trim());
    if (filters.role) params = params.set('role', filters.role);
    if (filters.tier) params = params.set('tier', filters.tier);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());

    return this.http.get<AdminUsersResponse>(
      `${this.apiUrl}/api/admin/users`,
      { headers: this.getAuthHeaders(), params }
    );
  }

  purgeAnonymousUsers(includeWithRaces: boolean = false): Observable<{ success: boolean; message: string; purgedCount: number }> {
    return this.http.post<{ success: boolean; message: string; purgedCount: number }>(
      `${this.apiUrl}/api/admin/users/purge-anonymous`,
      { includeWithRaces },
      { headers: this.getAuthHeaders() }
    );
  }

  revokeUser(userId: string, isRevoked: boolean): Observable<{ success: boolean; message: string; user: AdminUserItem }> {
    return this.http.patch<{ success: boolean; message: string; user: AdminUserItem }>(
      `${this.apiUrl}/api/admin/users/${encodeURIComponent(userId)}/revoke`,
      { is_revoked: isRevoked },
      { headers: this.getAuthHeaders() }
    );
  }

  resetUserPassword(userId: string, newPassword: string): Observable<{ success: boolean; message: string }> {
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.apiUrl}/api/admin/users/${encodeURIComponent(userId)}/password`,
      { newPassword },
      { headers: this.getAuthHeaders() }
    );
  }

  updateUserRole(userId: string, role: 'ADMIN' | 'USER'): Observable<{ success: boolean; message: string; user: AdminUserItem }> {
    return this.http.patch<{ success: boolean; message: string; user: AdminUserItem }>(
      `${this.apiUrl}/api/admin/users/${encodeURIComponent(userId)}/role`,
      { role },
      { headers: this.getAuthHeaders() }
    );
  }

  updateUserPlan(userId: string, subscriptionTier: string): Observable<{ success: boolean; message: string; user: AdminUserItem }> {
    return this.http.patch<{ success: boolean; message: string; user: AdminUserItem }>(
      `${this.apiUrl}/api/admin/users/${encodeURIComponent(userId)}/plan`,
      { subscriptionTier },
      { headers: this.getAuthHeaders() }
    );
  }

  updateUserRoomQuotas(userId: string, quotas: { customConcurrentRooms: number | null; customWeeklyRooms: number | null }): Observable<{ success: boolean; message: string; user: AdminUserItem }> {
    return this.http.patch<{ success: boolean; message: string; user: AdminUserItem }>(
      `${this.apiUrl}/api/admin/users/${encodeURIComponent(userId)}/room-quotas`,
      quotas,
      { headers: this.getAuthHeaders() }
    );
  }

  getUserDetails(userId: string): Observable<AdminUserDetailsResponse> {
    return this.http.get<AdminUserDetailsResponse>(
      `${this.apiUrl}/api/admin/users/${encodeURIComponent(userId)}/details`,
      { headers: this.getAuthHeaders() }
    );
  }

  deleteUser(userId: string): Observable<{ success: boolean; message: string; deletedUserId: string }> {
    return this.http.delete<{ success: boolean; message: string; deletedUserId: string }>(
      `${this.apiUrl}/api/admin/users/${encodeURIComponent(userId)}`,
      { headers: this.getAuthHeaders() }
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Gestion des Salons
  // ---------------------------------------------------------------------------

  getActiveRooms(): Observable<AdminActiveRoomsResponse> {
    return this.http.get<AdminActiveRoomsResponse>(
      `${this.apiUrl}/api/admin/rooms/active`,
      { headers: this.getAuthHeaders() }
    );
  }

  terminateRoom(code: string): Observable<{ success: boolean; message: string; raceId: string }> {
    return this.http.post<{ success: boolean; message: string; raceId: string }>(
      `${this.apiUrl}/api/admin/rooms/${encodeURIComponent(code)}/terminate`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  purgeInactiveRooms(): Observable<{ success: boolean; message: string; purgedCount: number }> {
    return this.http.post<{ success: boolean; message: string; purgedCount: number }>(
      `${this.apiUrl}/api/admin/rooms/purge-inactive`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  getRoomsHistory(limit: number = 30): Observable<{ success: boolean; rooms: any[] }> {
    let params = new HttpParams().set('limit', limit.toString());
    return this.http.get<{ success: boolean; rooms: any[] }>(
      `${this.apiUrl}/api/admin/rooms/history`,
      { headers: this.getAuthHeaders(), params }
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Supervision Globale & Système
  // ---------------------------------------------------------------------------

  getSystemMetrics(): Observable<AdminSystemMetricsResponse> {
    return this.http.get<AdminSystemMetricsResponse>(
      `${this.apiUrl}/api/admin/system/metrics`,
      { headers: this.getAuthHeaders() }
    );
  }

  triggerLeagueCycle(): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/api/admin/system/trigger-league-cycle`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Offres & Quotas
  // ---------------------------------------------------------------------------

  getPlans(): Observable<{ success: boolean; plans: SubscriptionPlanItem[] }> {
    return this.http.get<{ success: boolean; plans: SubscriptionPlanItem[] }>(
      `${this.apiUrl}/api/admin/plans`,
      { headers: this.getAuthHeaders() }
    );
  }

  createPlan(plan: SubscriptionPlanItem): Observable<{ success: boolean; message: string; plan: SubscriptionPlanItem }> {
    return this.http.post<{ success: boolean; message: string; plan: SubscriptionPlanItem }>(
      `${this.apiUrl}/api/admin/plans`,
      plan,
      { headers: this.getAuthHeaders() }
    );
  }

  updatePlan(planId: number | string, plan: Partial<SubscriptionPlanItem>): Observable<{ success: boolean; message: string; plan: SubscriptionPlanItem }> {
    return this.http.put<{ success: boolean; message: string; plan: SubscriptionPlanItem }>(
      `${this.apiUrl}/api/admin/plans/${planId}`,
      plan,
      { headers: this.getAuthHeaders() }
    );
  }

  togglePlan(planId: number | string, isActive?: boolean): Observable<{ success: boolean; message: string; plan: SubscriptionPlanItem }> {
    return this.http.patch<{ success: boolean; message: string; plan: SubscriptionPlanItem }>(
      `${this.apiUrl}/api/admin/plans/${planId}/toggle`,
      { isActive },
      { headers: this.getAuthHeaders() }
    );
  }

  deletePlan(planId: number | string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.apiUrl}/api/admin/plans/${planId}`,
      { headers: this.getAuthHeaders() }
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Statistiques & Analyse Plateforme
  // ---------------------------------------------------------------------------

  getPlatformStats(period: 'day' | 'week' | 'month' = 'day', limit?: number): Observable<AdminStatsResponse> {
    let params = `?period=${period}`;
    if (limit) {
      params += `&limit=${limit}`;
    }
    return this.http.get<AdminStatsResponse>(
      `${this.apiUrl}/api/admin/stats${params}`,
      { headers: this.getAuthHeaders() }
    );
  }

  // ---------------------------------------------------------------------------
  // 7. Gestion de l'Anti-Triche & Mode Tests de Charge
  // ---------------------------------------------------------------------------

  getAntiCheatStatus(): Observable<AntiCheatStatusResponse> {
    return this.http.get<AntiCheatStatusResponse>(
      `${this.apiUrl}/api/admin/anti-cheat/status`,
      { headers: this.getAuthHeaders() }
    );
  }

  openLoadTest(durationMinutes: number = 120, customKey?: string): Observable<AntiCheatStatusResponse> {
    return this.http.post<AntiCheatStatusResponse>(
      `${this.apiUrl}/api/admin/anti-cheat/open-load-test`,
      { durationMinutes, customKey },
      { headers: this.getAuthHeaders() }
    );
  }

  closeLoadTest(): Observable<AntiCheatStatusResponse> {
    return this.http.post<AntiCheatStatusResponse>(
      `${this.apiUrl}/api/admin/anti-cheat/close-load-test`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  toggleAntiCheat(enabled: boolean): Observable<AntiCheatStatusResponse> {
    return this.http.post<AntiCheatStatusResponse>(
      `${this.apiUrl}/api/admin/anti-cheat/toggle`,
      { enabled },
      { headers: this.getAuthHeaders() }
    );
  }

  resetAntiCheatStats(): Observable<AntiCheatStatusResponse> {
    return this.http.post<AntiCheatStatusResponse>(
      `${this.apiUrl}/api/admin/anti-cheat/reset-stats`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }
}

export interface BlockedAttemptLog {
  timestamp: string;
  ip: string;
  path: string;
  deviceId?: string;
  reason: string;
}

export interface AntiCheatStatusResponse {
  success: boolean;
  message?: string;
  antiCheatEnabled: boolean;
  loadTestModeEnabled: boolean;
  loadTestExpiresAt: string | null;
  loadTestRemainingMinutes: number;
  loadTestKey: string | null;
  blockedAttemptsCount: number;
  recentBlocked: BlockedAttemptLog[];
}
