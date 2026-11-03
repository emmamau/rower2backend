import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { RowerData, NextRaceInfo, LeaderboardResponse, PastRaceResult } from '../models/rower-data.model';
import { UserProfileResponse, GeneralLeaderboardResponse } from '../models/user.model';

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

  toggleBots(enable: boolean, raceId?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/race/bots`, { enable, raceId });
  }

  getRaceLeaderboard(raceId: string): Observable<LeaderboardResponse> {
    return this.http.get<LeaderboardResponse>(`${this.apiUrl}/api/activity/race/${raceId}/leaderboard`);
  }

  getRaceHistory(): Observable<PastRaceResult[]> {
    return this.http.get<PastRaceResult[]>(`${this.apiUrl}/api/race/history`);
  }

  getUserLatestActivity(userId: string): Observable<RowerData> {
    return this.http.get<RowerData>(`${this.apiUrl}/api/activity/latest?userId=${userId}`);
  }

  getUserProfile(userId: string): Observable<UserProfileResponse> {
    return this.http.get<UserProfileResponse>(`${this.apiUrl}/api/user/profile/${userId}`);
  }

  getGeneralLeaderboard(): Observable<GeneralLeaderboardResponse> {
    return this.http.get<GeneralLeaderboardResponse>(`${this.apiUrl}/api/user/leaderboard`);
  }

  // Demande d'authentification envoyée à la montre Garmin
  requestWebLogin(userId: string, login: string): Observable<{ success: boolean; requestId?: string; message: string; error?: string }> {
    return this.http.post<{ success: boolean; requestId?: string; message: string; error?: string }>(`${this.apiUrl}/api/user/auth/request`, {
      userId,
      login
    });
  }

  // Vérification de la réponse d'acceptation de la montre
  checkWebLoginStatus(requestId: string): Observable<{ success: boolean; status: 'pending' | 'approved' | 'rejected' | 'expired'; userId: string; login: string }> {
    return this.http.get<{ success: boolean; status: 'pending' | 'approved' | 'rejected' | 'expired'; userId: string; login: string }>(`${this.apiUrl}/api/user/auth/status/${requestId}`);
  }

  checkHealth(): Observable<{ status: string; database: string }> {
    return this.http.get<{ status: string; database: string }>(`${this.apiUrl}/health`);
  }
}
