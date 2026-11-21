import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  RowerData,
  NextRaceInfo,
  LeaderboardResponse,
  PastRaceResult,
  CreatePrivateRaceRequest,
  PrivateRacePayload,
  RoomCreationQuotaInfo,
  RoomInviteRequest,
  RoomInviteResponse
} from '../models/rower-data.model';
import {
  UserProfileResponse,
  GeneralLeaderboardResponse,
  RegisterUserDto,
  LoginDto,
  AuthResponse,
  KayakCustomization,
  RegattaPreferences,
  UserProfile,
  LeagueTier,
  LeagueStandingsResponse,
  UnseenSummaryResponse,
  DuelPreferences,
  DuelChallenge,
  MyDuelChallengesResponse,
  AvailableDuelPlayer,
  DuelLeaderboardItem
} from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class RowerService {
  private apiUrl: string;

  constructor(private http: HttpClient) {
    const savedUrl = localStorage.getItem('rower_backend_url');
    if (savedUrl && savedUrl.trim().length > 0) {
      this.apiUrl = savedUrl.trim().replace(/\/$/, '');
    } else {
      this.apiUrl = (environment.apiUrl || 'https://rower-api-service.onrender.com').trim().replace(/\/$/, '');
    }

    if (this.apiUrl === 'https://rower-api-service' || this.apiUrl === 'http://rower-api-service' || this.apiUrl === 'rower-api-service') {
      this.apiUrl = 'https://rower-api-service.onrender.com';
      localStorage.setItem('rower_backend_url', this.apiUrl);
    }
  }

  getApiUrl(): string {
    return this.apiUrl;
  }

  setApiUrl(url: string): void {
    let clean = url.trim().replace(/\/$/, '');
    if (clean && !clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }
    this.apiUrl = clean;
    if (clean) {
      localStorage.setItem('rower_backend_url', clean);
    } else {
      localStorage.removeItem('rower_backend_url');
    }
  }

  getNextRace(): Observable<NextRaceInfo> {
    return this.http.get<NextRaceInfo>(`${this.apiUrl}/api/race/next`);
  }

  updateRaceConfig(targetDistance: number, intervalMinutes: number, adminUserId?: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/api/race/config`, { targetDistance, intervalMinutes, adminUserId });
  }

  stopRace(raceId: string, userId: string): Observable<{ success: boolean; message: string; ranking: any[] }> {
    return this.http.post<{ success: boolean; message: string; ranking: any[] }>(`${this.apiUrl}/api/race/stop`, {
      raceId,
      userId
    });
  }

  toggleBots(enable: boolean, raceId?: string, userId?: string, botCount: number = 3, botMinPace?: number, botMaxPace?: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/race/bots`, { enable, raceId, userId, botCount, botMinPace, botMaxPace });
  }

  // Salons Privés : Création, consultation, codes PIN / Web et contrôle hôte
  getRoomCreationLimits(hostUserId?: string, deviceToken?: string): Observable<RoomCreationQuotaInfo> {
    let params = new HttpParams();
    if (hostUserId && hostUserId.trim()) {
      params = params.set('hostUserId', hostUserId.trim());
    }
    if (deviceToken && deviceToken.trim()) {
      params = params.set('deviceToken', deviceToken.trim());
    }
    return this.http.get<RoomCreationQuotaInfo>(`${this.apiUrl}/api/v1/races/private/limits`, { params });
  }

  createPrivateRace(payload: CreatePrivateRaceRequest): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(`${this.apiUrl}/api/v1/races/private`, payload);
  }

  sendRoomInvitations(
    identifier: string,
    hostUserId: string,
    emails: string[],
    includeCalendarInvite: boolean = true,
    lang?: string
  ): Observable<RoomInviteResponse> {
    const payload: RoomInviteRequest = {
      hostUserId,
      emails,
      includeCalendarInvite,
      lang
    };
    return this.http.post<RoomInviteResponse>(
      `${this.apiUrl}/api/rooms/${encodeURIComponent(identifier)}/invite`,
      payload
    );
  }

  joinRoom(code: string, userId?: string, userName?: string, deviceToken?: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/api/rooms/join`, {
      code,
      userId,
      userName,
      deviceToken
    });
  }

  leaveRoom(codeOrId: string, userId: string): Observable<{ success: boolean; roomClosed?: boolean; remainingParticipants?: number }> {
    return this.http.post<{ success: boolean; roomClosed?: boolean; remainingParticipants?: number }>(
      `${this.apiUrl}/api/rooms/leave`,
      { code: codeOrId, userId }
    );
  }

  getPrivateRace(identifier: string): Observable<PrivateRacePayload> {
    return this.http.get<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}`
    );
  }

  getRaceByPin(pin: string): Observable<PrivateRacePayload> {
    return this.http.get<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/pin/${encodeURIComponent(pin.trim())}`
    );
  }

  listPrivateRaces(hostUserId?: string, codes?: string[]): Observable<{ success: boolean; races: PrivateRacePayload[] }> {
    let params = new HttpParams();
    if (hostUserId && hostUserId.trim()) {
      params = params.set('hostUserId', hostUserId.trim());
    }
    if (codes && codes.length > 0) {
      params = params.set('codes', codes.join(','));
    }
    return this.http.get<{ success: boolean; races: PrivateRacePayload[] }>(
      `${this.apiUrl}/api/v1/races/private`,
      { params }
    );
  }

  joinPrivateRace(
    identifier: string,
    userId: string,
    userName?: string,
    registerLane: boolean = false
  ): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}/join`,
      { userId, userName, registerLane }
    );
  }

  startOrResetPrivateRace(
    identifier: string,
    options: { hostUserId: string; countdownSeconds?: number; reset?: boolean; targetDistance?: number; botStartMode?: 'countdown' | 'first_stroke' }
  ): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}/start`,
      options
    );
  }

  regeneratePrivatePin(identifier: string, hostUserId: string): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}/regenerate-pin`,
      { hostUserId }
    );
  }

  regeneratePrivateCode(identifier: string, hostUserId: string): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}/regenerate-code`,
      { hostUserId }
    );
  }

  closePrivateRace(identifier: string, hostUserId: string): Observable<{ success: boolean; raceId: string }> {
    const params = new HttpParams().set('hostUserId', hostUserId);
    return this.http.delete<{ success: boolean; raceId: string }>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}`,
      { params }
    );
  }

  toggleApprovalRequirement(
    identifier: string,
    hostUserId: string,
    requireApproval: boolean
  ): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}/toggle-approval`,
      { hostUserId, requireApproval }
    );
  }

  approveParticipant(
    identifier: string,
    hostUserId: string,
    targetUserId: string,
    approve: boolean
  ): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}/approve-participant`,
      { hostUserId, targetUserId, approve }
    );
  }

  getParticipantStatus(
    identifier: string,
    userId: string
  ): Observable<{
    raceId: string;
    status: 'approved' | 'pending' | 'rejected' | 'unknown';
    requireApproval: boolean;
    targetDistance?: number;
    title?: string;
  }> {
    const params = new HttpParams().set('userId', userId.trim());
    return this.http.get<{
      raceId: string;
      status: 'approved' | 'pending' | 'rejected' | 'unknown';
      requireApproval: boolean;
      targetDistance?: number;
      title?: string;
    }>(
      `${this.apiUrl}/api/v1/races/private/${encodeURIComponent(identifier.trim())}/participant-status`,
      { params }
    );
  }

  getActivityLeaderboard(raceId: string): Observable<LeaderboardResponse> {
    return this.http.get<LeaderboardResponse>(`${this.apiUrl}/api/activity/race/${encodeURIComponent(raceId)}/leaderboard`);
  }

  getRaceHistory(): Observable<PastRaceResult[]> {
    return this.http.get<PastRaceResult[]>(`${this.apiUrl}/api/race/history`);
  }

  getUserLatestActivity(userId: string): Observable<RowerData> {
    return this.http.get<RowerData>(`${this.apiUrl}/api/activity/latest?userId=${encodeURIComponent(userId)}`);
  }

  getUserProfile(userId: string): Observable<UserProfileResponse> {
    return this.http.get<UserProfileResponse>(`${this.apiUrl}/api/user/profile/${encodeURIComponent(userId)}`);
  }

  getGeneralLeaderboard(filters?: { country?: string; gender?: string; ageCategory?: string }): Observable<GeneralLeaderboardResponse> {
    let params = new HttpParams();
    if (filters?.country && filters.country !== 'all') params = params.set('country', filters.country);
    if (filters?.gender && filters.gender !== 'all') params = params.set('gender', filters.gender);
    if (filters?.ageCategory && filters.ageCategory !== 'all') params = params.set('ageCategory', filters.ageCategory);
    return this.http.get<GeneralLeaderboardResponse>(`${this.apiUrl}/api/user/leaderboard`, { params });
  }

  // --- CODE UNIQUE UNIVERSEL À 5 CARACTÈRES (POST /api/session/code) ---
  requestSessionCode(payload: {
    type?: 'account_link' | 'room_join' | 'guest_cockpit';
    userId?: string;
    roomId?: string;
    playerName?: string;
    socketId?: string;
    assignedLane?: number;
  }): Observable<{
    success: boolean;
    code: string;
    type: string;
    userId?: string;
    roomId?: string;
    playerName: string;
    assignedLane: number;
    guestPairingToken?: string;
    expiresAt: string;
    expiresInSeconds: number;
  }> {
    return this.http.post<any>(`${this.apiUrl}/api/session/code`, payload);
  }

  // --- NOUVEAU PROTOCOLE D'APPAIRAGE GARMIN <-> WEB ---
  requestGarminPairingCode(userId: string): Observable<{ success: boolean; pairingCode: string; expiresAt: string; expiresInSeconds: number; userId: string }> {
    return this.http.post<any>(`${this.apiUrl}/api/session/code`, {
      type: 'account_link',
      userId,
    }).pipe(
      // Mappage transparent pour renvoyer le code 5 car. dans pairingCode
      // pour compatibilité descendante avec l'affichage
      map((res: any) => ({
        success: res.success,
        pairingCode: res.code,
        expiresAt: res.expiresAt,
        expiresInSeconds: res.expiresInSeconds || 600,
        userId: res.userId || userId,
      }))
    );
  }

  // Parcours 2 : Ticket Invité de Salon (Code à 5 caractères atomique)
  createGuestTicket(
    roomId: string,
    guestName: string,
    socketId?: string,
    userId?: string
  ): Observable<{
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
  }> {
    return this.http.post<any>(
      `${this.apiUrl}/api/rooms/${encodeURIComponent(roomId.trim())}/guest-ticket`,
      { guestName, socketId, userId }
    );
  }

  claimGarminTicket(
    ticketPin: string,
    deviceId: string,
    userName?: string
  ): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/api/garmin/claim-ticket`, {
      ticketPin,
      deviceId,
      userName
    });
  }

  // Machine à États BLE : Statut READY du rameur en salon
  updateRoomReadyStatus(
    roomId: string,
    ready: boolean,
    userId?: string,
    deviceToken?: string
  ): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/api/rooms/${encodeURIComponent(roomId.trim())}/status`,
      { ready, userId, deviceToken }
    );
  }

  getGarminPairingStatus(filter: { userId?: string; pairingCode?: string; deviceToken?: string }): Observable<{ success: boolean; paired: boolean; status: string; deviceToken?: string; userId?: string; deviceId?: string }> {
    let params = new HttpParams();
    if (filter.userId) params = params.set('userId', filter.userId);
    if (filter.pairingCode) params = params.set('pairingCode', filter.pairingCode);
    if (filter.deviceToken) params = params.set('deviceToken', filter.deviceToken);
    return this.http.get<{ success: boolean; paired: boolean; status: string; deviceToken?: string; userId?: string; deviceId?: string }>(
      `${this.apiUrl}/api/garmin/pairing-status`,
      { params }
    );
  }

  resetGarminPairing(deviceToken?: string, userId?: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/api/garmin/reset`,
      { deviceToken, userId }
    );
  }

  // Inscription abonné
  registerUser(data: RegisterUserDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/api/user/register`, data);
  }

  // Connexion abonné avec mot de passe
  loginUser(credentials: LoginDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/api/user/login`, credentials);
  }

  // Procédure mot de passe oublié
  forgotPassword(emailOrLogin: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/api/user/forgot-password`, { emailOrLogin });
  }

  // Réinitialisation mot de passe avec jeton
  resetPassword(token: string, newPassword: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/api/user/reset-password`, { token, newPassword });
  }

  // Consultation du classement complet et détaillé d'une régate passée
  getRaceLeaderboard(raceId: string): Observable<{ success: boolean; race: any; leaderboard: any[] }> {
    return this.http.get<{ success: boolean; race: any; leaderboard: any[] }>(
      `${this.apiUrl}/api/races/${encodeURIComponent(raceId)}/leaderboard`
    );
  }

  // Consultation fiche compte
  getUserAccount(identifier: string): Observable<{ success: boolean; account: any }> {
    return this.http.get<{ success: boolean; account: any }>(`${this.apiUrl}/api/user/account/${encodeURIComponent(identifier)}`);
  }

  // Abonnements (3 offres)
  getSubscriptionTiers(): Observable<{ success: boolean; tiers: any[] }> {
    return this.http.get<{ success: boolean; tiers: any[] }>(`${this.apiUrl}/api/v1/subscriptions/tiers`);
  }

  getUserSubscriptionStatus(userId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/api/v1/subscriptions/status/${encodeURIComponent(userId)}`);
  }

  createSubscriptionCheckout(
    userId: string,
    tier: string,
    returnUrl?: string,
    cancelUrl?: string
  ): Observable<{ success: boolean; checkoutUrl?: string; mode?: string; message?: string }> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const cleanTier = String(tier || 'intermediate').toLowerCase().trim();
    const resolvedReturnUrl =
      returnUrl || (origin ? `${origin}/?subscription=success&tier=${encodeURIComponent(cleanTier)}&session_id={CHECKOUT_SESSION_ID}` : undefined);
    const resolvedCancelUrl =
      cancelUrl || (origin ? `${origin}/?subscription=canceled` : undefined);

    return this.http.post<{ success: boolean; checkoutUrl?: string; mode?: string; message?: string }>(
      `${this.apiUrl}/api/v1/subscriptions/checkout`,
      { userId, tier: cleanTier, returnUrl: resolvedReturnUrl, cancelUrl: resolvedCancelUrl }
    );
  }

  // Espace statistiques & Analyses de courses (abonnés = illimité, comptes gratuits = 10 jours)
  getUserStatistics(userId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/api/user/statistics/${encodeURIComponent(userId.trim())}`);
  }

  private getAuthHeaders(): HttpHeaders {
    let headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('rower_auth_token');
      if (token) {
        headers = headers.set('Authorization', `Bearer ${token}`);
      }
    }
    return headers;
  }

  // Résiliation abonnement (repasse en offre gratuite)
  unsubscribeUser(userId: string): Observable<{ success: boolean; message: string; user?: any }> {
    return this.http.post<{ success: boolean; message: string; user?: any }>(
      `${this.apiUrl}/api/user/unsubscribe`,
      { userId: userId.trim() },
      { headers: this.getAuthHeaders() }
    );
  }

  // Suppression définitive de compte RGPD Art. 17
  deleteUserAccount(userId: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.apiUrl}/api/user/account/${encodeURIComponent(userId.trim())}`,
      { headers: this.getAuthHeaders() }
    );
  }

  // Configuration admin course publique
  getPublicRaceAdminConfig(): Observable<{ success: boolean; config: any }> {
    return this.http.get<{ success: boolean; config: any }>(`${this.apiUrl}/api/race/admin/config`);
  }

  updatePublicRaceAdminConfig(config: any): Observable<{ success: boolean; message: string; config: any }> {
    return this.http.put<{ success: boolean; message: string; config: any }>(`${this.apiUrl}/api/race/admin/config`, config);
  }

  // Mise à jour de la personnalisation du kayak 2D
  updateKayakCustomization(userId: string, kayakCustomization: KayakCustomization): Observable<{ success: boolean; message: string; user: UserProfile }> {
    return this.http.put<{ success: boolean; message: string; user: UserProfile }>(
      `${this.apiUrl}/api/user/kayak`,
      { userId, kayakCustomization },
      { headers: this.getAuthHeaders() }
    );
  }

  // Mise à jour des préférences d'affichage en mode régate (zoom & données sous le canevas)
  updateRegattaPreferences(userId: string, regattaPreferences: RegattaPreferences): Observable<{ success: boolean; message: string; user: UserProfile }> {
    return this.http.put<{ success: boolean; message: string; user: UserProfile }>(
      `${this.apiUrl}/api/user/regatta-preferences`,
      { userId, regattaPreferences },
      { headers: this.getAuthHeaders() }
    );
  }

  // Mise à jour de la langue préférée de l'utilisateur
  updateUserLanguage(language: string): Observable<{ success: boolean; message: string; language?: string }> {
    return this.http.put<{ success: boolean; message: string; language?: string }>(
      `${this.apiUrl}/api/user/language`,
      { language },
      { headers: this.getAuthHeaders() }
    );
  }

  // Système de Ligues Hebdomadaires & Mode Repos
  getLeagueStandings(tier: LeagueTier = 'BRONZE'): Observable<LeagueStandingsResponse> {
    return this.http.get<LeagueStandingsResponse>(`${this.apiUrl}/api/leagues/standings`, {
      params: { tier }
    });
  }

  toggleRestingMode(userId: string, isResting: boolean): Observable<{ success: boolean; message: string; isResting: boolean }> {
    return this.http.patch<{ success: boolean; message: string; isResting: boolean }>(`${this.apiUrl}/api/users/resting-mode`, {
      userId,
      isResting
    });
  }

  getUnseenLeagueSummary(userId: string): Observable<UnseenSummaryResponse> {
    return this.http.get<UnseenSummaryResponse>(`${this.apiUrl}/api/leagues/unseen-summary`, {
      params: { userId }
    });
  }

  markLeagueSummarySeen(historyId: number): Observable<{ success: boolean; message: string }> {
    return this.http.patch<{ success: boolean; message: string }>(`${this.apiUrl}/api/leagues/history/${historyId}/seen`, {});
  }

  // --- Duels 1v1 & Disponibilités ---

  getDuelPreferences(userId: string): Observable<{
    success: boolean;
    duelPreferences: DuelPreferences;
    stats: { duelsWon: number; duelsLost: number; duelsDrawn: number; duelPoints: number };
  }> {
    return this.http.get<{
      success: boolean;
      duelPreferences: DuelPreferences;
      stats: { duelsWon: number; duelsLost: number; duelsDrawn: number; duelPoints: number };
    }>(`${this.apiUrl}/api/duels/preferences/${encodeURIComponent(userId)}`);
  }

  updateDuelPreferences(userId: string, duelPreferences: DuelPreferences): Observable<{
    success: boolean;
    message?: string;
    duelPreferences: DuelPreferences;
    user?: UserProfile;
  }> {
    return this.http.put<{
      success: boolean;
      message?: string;
      duelPreferences: DuelPreferences;
      user?: UserProfile;
    }>(`${this.apiUrl}/api/duels/preferences`, { userId, duelPreferences });
  }

  getAvailableDuelPlayers(filters: {
    slotStart: string;
    slotEnd?: string;
    durationMinutes?: number;
    requesterId?: string;
    league?: string;
    country?: string;
    gender?: string;
    category?: string;
  }): Observable<{ success: boolean; count: number; players: AvailableDuelPlayer[] }> {
    let params = new HttpParams().set('slotStart', filters.slotStart);
    if (filters.slotEnd) params = params.set('slotEnd', filters.slotEnd);
    if (filters.durationMinutes) params = params.set('durationMinutes', String(filters.durationMinutes));
    if (filters.requesterId) params = params.set('userId', filters.requesterId);
    if (filters.league && filters.league !== 'all') params = params.set('league', filters.league);
    if (filters.country && filters.country !== 'all') params = params.set('country', filters.country);
    if (filters.gender && filters.gender !== 'all') params = params.set('gender', filters.gender);
    if (filters.category && filters.category !== 'all') params = params.set('category', filters.category);
    return this.http.get<{ success: boolean; count: number; players: AvailableDuelPlayer[] }>(
      `${this.apiUrl}/api/duels/available-players`,
      { params }
    );
  }

  createDuelChallenge(payload: {
    challengerId: string;
    challengedLogin: string;
    slotStart: string;
    slotEnd?: string;
    durationMinutes?: number;
    targetDistance?: number;
    timezone?: string;
    title?: string;
  }): Observable<{ success: boolean; message: string; challenge: DuelChallenge }> {
    return this.http.post<{ success: boolean; message: string; challenge: DuelChallenge }>(
      `${this.apiUrl}/api/duels/challenge`,
      payload
    );
  }

  getMyDuelChallenges(userId: string): Observable<MyDuelChallengesResponse> {
    return this.http.get<MyDuelChallengesResponse>(`${this.apiUrl}/api/duels/my-challenges`, {
      params: { userId }
    });
  }

  respondToDuelChallenge(
    challengeId: string,
    userId: string,
    action: 'accept' | 'refuse'
  ): Observable<{ success: boolean; message: string; challenge: DuelChallenge }> {
    return this.http.post<{ success: boolean; message: string; challenge: DuelChallenge }>(
      `${this.apiUrl}/api/duels/${encodeURIComponent(challengeId)}/respond`,
      { userId, action }
    );
  }

  cancelDuelChallenge(
    challengeId: string,
    userId: string
  ): Observable<{ success: boolean; isForfeit: boolean; message: string; challenge: DuelChallenge }> {
    return this.http.post<{ success: boolean; isForfeit: boolean; message: string; challenge: DuelChallenge }>(
      `${this.apiUrl}/api/duels/${encodeURIComponent(challengeId)}/cancel`,
      { userId }
    );
  }

  resolveDuelChallenge(
    challengeId: string,
    payload: { winnerUserId?: string; isDraw?: boolean; forfeitUserId?: string }
  ): Observable<{ success: boolean; message: string; challenge: DuelChallenge }> {
    return this.http.post<{ success: boolean; message: string; challenge: DuelChallenge }>(
      `${this.apiUrl}/api/duels/${encodeURIComponent(challengeId)}/resolve`,
      payload
    );
  }

  getDuelLeaderboard(filters?: {
    category?: string;
    league?: string;
    country?: string;
    gender?: string;
    age?: string | number;
    includeAll?: boolean;
  }): Observable<{ success: boolean; count: number; players: DuelLeaderboardItem[] }> {
    let params = new HttpParams();
    if (filters?.category && filters.category !== 'all') params = params.set('category', filters.category);
    if (filters?.league && filters.league !== 'all') params = params.set('league', filters.league);
    if (filters?.country && filters.country !== 'all') params = params.set('country', filters.country);
    if (filters?.gender && filters.gender !== 'all') params = params.set('gender', filters.gender);
    if (filters?.age !== undefined && filters.age !== '' && filters.age !== 'all') {
      params = params.set('age', String(filters.age));
    }
    if (filters?.includeAll) params = params.set('includeAll', 'true');
    return this.http.get<{ success: boolean; count: number; players: DuelLeaderboardItem[] }>(
      `${this.apiUrl}/api/duels/leaderboard`,
      { params }
    );
  }

  checkHealth(): Observable<{ status: string; database: string }> {
    return this.http.get<{ status: string; database: string }>(`${this.apiUrl}/health`);
  }
}
