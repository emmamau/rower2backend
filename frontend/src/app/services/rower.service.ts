import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { RowerData, NextRaceInfo, LeaderboardResponse } from '../models/rower-data.model';
import { UserProfile } from '../models/user.model';

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

  updateRaceConfig(targetDistance: number, intervalMinutes: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/api/race/config`, { targetDistance, intervalMinutes });
  }

  getRaceLeaderboard(raceId: string): Observable<LeaderboardResponse> {
    return this.http.get<LeaderboardResponse>(`${this.apiUrl}/api/activity/race/${raceId}/leaderboard`);
  }

  getUserLatestActivity(userId: string): Observable<RowerData> {
    return this.http.get<RowerData>(`${this.apiUrl}/api/activity/latest?userId=${userId}`);
  }

  getUserProfile(userId: string): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.apiUrl}/api/user/profile/${userId}`);
  }

  updateUserProfile(userId: string, profile: Partial<UserProfile>): Observable<UserProfile> {
    return this.http.put<UserProfile>(`${this.apiUrl}/api/user/profile/${userId}`, profile);
  }

  getAllActivities(limit: number = 20): Observable<RowerData[]> {
    return this.http.get<RowerData[]>(`${this.apiUrl}/api/activity/history?limit=${limit}`);
  }

  checkHealth(): Observable<{ status: string; database: string }> {
    return this.http.get<{ status: string; database: string }>(`${this.apiUrl}/health`);
  }
}
