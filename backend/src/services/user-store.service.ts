import { Op } from "sequelize";
import db from "../models";
import { KayakCustomization, RegattaPreferences, DuelPreferences } from "../models/user.model";
import { isEmmaAdminUser, hashPassword } from "./auth.service";
import { getLeagueByPoints } from "../utils/league.util";

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
  language?: string;
  passwordHash?: string;
  passwordSalt?: string;
  isSubscriber: boolean;
  subscriptionTier?: "free" | "intermediate" | "premium" | string;
  subscriptionStatus?: "active" | "canceled" | "past_due" | "none" | string;
  lemonCustomerId?: string;
  lemonSubscriptionId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  watchModel?: string;
  rowerModel?: string;
  isConfirmed: boolean;
  watchUserId?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  totalRaces: number;
  totalWins: number;
  podiums: number;
  points: number;
  league?: string;
  currentLeague?: 'BRONZE' | 'SILVER' | 'GOLD';
  totalCareerPoints?: number;
  isResting?: boolean;
  bestRank: number;
  lastRank: number;
  isAdmin: boolean;
  role?: string;
  isRevoked?: boolean;
  is_revoked?: boolean;
  customConcurrentRooms?: number | null;
  custom_concurrent_rooms?: number | null;
  customWeeklyRooms?: number | null;
  custom_weekly_rooms?: number | null;
  kayakCustomization?: KayakCustomization;
  regattaPreferences?: RegattaPreferences;
  duelPreferences?: DuelPreferences;
  duelsWon?: number;
  duelsLost?: number;
  duelsDrawn?: number;
  duelPoints?: number;
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
  private inMemoryActivities: any[] = [];

  public recordActivity(activity: any): any {
    const id = String(activity.id || `${activity.activityId}_${activity.userId}`);
    const existingIdx = this.inMemoryActivities.findIndex((a) => String(a.id) === id);
    if (existingIdx >= 0) {
      const target = this.inMemoryActivities[existingIdx];
      for (const [k, v] of Object.entries(activity)) {
        if (v !== undefined && k !== "get" && k !== "update" && k !== "setDataValue") {
          target[k] = v;
        }
      }
      target.updatedAt = activity.updatedAt ? new Date(activity.updatedAt) : new Date();
      return target;
    }

    const act: Record<string, any> = {
      ...activity,
      id,
      createdAt: activity.createdAt ? new Date(activity.createdAt) : new Date(),
      updatedAt: activity.updatedAt ? new Date(activity.updatedAt) : new Date(),
    };
    act.get = (field?: any) => {
      if (!field || typeof field === "object") {
        const copy: Record<string, any> = {};
        for (const [k, v] of Object.entries(act)) {
          if (typeof v !== "function") copy[k] = v;
        }
        return copy;
      }
      return act[field];
    };
    act.setDataValue = (field: string, value: any) => {
      act[field] = value;
    };
    act.update = async (updates: Record<string, any>) => {
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) {
          act[k] = v;
        }
      }
      act.updatedAt = new Date();
      return act;
    };
    this.inMemoryActivities.push(act);
    return act;
  }

  public findActivityById(id: string): any | null {
    if (!id) return null;
    const clean = String(id).trim();
    return this.inMemoryActivities.find((a) => String(a.id) === clean) || null;
  }

  public deleteActivityById(id: string): void {
    if (!id) return;
    const clean = String(id).trim();
    this.inMemoryActivities = this.inMemoryActivities.filter((a) => String(a.id) !== clean);
  }

  public updateActivitiesWhere(
    activityId: string,
    filterStatus: string | string[] | undefined,
    updates: Record<string, any>
  ): void {
    if (!activityId) return;
    const cleanRaceId = String(activityId).trim();
    for (const act of this.inMemoryActivities) {
      if (String(act.activityId) === cleanRaceId) {
        const matchesStatus =
          !filterStatus ||
          (Array.isArray(filterStatus)
            ? filterStatus.includes(String(act.status))
            : act.status === filterStatus);
        if (matchesStatus) {
          for (const [k, v] of Object.entries(updates)) {
            if (v !== undefined) {
              act[k] = v;
            }
          }
          act.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
        }
      }
    }
  }

  public findActivitiesForUser(userId: string, additionalIds: string[] = []): any[] {
    if (!userId) return [...this.inMemoryActivities];
    const valid = new Set([
      userId.trim().toLowerCase(),
      ...additionalIds.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean),
    ]);
    return this.inMemoryActivities.filter((a) => {
      const u = String(a.userId || '').toLowerCase();
      return valid.has(u);
    });
  }

  public findActivitiesByRaceId(raceId: string): any[] {
    if (!raceId) return [];
    const clean = raceId.trim().toLowerCase();
    return this.inMemoryActivities.filter((a) => {
      const actId = String(a.activityId || a.id || '').toLowerCase();
      return actId.includes(clean);
    });
  }

  public purgeUserActivities(userId: string, additionalIds: string[] = []): void {
    if (!userId) return;
    const targets = new Set([
      userId.trim().toLowerCase(),
      ...additionalIds.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean),
    ]);
    this.inMemoryActivities = this.inMemoryActivities.filter((a) => {
      const u = String(a.userId || '').toLowerCase();
      return !targets.has(u);
    });
  }

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
      isAdmin: true,
      isConfirmed: true,
      totalRaces: 0,
      totalWins: 0,
      podiums: 0,
      points: 100,
      league: "silver",
      bestRank: 1,
      lastRank: 1,
      duelsWon: 0,
      duelsLost: 0,
      duelsDrawn: 0,
      duelPoints: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryUsers.set("emmaracer", emma);
  }

  public findUserSync(identifier: string): StoredUser | null {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();

    const inMem = this.inMemoryUsers.get(clean);
    if (inMem) return inMem;

    for (const u of this.inMemoryUsers.values()) {
      if (
        (u.id && u.id.toLowerCase() === clean) ||
        (u.login && u.login.toLowerCase() === clean) ||
        (u.watchUserId && u.watchUserId.toLowerCase() === clean)
      ) {
        return u;
      }
    }
    return null;
  }

  public getUserByIdSync(id: string): StoredUser | null {
    return this.findUserSync(id);
  }

  public async getUserById(id: string): Promise<StoredUser | null> {
    return this.findUser(id);
  }

  public async findUser(identifier: string): Promise<StoredUser | null> {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();

    // 1. Consultation base de données Sequelize si disponible (reflète immédiatement les modifications faites par l'admin)
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
        const tier = String(plain.subscriptionTier || (plain as any).subscription_tier || "").toLowerCase().trim();
        if ((tier && tier !== "free" && tier !== "none") || (plain.subscriptionStatus === "active" && tier !== "free")) {
          plain.isSubscriber = true;
        }
        this.cacheUser(plain);
        return plain;
      }
    } catch {
      // Tolérance hors-ligne
    }

    // 2. Consultation en mémoire si non trouvé en base ou DB hors-ligne
    const inMem = this.inMemoryUsers.get(clean);
    if (inMem) return inMem;

    for (const u of this.inMemoryUsers.values()) {
      if (
        (u.id && u.id.toLowerCase() === clean) ||
        (u.login && u.login.toLowerCase() === clean) ||
        (u.watchUserId && u.watchUserId.toLowerCase() === clean)
      ) {
        return u;
      }
    }

    return null;
  }

  public async findUserByEmail(email: string): Promise<StoredUser | null> {
    if (!email) return null;
    const clean = email.trim().toLowerCase();

    try {
      const dbUser = await Users.findOne({
        where: { email: clean }
      });
      if (dbUser) {
        const plain = dbUser.toJSON() as StoredUser;
        const tier = String(plain.subscriptionTier || (plain as any).subscription_tier || "").toLowerCase().trim();
        if ((tier && tier !== "free" && tier !== "none") || (plain.subscriptionStatus === "active" && tier !== "free")) {
          plain.isSubscriber = true;
        }
        this.cacheUser(plain);
        return plain;
      }
    } catch {
      // Tolérance hors-ligne
    }

    for (const u of this.inMemoryUsers.values()) {
      if (u.email && u.email.toLowerCase() === clean) {
        return u;
      }
    }

    return null;
  }

  public async findUserByStripeCustomerId(stripeCustomerId: string): Promise<StoredUser | null> {
    if (!stripeCustomerId) return null;
    const clean = stripeCustomerId.trim();

    for (const u of this.inMemoryUsers.values()) {
      if (u.stripeCustomerId && u.stripeCustomerId === clean) {
        return u;
      }
    }

    try {
      const dbUser = await Users.findOne({
        where: { stripeCustomerId: clean }
      });
      if (dbUser) {
        const plain = dbUser.toJSON() as StoredUser;
        const tier = String(plain.subscriptionTier || (plain as any).subscription_tier || "").toLowerCase().trim();
        if ((tier && tier !== "free" && tier !== "none") || (plain.subscriptionStatus === "active" && tier !== "free")) {
          plain.isSubscriber = true;
        }
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
      id: data.id || login || `usr_${Date.now()}`,
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
      language: data.language
        ? String(data.language).toLowerCase().trim()
        : (country && !["france", "fr", "belgique", "belgium", "suisse", "switzerland", "canada", "luxembourg"].some(c => String(country).toLowerCase().includes(c))
          ? "en"
          : "fr"),
      passwordHash: data.passwordHash,
      passwordSalt: data.passwordSalt,
      isSubscriber: isEmma
        ? true
        : (data.isSubscriber !== undefined
            ? Boolean(data.isSubscriber)
            : Boolean(data.subscriptionTier && !["free", "none", ""].includes(String(data.subscriptionTier).toLowerCase().trim()))),
      subscriptionTier: data.subscriptionTier,
      subscriptionStatus: data.subscriptionStatus,
      stripeCustomerId: data.stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId,
      lemonCustomerId: data.lemonCustomerId,
      lemonSubscriptionId: data.lemonSubscriptionId,
      isConfirmed: isEmma ? true : Boolean(data.isConfirmed),
      watchUserId: data.watchUserId,
      resetPasswordToken: data.resetPasswordToken,
      resetPasswordExpires: data.resetPasswordExpires,
      totalRaces: data.totalRaces || 0,
      totalWins: data.totalWins || 0,
      podiums: data.podiums || 0,
      points: data.points || 0,
      league: data.league || getLeagueByPoints(data.points || 0).id,
      currentLeague: (data.currentLeague as any) || "BRONZE",
      totalCareerPoints: data.totalCareerPoints !== undefined ? data.totalCareerPoints : (data.points || 0),
      isResting: Boolean(data.isResting),
      bestRank: data.bestRank || 0,
      lastRank: data.lastRank || 0,
      isAdmin: isEmma ? true : Boolean(data.isAdmin || data.role === "ADMIN"),
      role: data.role ? String(data.role).toUpperCase() : (isEmma || data.isAdmin ? "ADMIN" : "USER"),
      isRevoked: Boolean(data.isRevoked || data.is_revoked),
      kayakCustomization: data.kayakCustomization,
      regattaPreferences: data.regattaPreferences,
      duelPreferences: data.duelPreferences,
      duelsWon: data.duelsWon || 0,
      duelsLost: data.duelsLost || 0,
      duelsDrawn: data.duelsDrawn || 0,
      duelPoints: data.duelPoints || 0,
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

    const updatedPoints = updates.points !== undefined ? updates.points : existing.points;
    const league = updates.league || (updates.points !== undefined ? getLeagueByPoints(updatedPoints).id : existing.league || getLeagueByPoints(updatedPoints).id);
    const currentLeague = (updates.currentLeague as any) || existing.currentLeague || "BRONZE";
    const totalCareerPoints = updates.totalCareerPoints !== undefined ? updates.totalCareerPoints : (existing.totalCareerPoints !== undefined ? existing.totalCareerPoints : updatedPoints);
    const isResting = updates.isResting !== undefined ? Boolean(updates.isResting) : Boolean(existing.isResting);

    const rawTier = updates.subscriptionTier !== undefined ? updates.subscriptionTier : existing.subscriptionTier;
    const cleanTier = String(rawTier || "").toLowerCase().trim();
    const updatedIsSubscriber = updates.isSubscriber !== undefined
      ? Boolean(updates.isSubscriber)
      : (cleanTier && !["free", "none", ""].includes(cleanTier) ? true : existing.isSubscriber);

    const updated: StoredUser = {
      ...existing,
      ...updates,
      isSubscriber: updatedIsSubscriber,
      points: updatedPoints,
      league,
      currentLeague,
      totalCareerPoints,
      isResting,
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
      await Users.update({ ...updates, points: updatedPoints, league } as any, {
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
        const tier = String(plain.subscriptionTier || (plain as any).subscription_tier || "").toLowerCase().trim();
        if ((tier && tier !== "free" && tier !== "none") || (plain.subscriptionStatus === "active" && tier !== "free")) {
          plain.isSubscriber = true;
        }
        this.cacheUser(plain);
        return plain;
      }
    } catch {
      // Tolérance hors-ligne
    }

    return null;
  }

  public async deleteUser(identifier: string): Promise<boolean> {
    const existing = await this.findUser(identifier);
    if (!existing) return false;
    if (isEmmaAdminUser(existing.id, existing.name)) {
      throw new Error("Le compte administratrice EmmaRacer ne peut pas être supprimé.");
    }
    const cleanId = existing.id ? existing.id.toLowerCase() : "";
    const cleanLogin = existing.login ? existing.login.toLowerCase() : "";
    if (cleanId) this.inMemoryUsers.delete(cleanId);
    if (cleanLogin) this.inMemoryUsers.delete(cleanLogin);
    if (existing.email) {
      this.inMemoryUsers.delete(existing.email.toLowerCase());
    }
    if (existing.watchUserId) {
      this.inMemoryUsers.delete(existing.watchUserId.toLowerCase());
    }
    try {
      await Users.destroy({
        where: {
          [Op.or]: [{ id: existing.id }, { login: existing.login }]
        }
      });
      await LoginRequests.destroy({
        where: {
          [Op.or]: [{ userId: existing.id }, { login: existing.login }]
        }
      });
    } catch {
      // Best-effort
    }
    return true;
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
    const cleanSuffix = clean.includes("_") ? clean.split("_").pop()! : clean;

    for (const req of this.inMemoryLoginRequests.values()) {
      if (
        req.status === "pending" &&
        req.requestedAt >= twoMinutesAgo
      ) {
        const reqUserId = req.userId.toLowerCase();
        const reqLogin = req.login.toLowerCase();
        const reqSuffix = reqUserId.includes("_") ? reqUserId.split("_").pop()! : reqUserId;

        if (
          reqUserId === clean ||
          reqLogin === clean ||
          (cleanSuffix.length >= 4 && reqSuffix === cleanSuffix)
        ) {
          return req;
        }
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

  public async getAllUsers(): Promise<StoredUser[]> {
    const usersMap = new Map<string, StoredUser>();
    for (const u of this.inMemoryUsers.values()) {
      usersMap.set(u.id, u);
    }
    try {
      const dbUsers = await Users.findAll({ order: [["createdAt", "DESC"]] });
      for (const d of dbUsers) {
        const p = d.toJSON() as StoredUser;
        usersMap.set(p.id, p);
      }
    } catch {}
    return Array.from(usersMap.values());
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

    return Array.from(usersMap.values())
      .filter((u) => (u.totalRaces && u.totalRaces > 0) || (u.points && u.points > 0) || (u.totalWins && u.totalWins > 0))
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins;
        return b.podiums - a.podiums;
      });
  }

  public cacheUser(user: StoredUser): void {
    if (user.id) this.inMemoryUsers.set(user.id.toLowerCase(), user);
    if (user.login) this.inMemoryUsers.set(user.login.toLowerCase(), user);
    if (user.email) this.inMemoryUsers.set(user.email.toLowerCase(), user);
  }
}

export default UserStoreService.getInstance();
