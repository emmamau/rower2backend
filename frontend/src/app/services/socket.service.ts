import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { KayakCustomization } from '../models/user.model';

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
  isBot?: boolean;
  isPaired?: boolean;
  kayak?: KayakCustomization;
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

export interface DuelSocketEventPayload {
  eventType: 'challenge_received' | 'challenge_responded' | 'challenge_cancelled';
  challengeId: string;
  challengerUserId?: string;
  challengerLogin?: string;
  challengedUserId?: string;
  challengedLogin?: string;
  status?: string;
  accepted?: boolean;
  isForfeit?: boolean;
  forfeitUserId?: string;
  winnerUserId?: string;
  cancelledByUserId?: string;
  slotStart?: string;
  slotEnd?: string;
  targetDistance?: number;
  roomCode?: string;
  roomPin?: string;
  slotFreed?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private leaderboardSubject = new Subject<LeaderboardUpdatePayload>();
  private statusSubject = new Subject<{ raceId: string; status: string; details?: any }>();
  private privateRoomUpdateSubject = new Subject<PrivateRoomUpdatePayload>();
  private duelEventSubject = new Subject<DuelSocketEventPayload>();
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

    this.socket.on('duel:challenge_received', (data: any) => {
      this.duelEventSubject.next({ ...(data || {}), eventType: 'challenge_received' });
    });

    this.socket.on('duel:challenge_responded', (data: any) => {
      this.duelEventSubject.next({ ...(data || {}), eventType: 'challenge_responded' });
    });

    this.socket.on('duel:challenge_cancelled', (data: any) => {
      this.duelEventSubject.next({ ...(data || {}), eventType: 'challenge_cancelled' });
    });

    this.socket.on('garmin:paired', (data: any) => {
      this.garminPairedSubject.next(data);
    });

    this.socket.on('session_claimed', (data: any) => {
      if (data && data.deviceToken) {
        this.garminPairedSubject.next({
          userId: data.userId,
          deviceId: data.deviceId,
          deviceToken: data.deviceToken,
          ticketClaimed: data.mode === 'room',
          guestName: data.playerName,
          lane: data.lane,
          raceId: data.roomId,
          socketId: data.socketId
        });
      }
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

  public onDuelEvent(): Observable<DuelSocketEventPayload> {
    return this.duelEventSubject.asObservable();
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

