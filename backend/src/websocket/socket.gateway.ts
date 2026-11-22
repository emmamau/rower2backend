import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { KayakCustomization } from "../models/user.model";

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
  connectionState?: "CONNECTED" | "READY";
  isBot?: boolean;
  isPaired?: boolean;
  kayak?: KayakCustomization;
}

export interface LeaderboardUpdatePayload {
  raceId: string;
  timestamp: number;
  leaderboard: LiveRacerMetric[];
}

export class SocketGateway {
  private static instance: SocketGateway;
  private io: Server | null = null;
  private userSockets: Map<string, Set<string>> = new Map(); // userId.toLowerCase() -> Set<socketId>
  private socketToUser: Map<string, string> = new Map(); // socketId -> userId.toLowerCase()

  private constructor() {}

  public static getInstance(): SocketGateway {
    if (!SocketGateway.instance) {
      SocketGateway.instance = new SocketGateway();
    }
    return SocketGateway.instance;
  }

  public init(httpServer: HttpServer): Server {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.io.on("connection", (socket: Socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      // Liaison automatique si le userId est passé dans handshake auth / query
      const initialUserId = (socket.handshake.auth?.userId || socket.handshake.query?.userId) as string | undefined;
      if (initialUserId && typeof initialUserId === "string") {
        this.bindUserSocket(initialUserId, socket.id);
      }

      socket.on("identify", (userId: string) => {
        if (userId && typeof userId === "string") {
          this.bindUserSocket(userId, socket.id);
        }
      });

      // Client joins a specific race room
      socket.on("join_race", (raceId: string) => {
        socket.join(`race:${raceId}`);
        console.log(`[Socket] ${socket.id} joined room race:${raceId}`);
      });

      // Client leaves a specific race room
      socket.on("leave_race", (raceId: string) => {
        socket.leave(`race:${raceId}`);
        console.log(`[Socket] ${socket.id} left room race:${raceId}`);
      });

      socket.on("disconnect", () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
        this.unbindUserSocket(socket.id);
      });
    });

    return this.io;
  }

  private bindUserSocket(userId: string, socketId: string): void {
    const clean = userId.trim().toLowerCase();
    this.socketToUser.set(socketId, clean);
    if (!this.userSockets.has(clean)) {
      this.userSockets.set(clean, new Set());
    }
    this.userSockets.get(clean)!.add(socketId);
  }

  private unbindUserSocket(socketId: string): void {
    const cleanUser = this.socketToUser.get(socketId);
    if (cleanUser && this.userSockets.has(cleanUser)) {
      const set = this.userSockets.get(cleanUser)!;
      set.delete(socketId);
      if (set.size === 0) {
        this.userSockets.delete(cleanUser);
      }
    }
    this.socketToUser.delete(socketId);
  }

  /**
   * Déconnecte immédiatement toutes les sockets actives associées à un utilisateur banni/révoqué.
   */
  public disconnectUser(userId: string): void {
    if (!this.io || !userId) return;
    const clean = userId.trim().toLowerCase();
    const socketIds = this.userSockets.get(clean);
    if (socketIds && socketIds.size > 0) {
      for (const socketId of Array.from(socketIds)) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit("account_revoked", {
            message: "Votre compte a été révoqué par un administrateur.",
            timestamp: Date.now(),
          });
          socket.disconnect(true);
        }
      }
      this.userSockets.delete(clean);
    }
  }

  public getConnectedSocketsCount(): number {
    return this.io?.sockets?.sockets?.size || 0;
  }

  public getOnlineUsers(): string[] {
    return Array.from(this.userSockets.keys());
  }

  public getOnlineUsersCount(): number {
    return this.userSockets.size;
  }

  public broadcastLeaderboard(raceId: string, leaderboard: LiveRacerMetric[]): void {
    if (!this.io) return;
    const payload: LeaderboardUpdatePayload = {
      raceId,
      timestamp: Date.now(),
      leaderboard
    };
    this.io.to(`race:${raceId}`).emit("race:leaderboard_update", payload);
    // Also broadcast to public channel for general lobby dashboards
    this.io.emit(`race:${raceId}:update`, payload);
  }

  public broadcastRaceStatus(raceId: string, status: string, details?: any): void {
    if (!this.io) return;
    this.io.to(`race:${raceId}`).emit("race:status_change", {
      raceId,
      status,
      timestamp: Date.now(),
      details
    });
    this.io.emit("race:status_change", { raceId, status, details });
  }

  public broadcastPrivateRoomUpdate(raceId: string, data: any): void {
    if (!this.io) return;
    const payload = {
      raceId,
      timestamp: Date.now(),
      ...data
    };
    this.io.to(`race:${raceId}`).emit("race:private_update", payload);
    this.io.emit(`race:${raceId}:private_update`, payload);
    this.io.emit("race:private_update", payload);
  }

  public broadcast(event: string, data: any): void {
    if (!this.io) return;
    this.io.emit(event, data);
  }

  public getIO(): Server | null {
    return this.io;
  }
}

export default SocketGateway.getInstance();

