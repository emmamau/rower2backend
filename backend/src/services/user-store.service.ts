import { Op } from "sequelize";
import db from "../models";
import { isEmmaAdminUser, hashPassword } from "./auth.service";

const Users = db.users;
const LoginRequests = db.loginRequests;

export interface StoredUser {
  id: string;
  name: string;
  login: string;
  email?: string;
  lastName?: string;
  nom?: string;
  firstName?: string;
  prenom?: string;
  birthYear?: number;
  anneeNaissance?: number;
  gender?: string;
  sexe?: string;
  country?: string;
  pays?: string;
  passwordHash?: string;
  passwordSalt?: string;
  isSubscriber: boolean;
  subscriptionTier?: "free" | "intermediate" | "premium" | string;
  subscriptionStatus?: "active" | "canceled" | "past_due" | "none" | string;
  lemonCustomerId?: string;
  lemonSubscriptionId?: string;
  watchModel?: string;
  rowerModel?: string;
  userPrefix?: string;
  userSuffix?: string;
  isConfirmed: boolean;
  watchUserId?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  totalRaces: number;
  totalWins: number;
  podiums: number;
  points: number;
  bestRank: number;
  lastRank: number;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
  toJSON?: () => Record<string, any>;
}

export interface StoredLoginRequest {
  id: string;
  userId: string;
  login: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: Date;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class UserStoreService {
  private static instance: UserStoreService;
  private inMemoryUsers: Map<string, StoredUser> = new Map();
  private inMemoryLoginRequests: Map<string, StoredLoginRequest> = new Map();

  private constructor() {
    this.seedEmmaRacer();
  }

  public static getInstance(): UserStoreService {
    if (!UserStoreService.instance) {
      UserStoreService.instance = new UserStoreService();
    }
    return UserStoreService.instance;
  }

  /**
   * Initialise EmmaRacer comme administratrice et abonnée en dur dans le cache mémoire.
   */
  private seedEmmaRacer(): void {
    const defaultPassword = hashPassword("EmmaRacer2026!");
    const emma: StoredUser = {
      id: "EmmaRacer",
      login: "EmmaRacer",
      name: "Emma Racer",
      email: "emmaracer@rower.fr",
      nom: "Racer",
      lastName: "Racer",
      prenom: "Emma",
      firstName: "Emma",
      anneeNaissance: 1996,
      birthYear: 1996,
      sexe: "F",
      gender: "F",
      pays: "France",
      country: "France",
      passwordHash: defaultPassword.hash,
      passwordSalt: defaultPassword.salt,
      isSubscriber: true,
      subscriptionTier: "premium",
      subscriptionStatus: "active",
      userPrefix: "Emma",
      userSuffix: "RCR01",
      isAdmin: true,
      isConfirmed: true,
      totalRaces: 0,
      totalWins: 0,
      podiums: 0,
      points: 100,
      bestRank: 1,
      lastRank: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryUsers.set("emmaracer", emma);
  }

  public async findUser(identifier: string): Promise<StoredUser | null> {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();

    // 1. Consultation en mémoire d'abord (ultra-rapide)
    const inMem = this.inMemoryUsers.get(clean);
    if (inMem) return inMem;

    // 2. Recherche par id, login ou watchUserId dans le store mémoire
    for (const u of this.inMemoryUsers.values()) {
      if (
        u.id.toLowerCase() === clean ||
        u.login.toLowerCase() === clean ||
        (u.watchUserId && u.watchUserId.toLowerCase() === clean)
      ) {
        return u;
      }
    }

    // 3. Consultation base de données Sequelize si disponible
    try {
      const dbUser = await Users.findOne({
        where: {
          [Op.or]: [
            { id: identifier },
            { login: identifier },
            { watchUserId: identifier }
          ]
        }
      });
      if (dbUser) {
        const plain = dbUser.toJSON() as StoredUser;
        this.cacheUser(plain);
        return plain;
      }
    } catch {
      // Tolérance hors-ligne
    }

    return null;
  }

  public async findUserByEmail(email: string): Promise<StoredUser | null> {
    if (!email) return null;
    const clean = email.trim().toLowerCase();

    for (const u of this.inMemoryUsers.values()) {
      if (u.email && u.email.toLowerCase() === clean) {
        return u;
      }
    }

    try {
      const dbUser = await Users.findOne({
        where: { email: clean }
      });
      if (dbUser) {
        const plain = dbUser.toJSON() as StoredUser;
        this.cacheUser(plain);
        return plain;
      }
    } catch {
      // Tolérance hors-ligne
    }

    return null;
  }

  public async createUser(data: Partial<StoredUser>): Promise<StoredUser> {
    const now = new Date();
    const login = String(data.login || data.id || "").trim();
    const isEmma = isEmmaAdminUser(login, data.name);

    const lastName = data.lastName || data.nom;
    const firstName = data.firstName || data.prenom;
    const birthYear = data.birthYear || data.anneeNaissance;
    const gender = data.gender || data.sexe;
    const country = data.country || data.pays;

    const newUser: StoredUser = {
      id: login || `usr_${Date.now()}`,
      login,
      name: data.name || login,
      email: data.email ? String(data.email).trim().toLowerCase() : undefined,
      lastName,
      nom: lastName,
      firstName,
      prenom: firstName,
      birthYear,
      anneeNaissance: birthYear,
      gender,
      sexe: gender,
      country,
      pays: country,
      passwordHash: data.passwordHash,
      passwordSalt: data.passwordSalt,
      isSubscriber: isEmma ? true : (data.isSubscriber !== undefined ? Boolean(data.isSubscriber) : false),
      isConfirmed: isEmma ? true : Boolean(data.isConfirmed),
      watchUserId: data.watchUserId,
      resetPasswordToken: data.resetPasswordToken,
      resetPasswordExpires: data.resetPasswordExpires,
      totalRaces: data.totalRaces || 0,
      totalWins: data.totalWins || 0,
      podiums: data.podiums || 0,
      points: data.points || 0,
      bestRank: data.bestRank || 0,
      lastRank: data.lastRank || 0,
      isAdmin: isEmma ? true : Boolean(data.isAdmin),
      createdAt: now,
      updatedAt: now,
    };

    this.cacheUser(newUser);

    try {
      await Users.create(newUser as any);
    } catch {
      // Persistence best-effort
    }

    return newUser;
  }

  public async updateUser(identifier: string, updates: Partial<StoredUser>): Promise<StoredUser | null> {
    const existing = await this.findUser(identifier);
    if (!existing) return null;

    const lastName = updates.lastName || updates.nom || existing.lastName || existing.nom;
    const firstName = updates.firstName || updates.prenom || existing.firstName || existing.prenom;
    const birthYear = updates.birthYear || updates.anneeNaissance || existing.birthYear || existing.anneeNaissance;
    const gender = updates.gender || updates.sexe || existing.gender || existing.sexe;
    const country = updates.country || updates.pays || existing.country || existing.pays;

    const updated: StoredUser = {
      ...existing,
      ...updates,
      lastName,
      nom: lastName,
      firstName,
      prenom: firstName,
      birthYear,
      anneeNaissance: birthYear,
      gender,
      sexe: gender,
      country,
      pays: country,
      updatedAt: new Date(),
    };

    this.cacheUser(updated);

    try {
      await Users.update(updates as any, {
        where: {
          [Op.or]: [{ id: existing.id }, { login: existing.login }]
        }
      });
    } catch {
      // Persistence best-effort
    }

    return updated;
  }

  public async findUserByResetToken(token: string): Promise<StoredUser | null> {
    if (!token) return null;
    const clean = token.trim();
    const now = new Date();

    for (const u of this.inMemoryUsers.values()) {
      if (
        u.resetPasswordToken === clean &&
        u.resetPasswordExpires &&
        new Date(u.resetPasswordExpires) > now
      ) {
        return u;
      }
    }

    try {
      const dbUser = await Users.findOne({
        where: {
          resetPasswordToken: clean,
          resetPasswordExpires: { [Op.gt]: now }
        }
      });
      if (dbUser) {
        const plain = dbUser.toJSON() as StoredUser;
        this.cacheUser(plain);
        return plain;
      }
    } catch {
      // Tolérance hors-ligne
    }

    return null;
  }

  public async createLoginRequest(data: {
    id: string;
    userId: string;
    login: string;
    status?: "pending" | "approved" | "rejected" | "expired";
  }): Promise<StoredLoginRequest> {
    const req: StoredLoginRequest = {
      id: data.id,
      userId: data.userId,
      login: data.login,
      status: data.status || "pending",
      requestedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.inMemoryLoginRequests.set(req.id, req);

    try {
      await LoginRequests.create(req as any);
    } catch {
      // Persistence best-effort
    }

    return req;
  }

  public async findLoginRequestById(requestId: string): Promise<StoredLoginRequest | null> {
    const inMem = this.inMemoryLoginRequests.get(requestId);
    if (inMem) return inMem;

    try {
      const dbReq = await LoginRequests.findByPk(requestId);
      if (dbReq) {
        const plain = dbReq.toJSON() as StoredLoginRequest;
        this.inMemoryLoginRequests.set(plain.id, plain);
        return plain;
      }
    } catch {
      // Tolérance hors-ligne
    }

    return null;
  }

  public async findPendingLoginRequest(lookupId: string): Promise<StoredLoginRequest | null> {
    const clean = String(lookupId || "").trim().toLowerCase();
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    for (const req of this.inMemoryLoginRequests.values()) {
      if (
        req.status === "pending" &&
        req.requestedAt >= twoMinutesAgo &&
        (req.userId.toLowerCase() === clean || req.login.toLowerCase() === clean)
      ) {
        return req;
      }
    }

    try {
      const pending = await LoginRequests.findOne({
        where: {
          [Op.or]: [
            { userId: lookupId },
            { login: lookupId }
          ],
          status: "pending",
          requestedAt: { [Op.gte]: twoMinutesAgo },
        },
        order: [["requestedAt", "DESC"]],
      });
      if (pending) {
        return pending.toJSON() as StoredLoginRequest;
      }
    } catch {
      // Tolérance hors-ligne
    }

    return null;
  }

  public async updateLoginRequest(
    requestId: string,
    updates: Partial<StoredLoginRequest>
  ): Promise<StoredLoginRequest | null> {
    const req = await this.findLoginRequestById(requestId);
    if (!req) return null;

    const updated: StoredLoginRequest = {
      ...req,
      ...updates,
      updatedAt: new Date(),
    };
    this.inMemoryLoginRequests.set(requestId, updated);

    try {
      await LoginRequests.update(updates as any, { where: { id: requestId } });
    } catch {
      // Persistence best-effort
    }

    return updated;
  }

  public async getAllUsersForLeaderboard(): Promise<StoredUser[]> {
    const usersMap = new Map<string, StoredUser>();
    for (const u of this.inMemoryUsers.values()) {
      usersMap.set(u.id, u);
    }

    try {
      const dbUsers = await Users.findAll({
        order: [["points", "DESC"], ["totalWins", "DESC"], ["podiums", "DESC"]],
      });
      for (const d of dbUsers) {
        const p = d.toJSON() as StoredUser;
        usersMap.set(p.id, p);
      }
    } catch {
      // Fallback mémoire
    }

    return Array.from(usersMap.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins;
      return b.podiums - a.podiums;
    });
  }

  private cacheUser(user: StoredUser): void {
    if (user.id) this.inMemoryUsers.set(user.id.toLowerCase(), user);
    if (user.login) this.inMemoryUsers.set(user.login.toLowerCase(), user);
  }
}

export default UserStoreService.getInstance();
