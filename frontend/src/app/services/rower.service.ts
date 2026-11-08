import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  RowerData,
  NextRaceInfo,
  LeaderboardResponse,
  PastRaceResult,
  CreatePrivateRaceRequest,
  PrivateRacePayload
} from '../models/rower-data.model';
import {
  UserProfileResponse,
  GeneralLeaderboardResponse,
  RegisterUserDto,
  LoginDto,
  AuthResponse
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

  toggleBots(enable: boolean, raceId?: string, userId?: string, botCount: number = 3): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/race/bots`, { enable, raceId, userId, botCount });
  }

  // Salons Privés : Création, consultation, codes PIN / Web et contrôle hôte
  createPrivateRace(payload: CreatePrivateRaceRequest): Observable<PrivateRacePayload> {
    return this.http.post<PrivateRacePayload>(`${this.apiUrl}/api/v1/races/private`, payload);
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
    options: { hostUserId: string; countdownSeconds?: number; reset?: boolean; targetDistance?: number }
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

  // --- NOUVEAU PROTOCOLE D'APPAIRAGE GARMIN <-> WEB ---
  requestGarminPairingCode(userId: string): Observable<{ success: boolean; pairingCode: string; expiresAt: string; expiresInSeconds: number; userId: string }> {
    return this.http.post<{ success: boolean; pairingCode: string; expiresAt: string; expiresInSeconds: number; userId: string }>(
      `${this.apiUrl}/api/garmin/pairing-code`,
      { userId }
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

  // Abonnements Lemon Squeezy (3 offres)
  getSubscriptionTiers(): Observable<{ success: boolean; tiers: any[] }> {
    return this.http.get<{ success: boolean; tiers: any[] }>(`${this.apiUrl}/api/v1/subscriptions/tiers`);
  }

  getUserSubscriptionStatus(userId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/api/v1/subscriptions/status/${encodeURIComponent(userId)}`);
  }

  createSubscriptionCheckout(userId: string, tier: string, returnUrl?: string): Observable<{ success: boolean; checkoutUrl?: string; mode?: string; message?: string }> {
    return this.http.post<{ success: boolean; checkoutUrl?: string; mode?: string; message?: string }>(
      `${this.apiUrl}/api/v1/subscriptions/checkout`,
      { userId, tier, returnUrl }
    );
  }

  // Espace statistiques & Analyses de courses (abonnés = illimité, comptes gratuits = 10 jours)
  getUserStatistics(userId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/api/user/statistics/${encodeURIComponent(userId.trim())}`);
  }

  // Résiliation abonnement (repasse en offre gratuite)
  unsubscribeUser(userId: string): Observable<{ success: boolean; message: string; user?: any }> {
    return this.http.post<{ success: boolean; message: string; user?: any }>(`${this.apiUrl}/api/user/unsubscribe`, {
      userId: userId.trim()
    });
  }

  // Suppression définitive de compte RGPD Art. 17
  deleteUserAccount(userId: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/api/user/account/${encodeURIComponent(userId.trim())}`);
  }

  // Configuration admin course publique
  getPublicRaceAdminConfig(): Observable<{ success: boolean; config: any }> {
    return this.http.get<{ success: boolean; config: any }>(`${this.apiUrl}/api/race/admin/config`);
  }

  updatePublicRaceAdminConfig(config: any): Observable<{ success: boolean; message: string; config: any }> {
    return this.http.put<{ success: boolean; message: string; config: any }>(`${this.apiUrl}/api/race/admin/config`, config);
  }

  checkHealth(): Observable<{ status: string; database: string }> {
    return this.http.get<{ status: string; database: string }>(`${this.apiUrl}/health`);
  }
}
