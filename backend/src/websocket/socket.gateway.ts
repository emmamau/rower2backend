import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";

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
}

export interface LeaderboardUpdatePayload {
  raceId: string;
  timestamp: number;
  leaderboard: LiveRacerMetric[];
}

export class SocketGateway {
  private static instance: SocketGateway;
  private io: Server | null = null;

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
      });
    });

    return this.io;
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

