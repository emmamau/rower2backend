import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { RowerData, HistoryResponse } from '../models/rower-data.model';
import { UserProfile } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class RowerService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getApiUrl(): string {
    return this.apiUrl;
  }

  getCurrentUser(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.apiUrl}/api/user/me`);
  }

  updateCurrentUser(profile: Partial<UserProfile>): Observable<UserProfile> {
    return this.http.put<UserProfile>(`${this.apiUrl}/api/user/me`, profile);
  }

  getLatestData(): Observable<RowerData> {
    return this.http.get<RowerData>(`${this.apiUrl}/api/rower/latest`);
  }

  getHistory(limit: number = 50, offset: number = 0): Observable<HistoryResponse> {
    return this.http.get<HistoryResponse>(`${this.apiUrl}/api/rower/history?limit=${limit}&offset=${offset}`);
  }

  checkHealth(): Observable<{ status: string; database: string }> {
    return this.http.get<{ status: string; database: string }>(`${this.apiUrl}/health`);
  }
}
