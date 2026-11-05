import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

export interface LiveRacerMetric {
  lane: number;
  userId: string;
  name: string;
  dist: number;
  split: number;
  watts: number;
  spm: number;
  heartRate?: number;
  status: string;
}

export interface LeaderboardUpdatePayload {
  raceId: string;
  timestamp: number;
  leaderboard: LiveRacerMetric[];
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private leaderboardSubject = new Subject<LeaderboardUpdatePayload>();
  private statusSubject = new Subject<{ raceId: string; status: string; details?: any }>();

  private currentRoomId: string | null = null;

  constructor() {
    this.initSocket();
  }

  private initSocket(): void {
    const savedUrl = localStorage.getItem('rower_backend_url');
    const serverUrl = savedUrl || environment.apiUrl || 'https://rower-api-service.onrender.com';

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true
    });

    this.socket.on('connect', () => {
      console.log('[SocketService] Connected to real-time server:', this.socket?.id);
      if (this.currentRoomId) {
        this.socket?.emit('join_race', this.currentRoomId);
      }
    });

    this.socket.on('race:leaderboard_update', (data: LeaderboardUpdatePayload) => {
      this.leaderboardSubject.next(data);
    });

    this.socket.on('race:status_change', (data: any) => {
      this.statusSubject.next(data);
    });

    this.socket.on('disconnect', () => {
      console.log('[SocketService] Disconnected from real-time server');
    });
  }

  public joinRaceRoom(raceId: string): void {
    this.currentRoomId = raceId;
    if (this.socket && this.socket.connected) {
      this.socket.emit('join_race', raceId);
    }
  }

  public leaveRaceRoom(raceId: string): void {
    if (this.currentRoomId === raceId) {
      this.currentRoomId = null;
    }
    if (this.socket && this.socket.connected) {
      this.socket.emit('leave_race', raceId);
    }
  }

  public onLeaderboardUpdate(): Observable<LeaderboardUpdatePayload> {
    return this.leaderboardSubject.asObservable();
  }

  public onRaceStatusChange(): Observable<{ raceId: string; status: string; details?: any }> {
    return this.statusSubject.asObservable();
  }
}

