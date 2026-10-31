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
  private apiUrl: string;

  constructor(private http: HttpClient) {
    const savedUrl = localStorage.getItem('rower_backend_url');
    if (savedUrl && savedUrl.trim().length > 0) {
      this.apiUrl = savedUrl.trim().replace(/\/$/, '');
    } else {
      let defaultUrl = (environment.apiUrl || '').trim().replace(/\/$/, '');
      // If defaultUrl was configured as internal Render hostname (e.g. "https://rower-api-service")
      // which cannot be resolved by client browsers, purge it to relative path ""
      if (defaultUrl === 'https://rower-api-service' || defaultUrl === 'http://rower-api-service' || defaultUrl === 'rower-api-service') {
        defaultUrl = '';
      }
      this.apiUrl = defaultUrl;
    }

    // Safety: if stored localStorage had the bad internal name, clean it up
    if (this.apiUrl === 'https://rower-api-service' || this.apiUrl === 'http://rower-api-service' || this.apiUrl === 'rower-api-service') {
      this.apiUrl = '';
      localStorage.removeItem('rower_backend_url');
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

  getCurrentUser(): Observable<UserProfile> {
    const endpoint = this.apiUrl ? `${this.apiUrl}/api/user/me` : '/api/user/me';
    return this.http.get<UserProfile>(endpoint);
  }

  updateCurrentUser(profile: Partial<UserProfile>): Observable<UserProfile> {
    const endpoint = this.apiUrl ? `${this.apiUrl}/api/user/me` : '/api/user/me';
    return this.http.put<UserProfile>(endpoint, profile);
  }

  getLatestData(): Observable<RowerData> {
    const endpoint = this.apiUrl ? `${this.apiUrl}/api/rower/latest` : '/api/rower/latest';
    return this.http.get<RowerData>(endpoint);
  }

  getHistory(limit: number = 50, offset: number = 0): Observable<HistoryResponse> {
    const endpoint = this.apiUrl ? `${this.apiUrl}/api/rower/history?limit=${limit}&offset=${offset}` : `/api/rower/history?limit=${limit}&offset=${offset}`;
    return this.http.get<HistoryResponse>(endpoint);
  }

  checkHealth(): Observable<{ status: string; database: string }> {
    const endpoint = this.apiUrl ? `${this.apiUrl}/health` : '/health';
    return this.http.get<{ status: string; database: string }>(endpoint);
  }
}
