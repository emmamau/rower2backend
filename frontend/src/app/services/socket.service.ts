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
  country?: string;
  status: string;
  elapsedTime?: number;
  ready?: boolean;
  connectionState?: 'CONNECTED' | 'READY';
}

export interface LeaderboardUpdatePayload {
  raceId: string;
  timestamp: number;
  leaderboard: LiveRacerMetric[];
}

export interface PrivateRoomUpdatePayload {
  raceId: string;
  type: string;
  userId?: string;
  userName?: string;
  timestamp: number;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private leaderboardSubject = new Subject<LeaderboardUpdatePayload>();
  private statusSubject = new Subject<{ raceId: string; status: string; details?: any }>();
  private privateRoomUpdateSubject = new Subject<PrivateRoomUpdatePayload>();
  private garminPairedSubject = new Subject<{
    userId: string;
    deviceId?: string;
    deviceToken: string;
    ticketClaimed?: boolean;
    guestName?: string;
    lane?: number;
    raceId?: string;
    roomCode?: string;
    socketId?: string;
  }>();

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

    this.socket.on('race:private_update', (data: PrivateRoomUpdatePayload) => {
      this.privateRoomUpdateSubject.next(data);
    });

    this.socket.on('garmin:paired', (data: any) => {
      this.garminPairedSubject.next(data);
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

  public onPrivateRoomUpdate(): Observable<PrivateRoomUpdatePayload> {
    return this.privateRoomUpdateSubject.asObservable();
  }

  public getSocketId(): string | undefined {
    return this.socket?.id;
  }

  public onGarminPaired(): Observable<{
    userId: string;
    deviceId?: string;
    deviceToken: string;
    ticketClaimed?: boolean;
    guestName?: string;
    lane?: number;
    raceId?: string;
    roomCode?: string;
    socketId?: string;
  }> {
    return this.garminPairedSubject.asObservable();
  }
}

