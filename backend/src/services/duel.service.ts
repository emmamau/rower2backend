import db from "../models";
import { DuelPreferences, DuelTimeWindow } from "../models/user.model";
import { DuelChallengeAttributes, DuelChallengeStatus } from "../models/duel-challenge.model";
import userStore, { StoredUser } from "./user-store.service";
import emailService from "./email.service";
import raceManager from "./race-manager.service";
import socketGateway from "../websocket/socket.gateway";
import subscriptionPlanService from "./subscription-plan.service";
import { isEmmaAdminUser } from "./auth.service";

const DuelChallenges = db.duelChallenges;

export const DUEL_WIN_POINTS = 10;
export const DUEL_FORFEIT_PENALTY = 10;
export const DUEL_DRAW_POINTS = 2;
export const DUEL_PENDING_EXPIRY_MS = 72 * 60 * 60 * 1000;
export const DUEL_LATE_CANCEL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_DUEL_PREFERENCES: DuelPreferences = {
  acceptsDuels: true,
  isAbsent: false,
  absenceStartDate: null,
  absenceEndDate: null,
  refusedDays: [],
  availableWindows: [{ startTime: "08:00", endTime: "22:00" }],
  timezone: "Europe/Paris",
};

export interface StoredDuelChallenge extends DuelChallengeAttributes {
  createdAt: Date;
  updatedAt: Date;
}

function parseTimeToMinutes(hhmm: string): number | null {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(String(hhmm || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getLocalSlotInfo(
  date: Date,
  timeZone: string
): { dateYmd: string; dayOfWeek: number; minutesOfDay: number } {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Paris",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const getVal = (type: string) => parts.find((p) => p.type === type)?.value || "";
    const weekdayStr = getVal("weekday").toLowerCase();
    const weekdayMap: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };
    const dayOfWeek = weekdayMap[weekdayStr] ?? date.getUTCDay();
    const y = getVal("year");
    const m = getVal("month");
    const d = getVal("day");
    let hh = Number(getVal("hour"));
    if (hh === 24) hh = 0;
    const mm = Number(getVal("minute"));
    return {
      dateYmd: `${y}-${m}-${d}`,
      dayOfWeek,
      minutesOfDay: hh * 60 + mm,
    };
  } catch {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return {
      dateYmd: `${y}-${m}-${d}`,
      dayOfWeek: date.getUTCDay(),
      minutesOfDay: date.getUTCHours() * 60 + date.getUTCMinutes(),
    };
  }
}

export function sanitizeDuelPreferences(raw?: any): DuelPreferences {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_DUEL_PREFERENCES,
      refusedDays: [],
      availableWindows: DEFAULT_DUEL_PREFERENCES.availableWindows.map((w) => ({ ...w })),
    };
  }

  const acceptsDuels = raw.acceptsDuels !== undefined ? Boolean(raw.acceptsDuels) : true;
  const isAbsent = raw.isAbsent !== undefined ? Boolean(raw.isAbsent) : false;
  const absenceStartDate =
    typeof raw.absenceStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.absenceStartDate.trim())
      ? raw.absenceStartDate.trim()
      : null;
  const absenceEndDate =
    typeof raw.absenceEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.absenceEndDate.trim())
      ? raw.absenceEndDate.trim()
      : null;

  const refusedDaysSet = new Set<number>();
  if (Array.isArray(raw.refusedDays)) {
    for (const d of raw.refusedDays) {
      const n = Number(d);
      if (Number.isInteger(n) && n >= 0 && n <= 6) {
        refusedDaysSet.add(n);
      }
    }
  }

  const windows: DuelTimeWindow[] = [];
  if (Array.isArray(raw.availableWindows)) {
    for (const w of raw.availableWindows) {
      if (!w || typeof w !== "object") continue;
      const startM = parseTimeToMinutes(w.startTime);
      const endM = parseTimeToMinutes(w.endTime);
      if (startM !== null && endM !== null && endM > startM) {
        const sh = String(Math.floor(startM / 60)).padStart(2, "0");
        const sm = String(startM % 60).padStart(2, "0");
        const eh = String(Math.floor(endM / 60)).padStart(2, "0");
        const em = String(endM % 60).padStart(2, "0");
        windows.push({ startTime: `${sh}:${sm}`, endTime: `${eh}:${em}` });
      }
    }
  }

  // Si aucune plage fournie explicitement et aucun tableau vide intentionnel
  const finalWindows =
    Array.isArray(raw.availableWindows) && raw.availableWindows.length === 0
      ? []
      : windows.length > 0
      ? windows
      : DEFAULT_DUEL_PREFERENCES.availableWindows.map((w) => ({ ...w }));

  const timezone =
    typeof raw.timezone === "string" && raw.timezone.trim()
      ? raw.timezone.trim().slice(0, 64)
      : "Europe/Paris";

  return {
    acceptsDuels,
    isAbsent,
    absenceStartDate,
    absenceEndDate,
    refusedDays: Array.from(refusedDaysSet).sort((a, b) => a - b),
    availableWindows: finalWindows,
    timezone,
  };
}

function userMatchesId(user: StoredUser | null, candidateId: string): boolean {
  if (!user || !candidateId) return false;
  const clean = candidateId.trim().toLowerCase();
  return (
    user.id.toLowerCase() === clean ||
    (Boolean(user.login) && user.login.toLowerCase() === clean)
  );
}

function sameUserIdentifier(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export class DuelService {
  private static instance: DuelService;
  private inMemoryChallenges: Map<string, StoredDuelChallenge> = new Map();

  private constructor() {}

  public static getInstance(): DuelService {
    if (!DuelService.instance) {
      DuelService.instance = new DuelService();
    }
    return DuelService.instance;
  }

  public clearInMemoryChallenges(): void {
    this.inMemoryChallenges.clear();
  }

  private async persistChallenge(challenge: StoredDuelChallenge): Promise<void> {
    this.inMemoryChallenges.set(challenge.id, challenge);
    try {
      await DuelChallenges.upsert(challenge as any);
    } catch {
      // Best-effort DB persistence
    }
  }

  public async getChallengeById(challengeId: string): Promise<StoredDuelChallenge | null> {
    if (!challengeId) return null;
    const clean = challengeId.trim();
    const inMem = this.inMemoryChallenges.get(clean);
    if (inMem) return inMem;
    try {
      const row = await DuelChallenges.findByPk(clean);
      if (row) {
        const plain = row.toJSON() as StoredDuelChallenge;
        this.inMemoryChallenges.set(plain.id, plain);
        return plain;
      }
    } catch {}
    return null;
  }

  public async getChallengeByRoom(roomIdentifier: string): Promise<StoredDuelChallenge | null> {
    if (!roomIdentifier) return null;
    const clean = roomIdentifier.trim().toLowerCase();
    for (const c of this.inMemoryChallenges.values()) {
      if (
        (c.roomId && c.roomId.toLowerCase() === clean) ||
        (c.roomCode && c.roomCode.toLowerCase() === clean)
      ) {
        return c;
      }
    }
    try {
      const all = await this.listAllChallenges();
      const found = all.find(
        (c) =>
          (c.roomId && c.roomId.toLowerCase() === clean) ||
          (c.roomCode && c.roomCode.toLowerCase() === clean)
      );
      if (found) return found;
    } catch {}
    return null;
  }

  public async listAllChallenges(): Promise<StoredDuelChallenge[]> {
    const merged = new Map<string, StoredDuelChallenge>();
    for (const c of this.inMemoryChallenges.values()) {
      merged.set(c.id, c);
    }
    try {
      const rows = await DuelChallenges.findAll({ order: [["createdAt", "DESC"]] });
      for (const r of rows) {
        const plain = r.toJSON() as StoredDuelChallenge;
        if (!merged.has(plain.id)) {
          merged.set(plain.id, plain);
          this.inMemoryChallenges.set(plain.id, plain);
        }
      }
    } catch {}
    return Array.from(merged.values());
  }

  /**
   * Annule automatiquement tout défi PENDING sans réponse après 72 heures (ou si le créneau est passé).
   */
  public async expireOverdueChallenges(now: Date = new Date()): Promise<number> {
    const all = await this.listAllChallenges();
    let expiredCount = 0;
    const nowMs = now.getTime();
    for (const c of all) {
      if (c.status !== "PENDING") continue;
      const expMs = new Date(c.expiresAt).getTime();
      const slotMs = new Date(c.slotStart).getTime();
      if (nowMs >= expMs || nowMs >= slotMs) {
        c.status = "EXPIRED";
        c.updatedAt = now;
        await this.persistChallenge(c);
        if (c.roomId) {
          raceManager.closePrivateRace(c.roomId, c.challengerUserId, true);
        }
        expiredCount++;
      }
    }
    return expiredCount;
  }

  /**
   * Vérifie si un utilisateur a déjà un duel ACCEPTED bloquant le créneau [slotStart, slotEnd[.
   */
  public async hasBlockedSlotConflict(
    user: StoredUser | string,
    slotStart: Date,
    slotEnd: Date,
    excludeChallengeId?: string
  ): Promise<boolean> {
    const all = await this.listAllChallenges();
    const startMs = slotStart.getTime();
    const endMs = slotEnd.getTime();

    const identifiers = new Set<string>();
    if (typeof user === "string") {
      identifiers.add(user.trim().toLowerCase());
    } else {
      if (user.id) identifiers.add(user.id.trim().toLowerCase());
      if (user.login) identifiers.add(user.login.trim().toLowerCase());
    }

    for (const c of all) {
      if (c.status !== "ACCEPTED") continue;
      if (excludeChallengeId && c.id === excludeChallengeId) continue;

      const involvesUser =
        identifiers.has(String(c.challengerUserId || "").toLowerCase()) ||
        identifiers.has(String(c.challengerLogin || "").toLowerCase()) ||
        identifiers.has(String(c.challengedUserId || "").toLowerCase()) ||
        identifiers.has(String(c.challengedLogin || "").toLowerCase());

      if (!involvesUser) continue;

      const cStart = new Date(c.slotStart).getTime();
      const cEnd = new Date(c.slotEnd).getTime();
      if (cStart < endMs && cEnd > startMs) {
        return true;
      }
    }
    return false;
  }

  public async checkPlayerAvailabilityForSlot(
    user: StoredUser,
    slotStart: Date,
    slotEnd: Date,
    excludeChallengeId?: string
  ): Promise<{ available: boolean; reason?: string }> {
    const prefs = sanitizeDuelPreferences(user.duelPreferences);

    if (!prefs.acceptsDuels) {
      return { available: false, reason: "Cet abonné n'accepte pas les défis en duel." };
    }

    if (prefs.isAbsent) {
      return { available: false, reason: "Cet abonné est actuellement absent." };
    }

    const startInfo = getLocalSlotInfo(slotStart, prefs.timezone);
    const endInfo = getLocalSlotInfo(slotEnd, prefs.timezone);

    if (prefs.absenceStartDate && prefs.absenceEndDate) {
      if (startInfo.dateYmd >= prefs.absenceStartDate && startInfo.dateYmd <= prefs.absenceEndDate) {
        return {
          available: false,
          reason: `Cet abonné est absent du ${prefs.absenceStartDate} au ${prefs.absenceEndDate}.`,
        };
      }
    } else if (prefs.absenceStartDate && startInfo.dateYmd >= prefs.absenceStartDate) {
      return { available: false, reason: "Cet abonné est absent sur cette période." };
    }

    if (prefs.refusedDays.includes(startInfo.dayOfWeek)) {
      return {
        available: false,
        reason: "Cet abonné refuse les duels sur ce jour de la semaine.",
      };
    }

    if (prefs.availableWindows.length === 0) {
      return {
        available: false,
        reason: "Cet abonné n'a configuré aucune plage horaire disponible.",
      };
    }

    // Gérer le cas où slotEnd est à minuit le lendemain (00:00 -> 1440 min)
    let endMin = endInfo.minutesOfDay;
    if (endInfo.dateYmd !== startInfo.dateYmd && endMin === 0) {
      endMin = 24 * 60;
    } else if (endInfo.dateYmd !== startInfo.dateYmd) {
      return {
        available: false,
        reason: "Le créneau dépasse les plages horaires disponibles de cet abonné.",
      };
    }

    const fitsInAnyWindow = prefs.availableWindows.some((w) => {
      const ws = parseTimeToMinutes(w.startTime);
      const we = parseTimeToMinutes(w.endTime);
      if (ws === null || we === null) return false;
      return startInfo.minutesOfDay >= ws && endMin <= we;
    });

    if (!fitsInAnyWindow) {
      return {
        available: false,
        reason: "Ce créneau horaire est en dehors des plages de disponibilité de cet abonné.",
      };
    }

    const hasConflict = await this.hasBlockedSlotConflict(user, slotStart, slotEnd, excludeChallengeId);
    if (hasConflict) {
      return {
        available: false,
        reason: "Ce joueur a déjà un duel programmé et bloqué sur ce créneau.",
      };
    }

    return { available: true };
  }

  public async findAvailablePlayersForSlot(params: {
    slotStart: Date | string;
    slotEnd?: Date | string;
    durationMinutes?: number;
    requesterId?: string;
    league?: string;
    country?: string;
    gender?: string;
    ageCategory?: string;
    now?: Date;
  }): Promise<any[]> {
    const now = params.now || new Date();
    await this.expireOverdueChallenges(now);

    const start = new Date(params.slotStart);
    if (!Number.isFinite(start.getTime())) {
      throw new Error("Créneau de début invalide.");
    }
    const durMin = Math.min(240, Math.max(15, Number(params.durationMinutes) || 60));
    const end = params.slotEnd ? new Date(params.slotEnd) : new Date(start.getTime() + durMin * 60 * 1000);
    if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
      throw new Error("Créneau de fin invalide.");
    }

    const allUsers = await userStore.getAllUsers();
    const requester = params.requesterId ? await userStore.findUser(params.requesterId) : null;
    const currentYear = now.getFullYear();

    const availableList: any[] = [];
    for (const u of allUsers) {
      if (u.isRevoked) continue;
      if (
        params.requesterId &&
        (sameUserIdentifier(u.id, params.requesterId) ||
          sameUserIdentifier(u.login, params.requesterId) ||
          userMatchesId(requester, u.id))
      ) {
        continue;
      }

      if (params.league && params.league !== "all") {
        const userTier = String(u.currentLeague || u.league || "BRONZE").toUpperCase();
        if (userTier !== params.league.trim().toUpperCase()) continue;
      }

      if (params.country && params.country !== "all") {
        const uc = String(u.country || u.pays || "").trim().toLowerCase();
        if (uc !== params.country.trim().toLowerCase()) continue;
      }

      if (params.gender && params.gender !== "all") {
        const ug = String(u.gender || u.sexe || "").trim().toLowerCase();
        const tg = params.gender.trim().toLowerCase();
        if (tg === "m" || tg === "homme") {
          if (ug !== "m" && ug !== "homme") continue;
        } else if (tg === "f" || tg === "femme") {
          if (ug !== "f" && ug !== "femme") continue;
        } else if (ug !== tg) {
          continue;
        }
      }

      if (params.ageCategory && params.ageCategory !== "all") {
        const birth = u.birthYear || u.anneeNaissance;
        if (!birth || !Number.isFinite(birth)) continue;
        const age = currentYear - birth;
        const cat = params.ageCategory.trim().toUpperCase();
        if ((cat === "U19" || cat === "-19") && !(age < 19)) continue;
        if ((cat === "19-29" || cat === "SENIOR") && !(age >= 19 && age <= 29)) continue;
        if ((cat === "30-39" || cat === "MASTER_A") && !(age >= 30 && age <= 39)) continue;
        if ((cat === "40-49" || cat === "MASTER_B") && !(age >= 40 && age <= 49)) continue;
        if ((cat === "50-59" || cat === "MASTER_C") && !(age >= 50 && age <= 59)) continue;
        if ((cat === "60+" || cat === "MASTER_D") && !(age >= 60)) continue;
      }

      const check = await this.checkPlayerAvailabilityForSlot(u, start, end);
      if (check.available) {
        availableList.push({
          id: u.id,
          login: u.login || u.id,
          name: u.name || u.login || u.id,
          country: u.country || u.pays || "",
          gender: u.gender || u.sexe || "",
          birthYear: u.birthYear || u.anneeNaissance || null,
          currentLeague: (u.currentLeague || "BRONZE").toUpperCase(),
          duelsWon: u.duelsWon || 0,
          duelsLost: u.duelsLost || 0,
          duelsDrawn: u.duelsDrawn || 0,
          duelPoints: u.duelPoints || 0,
          duelPreferences: sanitizeDuelPreferences(u.duelPreferences),
        });
      }
    }

    return availableList.sort((a, b) => b.duelsWon - a.duelsWon || b.duelPoints - a.duelPoints);
  }

  public async createChallenge(params: {
    challengerId: string;
    challengedLoginOrId: string;
    slotStart: Date | string;
    slotEnd?: Date | string;
    durationMinutes?: number;
    targetDistance?: number;
    timezone?: string;
    title?: string;
    now?: Date;
  }): Promise<{ challenge: StoredDuelChallenge } | { error: string; statusCode: number }> {
    const now = params.now || new Date();
    await this.expireOverdueChallenges(now);

    const challenger = await userStore.findUser(params.challengerId);
    if (!challenger) {
      return { error: "Compte initiateur introuvable. Veuillez vous connecter.", statusCode: 404 };
    }

    const challenged = await userStore.findUser(params.challengedLoginOrId);
    if (!challenged) {
      return { error: `Abonné '${params.challengedLoginOrId}' introuvable.`, statusCode: 404 };
    }

    if (
      sameUserIdentifier(challenger.id, challenged.id) ||
      (challenger.login && challenged.login && sameUserIdentifier(challenger.login, challenged.login))
    ) {
      return { error: "Vous ne pouvez pas vous défier vous-même.", statusCode: 400 };
    }

    if (!params.slotStart) {
      return { error: "Le créneau horaire du duel est obligatoire.", statusCode: 400 };
    }

    const start = new Date(params.slotStart);
    if (!Number.isFinite(start.getTime())) {
      return { error: "Date de début de créneau invalide.", statusCode: 400 };
    }

    const durMin = Math.min(240, Math.max(15, Number(params.durationMinutes) || 60));
    const end = params.slotEnd ? new Date(params.slotEnd) : new Date(start.getTime() + durMin * 60 * 1000);
    if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
      return { error: "Date de fin de créneau invalide.", statusCode: 400 };
    }

    if (start.getTime() <= now.getTime()) {
      return { error: "Le créneau du duel doit être dans le futur.", statusCode: 400 };
    }

    const challengerBlocked = await this.hasBlockedSlotConflict(challenger, start, end);
    if (challengerBlocked) {
      return {
        error: "Vous avez déjà un duel accepté qui bloque ce créneau horaire.",
        statusCode: 409,
      };
    }

    const availability = await this.checkPlayerAvailabilityForSlot(challenged, start, end);
    if (!availability.available) {
      return {
        error: availability.reason || "Ce joueur n'est pas disponible sur ce créneau.",
        statusCode: 409,
      };
    }

    const isChallengerEmma = isEmmaAdminUser(challenger.id, challenger.name);
    const isChallengerAdmin = Boolean(isChallengerEmma || challenger.isAdmin);
    const challengerLimits = await subscriptionPlanService.getLimitsForTier(challenger);

    if (!isChallengerAdmin && !challengerLimits.canCreateDuel1v1) {
      return {
        error: `Votre forfait (${challengerLimits.name}) ne vous autorise pas à créer des duels 1v1.`,
        statusCode: 403,
      };
    }

    const requestedDistance = Number(params.targetDistance) || 2000;
    if (!isChallengerAdmin && requestedDistance > challengerLimits.maxDistance) {
      return {
        error: `Votre forfait (${challengerLimits.name}) limite la distance des duels à ${challengerLimits.maxDistance}m. Vous ne pouvez pas organiser un duel de ${requestedDistance}m.`,
        statusCode: 403,
      };
    }

    const targetDistance = Math.min(isChallengerAdmin ? 100000 : challengerLimits.maxDistance, Math.max(100, Math.round(requestedDistance)));
    const timezone = params.timezone || sanitizeDuelPreferences(challenger.duelPreferences).timezone || "Europe/Paris";
    const challengerLogin = challenger.login || challenger.id;
    const challengedLogin = challenged.login || challenged.id;
    const title = params.title?.trim() || `Duel 1v1 : ${challengerLogin} vs ${challengedLogin}`;

    const race = raceManager.createPrivateRace({
      title,
      targetDistance,
      maxParticipants: 2,
      hostUserId: challenger.id,
      hostUserName: challenger.name || challengerLogin,
      startMode: "scheduled",
      scheduledStartTime: start,
      timezone,
      requireApproval: false,
      isDuel1v1: true,
      gameMode: "duel_1v1",
      hostParticipates: true,
    });

    const id = `duel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const expiresAt = new Date(now.getTime() + DUEL_PENDING_EXPIRY_MS);

    const challenge: StoredDuelChallenge = {
      id,
      challengerUserId: challenger.id,
      challengerLogin,
      challengerName: challenger.name || challengerLogin,
      challengedUserId: challenged.id,
      challengedLogin,
      challengedName: challenged.name || challengedLogin,
      slotStart: start,
      slotEnd: end,
      timezone,
      targetDistance,
      title,
      roomId: race.id,
      roomCode: race.code,
      roomPin: race.pinCode,
      status: "PENDING",
      expiresAt,
      respondedAt: null,
      cancelledAt: null,
      cancelledByUserId: null,
      winnerUserId: null,
      forfeitUserId: null,
      isDraw: false,
      challengerPointsDelta: 0,
      challengedPointsDelta: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.persistChallenge(challenge);

    if (challenged.email) {
      await emailService.sendDuelChallengeEmail({
        to: challenged.email,
        challengerName: challenge.challengerName,
        challengerLogin: challenge.challengerLogin,
        challengedName: challenge.challengedName,
        challengeId: challenge.id,
        slotStart: start.toISOString(),
        slotEnd: end.toISOString(),
        timezone,
        targetDistance,
        roomCode: challenge.roomCode,
        roomPin: challenge.roomPin,
        lang: challenged.language || "fr",
      }).catch(() => {});
    }

    socketGateway.broadcast("duel:challenge_received", {
      challengeId: challenge.id,
      challengerUserId: challenge.challengerUserId,
      challengerLogin: challenge.challengerLogin,
      challengedUserId: challenge.challengedUserId,
      challengedLogin: challenge.challengedLogin,
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      targetDistance,
    });

    return { challenge };
  }

  public async respondToChallenge(params: {
    challengeId: string;
    responderUserId: string;
    action: "accept" | "refuse";
    now?: Date;
  }): Promise<{ challenge: StoredDuelChallenge } | { error: string; statusCode: number }> {
    const now = params.now || new Date();
    await this.expireOverdueChallenges(now);

    const challenge = await this.getChallengeById(params.challengeId);
    if (!challenge) {
      return { error: "Défi introuvable.", statusCode: 404 };
    }

    const responder = await userStore.findUser(params.responderUserId);
    const isTarget =
      sameUserIdentifier(params.responderUserId, challenge.challengedUserId) ||
      sameUserIdentifier(params.responderUserId, challenge.challengedLogin) ||
      userMatchesId(responder, challenge.challengedUserId) ||
      userMatchesId(responder, challenge.challengedLogin);

    if (!isTarget) {
      return { error: "Seul l'abonné défié peut accepter ou refuser ce défi.", statusCode: 403 };
    }

    if (challenge.status === "EXPIRED") {
      return { error: "Ce défi a expiré (sans réponse après 72h).", statusCode: 410 };
    }

    if (challenge.status !== "PENDING") {
      return { error: `Ce défi a déjà le statut '${challenge.status}'.`, statusCode: 409 };
    }

    const challenger = await userStore.findUser(challenge.challengerUserId);
    const challenged = responder || (await userStore.findUser(challenge.challengedUserId));

    if (params.action === "refuse") {
      challenge.status = "REFUSED";
      challenge.respondedAt = now;
      challenge.updatedAt = now;
      await this.persistChallenge(challenge);

      if (challenge.roomId) {
        raceManager.closePrivateRace(challenge.roomId, challenge.challengerUserId, true);
      }

      if (challenger?.email) {
        await emailService.sendDuelResponseEmail({
          to: challenger.email,
          challengerName: challenge.challengerName,
          challengedName: challenge.challengedName,
          challengedLogin: challenge.challengedLogin,
          challengeId: challenge.id,
          accepted: false,
          slotStart: new Date(challenge.slotStart).toISOString(),
          slotEnd: new Date(challenge.slotEnd).toISOString(),
          timezone: challenge.timezone,
          targetDistance: challenge.targetDistance,
          lang: challenger.language || "fr",
        }).catch(() => {});
      }

      socketGateway.broadcast("duel:challenge_responded", {
        challengeId: challenge.id,
        status: "REFUSED",
        accepted: false,
        challengerUserId: challenge.challengerUserId,
        challengerLogin: challenge.challengerLogin,
        challengedUserId: challenge.challengedUserId,
        challengedLogin: challenge.challengedLogin,
      });

      return { challenge };
    }

    // Acceptation : vérifier qu'aucun des deux joueurs n'a un créneau déjà bloqué
    const start = new Date(challenge.slotStart);
    const end = new Date(challenge.slotEnd);

    const challengerBlocked = await this.hasBlockedSlotConflict(
      challenger || challenge.challengerUserId,
      start,
      end,
      challenge.id
    );
    if (challengerBlocked) {
      return {
        error: "Le challenger a déjà un autre duel accepté sur ce créneau.",
        statusCode: 409,
      };
    }

    const challengedBlocked = await this.hasBlockedSlotConflict(
      challenged || challenge.challengedUserId,
      start,
      end,
      challenge.id
    );
    if (challengedBlocked) {
      return {
        error: "Vous avez déjà un autre duel accepté et bloqué sur ce créneau.",
        statusCode: 409,
      };
    }

    challenge.status = "ACCEPTED";
    challenge.respondedAt = now;
    challenge.updatedAt = now;
    await this.persistChallenge(challenge);

    // Pré-inscrire le joueur défié dans le salon privé 1v1 si ce salon est actif
    if (challenge.roomId && challenged) {
      raceManager.joinPrivateRace(
        challenge.roomId,
        challenged.id,
        challenged.name || challenged.login,
        challenged.country || challenged.pays,
        {
          isSubscriber: true,
          bypassApproval: true,
          ready: false,
        }
      );
    }

    if (challenger?.email) {
      await emailService.sendDuelResponseEmail({
        to: challenger.email,
        challengerName: challenge.challengerName,
        challengedName: challenge.challengedName,
        challengedLogin: challenge.challengedLogin,
        challengeId: challenge.id,
        accepted: true,
        slotStart: start.toISOString(),
        slotEnd: end.toISOString(),
        timezone: challenge.timezone,
        targetDistance: challenge.targetDistance,
        roomCode: challenge.roomCode,
        roomPin: challenge.roomPin,
        lang: challenger.language || "fr",
      }).catch(() => {});
    }

    socketGateway.broadcast("duel:challenge_responded", {
      challengeId: challenge.id,
      status: "ACCEPTED",
      accepted: true,
      challengerUserId: challenge.challengerUserId,
      challengerLogin: challenge.challengerLogin,
      challengedUserId: challenge.challengedUserId,
      challengedLogin: challenge.challengedLogin,
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      roomCode: challenge.roomCode,
      roomPin: challenge.roomPin,
    });

    return { challenge };
  }

  public async cancelChallenge(params: {
    challengeId: string;
    userId: string;
    now?: Date;
  }): Promise<{ challenge: StoredDuelChallenge; isForfeit: boolean } | { error: string; statusCode: number }> {
    const now = params.now || new Date();
    await this.expireOverdueChallenges(now);

    const challenge = await this.getChallengeById(params.challengeId);
    if (!challenge) {
      return { error: "Défi introuvable.", statusCode: 404 };
    }

    if (challenge.status !== "PENDING" && challenge.status !== "ACCEPTED") {
      return { error: `Impossible d'annuler un défi au statut '${challenge.status}'.`, statusCode: 409 };
    }

    const actor = await userStore.findUser(params.userId);
    const isChallenger =
      sameUserIdentifier(params.userId, challenge.challengerUserId) ||
      sameUserIdentifier(params.userId, challenge.challengerLogin) ||
      userMatchesId(actor, challenge.challengerUserId) ||
      userMatchesId(actor, challenge.challengerLogin);
    const isChallenged =
      sameUserIdentifier(params.userId, challenge.challengedUserId) ||
      sameUserIdentifier(params.userId, challenge.challengedLogin) ||
      userMatchesId(actor, challenge.challengedUserId) ||
      userMatchesId(actor, challenge.challengedLogin);

    if (!isChallenger && !isChallenged) {
      return { error: "Seuls les participants de ce duel peuvent l'annuler.", statusCode: 403 };
    }

    const cancellingUserId = isChallenger ? challenge.challengerUserId : challenge.challengedUserId;
    const cancellingName = isChallenger ? challenge.challengerName : challenge.challengedName;
    const cancellingLogin = isChallenger ? challenge.challengerLogin : challenge.challengedLogin;

    const opponentUserId = isChallenger ? challenge.challengedUserId : challenge.challengerUserId;
    const opponentName = isChallenger ? challenge.challengedName : challenge.challengerName;
    const opponent = await userStore.findUser(opponentUserId);

    const msUntilSlot = new Date(challenge.slotStart).getTime() - now.getTime();
    const isForfeit = challenge.status === "ACCEPTED" && msUntilSlot <= DUEL_LATE_CANCEL_MS;

    if (challenge.roomId) {
      raceManager.closePrivateRace(challenge.roomId, challenge.challengerUserId, true);
    }

    if (isForfeit) {
      const resolved = await this.applyOutcomeToChallenge(challenge, {
        forfeitUserId: cancellingUserId,
        winnerUserId: opponentUserId,
        cancelledByUserId: cancellingUserId,
        now,
      });
      if ("error" in resolved) {
        return resolved;
      }

      if (opponent?.email) {
        await emailService.sendDuelCancelledEmail({
          to: opponent.email,
          recipientName: opponentName,
          cancelledByName: cancellingName,
          cancelledByLogin: cancellingLogin,
          challengeId: challenge.id,
          slotStart: new Date(challenge.slotStart).toISOString(),
          slotEnd: new Date(challenge.slotEnd).toISOString(),
          timezone: challenge.timezone,
          isForfeit: true,
          pointsAwarded: DUEL_WIN_POINTS,
          lang: opponent.language || "fr",
        }).catch(() => {});
      }

      socketGateway.broadcast("duel:challenge_cancelled", {
        challengeId: challenge.id,
        status: "FORFEIT",
        isForfeit: true,
        forfeitUserId: cancellingUserId,
        winnerUserId: opponentUserId,
        challengerUserId: challenge.challengerUserId,
        challengedUserId: challenge.challengedUserId,
        slotFreed: true,
      });

      return { challenge: resolved.challenge, isForfeit: true };
    }

    challenge.status = "CANCELLED";
    challenge.cancelledAt = now;
    challenge.cancelledByUserId = cancellingUserId;
    challenge.updatedAt = now;
    await this.persistChallenge(challenge);

    if (opponent?.email) {
      await emailService.sendDuelCancelledEmail({
        to: opponent.email,
        recipientName: opponentName,
        cancelledByName: cancellingName,
        cancelledByLogin: cancellingLogin,
        challengeId: challenge.id,
        slotStart: new Date(challenge.slotStart).toISOString(),
        slotEnd: new Date(challenge.slotEnd).toISOString(),
        timezone: challenge.timezone,
        isForfeit: false,
        lang: opponent.language || "fr",
      }).catch(() => {});
    }

    socketGateway.broadcast("duel:challenge_cancelled", {
      challengeId: challenge.id,
      status: "CANCELLED",
      isForfeit: false,
      cancelledByUserId: cancellingUserId,
      challengerUserId: challenge.challengerUserId,
      challengedUserId: challenge.challengedUserId,
      slotFreed: true,
    });

    return { challenge, isForfeit: false };
  }

  public async deleteChallenge(params: {
    challengeId: string;
    userId: string;
    isAdmin?: boolean;
  }): Promise<{ success: boolean; message: string } | { error: string; statusCode: number }> {
    const cleanId = String(params.challengeId || "").trim();
    if (!cleanId) {
      return { error: "Identifiant du défi requis.", statusCode: 400 };
    }
    const challenge = await this.getChallengeById(cleanId);
    if (!challenge) {
      return { error: "Défi introuvable.", statusCode: 404 };
    }

    if (challenge.status !== "REFUSED" && challenge.status !== "CANCELLED" && challenge.status !== "EXPIRED") {
      return {
        error: `Seuls les duels refusés, annulés ou expirés peuvent être supprimés (statut actuel : '${challenge.status}').`,
        statusCode: 400,
      };
    }

    const actor = await userStore.findUser(params.userId);
    const isEmma = params.isAdmin || actor?.role === "admin";
    const isChallenger =
      sameUserIdentifier(params.userId, challenge.challengerUserId) ||
      sameUserIdentifier(params.userId, challenge.challengerLogin) ||
      userMatchesId(actor, challenge.challengerUserId) ||
      userMatchesId(actor, challenge.challengerLogin);
    const isChallenged =
      sameUserIdentifier(params.userId, challenge.challengedUserId) ||
      sameUserIdentifier(params.userId, challenge.challengedLogin) ||
      userMatchesId(actor, challenge.challengedUserId) ||
      userMatchesId(actor, challenge.challengedLogin);

    if (!isEmma && !isChallenger && !isChallenged) {
      return { error: "Vous n'êtes pas autorisé à supprimer ce duel.", statusCode: 403 };
    }

    this.inMemoryChallenges.delete(cleanId);
    try {
      await DuelChallenges.destroy({ where: { id: cleanId } });
    } catch {}

    socketGateway.broadcast("duel:challenge_deleted", {
      challengeId: cleanId,
      deletedByUserId: params.userId,
    });

    return { success: true, message: "Duel supprimé avec succès." };
  }

  private async applyOutcomeToChallenge(
    challenge: StoredDuelChallenge,
    outcome: {
      winnerUserId?: string | null;
      isDraw?: boolean;
      forfeitUserId?: string | null;
      cancelledByUserId?: string | null;
      now?: Date;
    }
  ): Promise<{ challenge: StoredDuelChallenge } | { error: string; statusCode: number }> {
    if (challenge.status === "COMPLETED" || challenge.status === "FORFEIT") {
      return { challenge };
    }

    const now = outcome.now || new Date();
    const challenger = await userStore.findUser(challenge.challengerUserId);
    const challenged = await userStore.findUser(challenge.challengedUserId);

    const isChallengerMatch = (uid?: string | null): boolean =>
      Boolean(
        uid &&
          (sameUserIdentifier(uid, challenge.challengerUserId) ||
            sameUserIdentifier(uid, challenge.challengerLogin) ||
            userMatchesId(challenger, uid))
      );

    const isChallengedMatch = (uid?: string | null): boolean =>
      Boolean(
        uid &&
          (sameUserIdentifier(uid, challenge.challengedUserId) ||
            sameUserIdentifier(uid, challenge.challengedLogin) ||
            userMatchesId(challenged, uid))
      );

    if (outcome.forfeitUserId) {
      const challengerForfeit = isChallengerMatch(outcome.forfeitUserId);
      const challengedForfeit = isChallengedMatch(outcome.forfeitUserId);
      if (!challengerForfeit && !challengedForfeit) {
        return { error: "Le joueur forfait ne correspond pas aux participants du duel.", statusCode: 400 };
      }

      const forfeitUid = challengerForfeit ? challenge.challengerUserId : challenge.challengedUserId;
      const winnerUid = challengerForfeit ? challenge.challengedUserId : challenge.challengerUserId;

      challenge.status = "FORFEIT";
      challenge.forfeitUserId = forfeitUid;
      challenge.winnerUserId = winnerUid;
      challenge.isDraw = false;
      if (outcome.cancelledByUserId) {
        challenge.cancelledByUserId = outcome.cancelledByUserId;
        challenge.cancelledAt = now;
      }
      challenge.challengerPointsDelta = challengerForfeit ? -DUEL_FORFEIT_PENALTY : DUEL_WIN_POINTS;
      challenge.challengedPointsDelta = challengedForfeit ? -DUEL_FORFEIT_PENALTY : DUEL_WIN_POINTS;
      challenge.updatedAt = now;
      await this.persistChallenge(challenge);

      if (challenger) {
        await this.updatePlayerDuelStats(
          challenger,
          challengerForfeit ? "forfeit" : "win"
        );
      }
      if (challenged) {
        await this.updatePlayerDuelStats(
          challenged,
          challengedForfeit ? "forfeit" : "win"
        );
      }
      return { challenge };
    }

    if (outcome.isDraw) {
      challenge.status = "COMPLETED";
      challenge.isDraw = true;
      challenge.winnerUserId = null;
      challenge.forfeitUserId = null;
      challenge.challengerPointsDelta = DUEL_DRAW_POINTS;
      challenge.challengedPointsDelta = DUEL_DRAW_POINTS;
      challenge.updatedAt = now;
      await this.persistChallenge(challenge);

      if (challenger) await this.updatePlayerDuelStats(challenger, "draw");
      if (challenged) await this.updatePlayerDuelStats(challenged, "draw");
      return { challenge };
    }

    if (outcome.winnerUserId) {
      const challengerWon = isChallengerMatch(outcome.winnerUserId);
      const challengedWon = isChallengedMatch(outcome.winnerUserId);
      if (!challengerWon && !challengedWon) {
        return { error: "Le vainqueur désigné ne participe pas à ce duel.", statusCode: 400 };
      }

      const winnerUid = challengerWon ? challenge.challengerUserId : challenge.challengedUserId;
      challenge.status = "COMPLETED";
      challenge.winnerUserId = winnerUid;
      challenge.forfeitUserId = null;
      challenge.isDraw = false;
      challenge.challengerPointsDelta = challengerWon ? DUEL_WIN_POINTS : 0;
      challenge.challengedPointsDelta = challengedWon ? DUEL_WIN_POINTS : 0;
      challenge.updatedAt = now;
      await this.persistChallenge(challenge);

      if (challenger) {
        await this.updatePlayerDuelStats(challenger, challengerWon ? "win" : "loss");
      }
      if (challenged) {
        await this.updatePlayerDuelStats(challenged, challengedWon ? "win" : "loss");
      }
      return { challenge };
    }

    return { error: "Veuillez préciser un vainqueur, une égalité ou un forfait.", statusCode: 400 };
  }

  private async updatePlayerDuelStats(
    user: StoredUser,
    result: "win" | "loss" | "draw" | "forfeit"
  ): Promise<void> {
    let deltaPoints = 0;
    let wonInc = 0;
    let lostInc = 0;
    let drawnInc = 0;

    if (result === "win") {
      deltaPoints = DUEL_WIN_POINTS;
      wonInc = 1;
    } else if (result === "loss") {
      deltaPoints = 0;
      lostInc = 1;
    } else if (result === "draw") {
      deltaPoints = DUEL_DRAW_POINTS;
      drawnInc = 1;
    } else if (result === "forfeit") {
      deltaPoints = -DUEL_FORFEIT_PENALTY;
      lostInc = 1;
    }

    const nextDuelPoints = (user.duelPoints || 0) + deltaPoints;
    const nextGeneralPoints = Math.max(0, (user.points || 0) + deltaPoints);
    const nextCareerPoints = Math.max(0, (user.totalCareerPoints ?? user.points ?? 0) + deltaPoints);

    await userStore.updateUser(user.id, {
      duelsWon: (user.duelsWon || 0) + wonInc,
      duelsLost: (user.duelsLost || 0) + lostInc,
      duelsDrawn: (user.duelsDrawn || 0) + drawnInc,
      duelPoints: nextDuelPoints,
      points: nextGeneralPoints,
      totalCareerPoints: nextCareerPoints,
      totalWins: (user.totalWins || 0) + wonInc,
    });
  }

  public async resolveChallenge(params: {
    challengeId: string;
    winnerUserId?: string | null;
    isDraw?: boolean;
    forfeitUserId?: string | null;
    now?: Date;
  }): Promise<{ challenge: StoredDuelChallenge } | { error: string; statusCode: number }> {
    const challenge = await this.getChallengeById(params.challengeId);
    if (!challenge) {
      return { error: "Défi introuvable.", statusCode: 404 };
    }

    if (challenge.status === "CANCELLED" || challenge.status === "REFUSED" || challenge.status === "EXPIRED") {
      return { error: `Impossible de résoudre un duel au statut '${challenge.status}'.`, statusCode: 409 };
    }

    return this.applyOutcomeToChallenge(challenge, {
      winnerUserId: params.winnerUserId,
      isDraw: params.isDraw,
      forfeitUserId: params.forfeitUserId,
      now: params.now,
    });
  }

  public async resolveDuelByRoomId(
    roomId: string,
    ranking: Array<{ userId: string; status: string; netDistance: number; estimatedTime?: number }>
  ): Promise<void> {
    if (!roomId || !ranking || ranking.length === 0) return;
    const all = await this.listAllChallenges();
    const challenge = all.find(
      (c) => (c.roomId === roomId || c.roomCode === roomId) && c.status === "ACCEPTED"
    );
    if (!challenge) return;

    const pChallenger = ranking.find(
      (r) => sameUserIdentifier(r.userId, challenge.challengerUserId) || sameUserIdentifier(r.userId, challenge.challengerLogin)
    );
    const pChallenged = ranking.find(
      (r) => sameUserIdentifier(r.userId, challenge.challengedUserId) || sameUserIdentifier(r.userId, challenge.challengedLogin)
    );

    if (pChallenger && pChallenged) {
      if (pChallenger.status === "abandoned" && pChallenged.status !== "abandoned") {
        await this.resolveChallenge({ challengeId: challenge.id, forfeitUserId: challenge.challengerUserId });
        return;
      }
      if (pChallenged.status === "abandoned" && pChallenger.status !== "abandoned") {
        await this.resolveChallenge({ challengeId: challenge.id, forfeitUserId: challenge.challengedUserId });
        return;
      }
      if (pChallenger.netDistance === pChallenged.netDistance && ranking.length >= 2) {
        await this.resolveChallenge({ challengeId: challenge.id, isDraw: true });
        return;
      }
      const winner = ranking[0];
      if (winner) {
        await this.resolveChallenge({ challengeId: challenge.id, winnerUserId: winner.userId });
      }
    } else if (pChallenger && !pChallenged) {
      await this.resolveChallenge({ challengeId: challenge.id, forfeitUserId: challenge.challengedUserId });
    } else if (!pChallenger && pChallenged) {
      await this.resolveChallenge({ challengeId: challenge.id, forfeitUserId: challenge.challengerUserId });
    }
  }

  public async getMyChallenges(userId: string, now: Date = new Date()): Promise<{
    received: StoredDuelChallenge[];
    sent: StoredDuelChallenge[];
    blockedSlots: StoredDuelChallenge[];
    stats: { duelsWon: number; duelsLost: number; duelsDrawn: number; duelPoints: number };
  }> {
    await this.expireOverdueChallenges(now);
    const user = await userStore.findUser(userId);
    const ids = new Set<string>([String(userId || "").trim().toLowerCase()]);
    if (user?.id) ids.add(user.id.trim().toLowerCase());
    if (user?.login) ids.add(user.login.trim().toLowerCase());

    const all = await this.listAllChallenges();
    const received = all
      .filter(
        (c) =>
          ids.has(String(c.challengedUserId || "").toLowerCase()) ||
          ids.has(String(c.challengedLogin || "").toLowerCase())
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const sent = all
      .filter(
        (c) =>
          ids.has(String(c.challengerUserId || "").toLowerCase()) ||
          ids.has(String(c.challengerLogin || "").toLowerCase())
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const blockedSlots = all
      .filter(
        (c) =>
          c.status === "ACCEPTED" &&
          (ids.has(String(c.challengerUserId || "").toLowerCase()) ||
            ids.has(String(c.challengerLogin || "").toLowerCase()) ||
            ids.has(String(c.challengedUserId || "").toLowerCase()) ||
            ids.has(String(c.challengedLogin || "").toLowerCase()))
      )
      .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime());

    return {
      received,
      sent,
      blockedSlots,
      stats: {
        duelsWon: user?.duelsWon || 0,
        duelsLost: user?.duelsLost || 0,
        duelsDrawn: user?.duelsDrawn || 0,
        duelPoints: user?.duelPoints || 0,
      },
    };
  }

  public async getDuelLeaderboard(filters?: {
    category?: string;
    ageCategory?: string;
    league?: string;
    country?: string;
    gender?: string;
    age?: number | string;
    minAge?: number | string;
    maxAge?: number | string;
    includeAll?: boolean;
  }): Promise<any[]> {
    const allUsers = await userStore.getAllUsers();
    const currentYear = new Date().getFullYear();

    let list = allUsers.filter((u) => {
      if (u.isRevoked) return false;
      if (filters?.includeAll) return true;
      return Boolean(
        (u.duelsWon && u.duelsWon > 0) ||
          (u.duelsLost && u.duelsLost > 0) ||
          (u.duelsDrawn && u.duelsDrawn > 0) ||
          (u.duelPoints && u.duelPoints !== 0)
      );
    });

    if (filters?.league && filters.league.trim().toLowerCase() !== "all") {
      const targetLeague = filters.league.trim().toUpperCase();
      list = list.filter((u) => {
        const tier = String(u.currentLeague || u.league || "BRONZE").toUpperCase();
        return tier === targetLeague;
      });
    }

    if (filters?.country && filters.country.trim().toLowerCase() !== "all") {
      const targetCountry = filters.country.trim().toLowerCase();
      list = list.filter((u) => String(u.country || u.pays || "").trim().toLowerCase() === targetCountry);
    }

    if (filters?.gender && filters.gender.trim().toLowerCase() !== "all") {
      const targetGender = filters.gender.trim().toLowerCase();
      list = list.filter((u) => {
        const g = String(u.gender || u.sexe || "").trim().toLowerCase();
        if (targetGender === "m" || targetGender === "homme") return g === "m" || g === "homme";
        if (targetGender === "f" || targetGender === "femme") return g === "f" || g === "femme";
        return g === targetGender;
      });
    }

    const rawCat = filters?.category || filters?.ageCategory;
    if (rawCat && rawCat.trim().toLowerCase() !== "all") {
      const cat = rawCat.trim().toUpperCase();
      list = list.filter((u) => {
        const birth = u.birthYear || u.anneeNaissance;
        if (!birth || !Number.isFinite(birth)) return false;
        const age = currentYear - birth;
        if (cat === "U19" || cat === "-19") return age < 19;
        if (cat === "19-29" || cat === "SENIOR") return age >= 19 && age <= 29;
        if (cat === "30-39" || cat === "MASTER_A") return age >= 30 && age <= 39;
        if (cat === "40-49" || cat === "MASTER_B") return age >= 40 && age <= 49;
        if (cat === "50-59" || cat === "MASTER_C") return age >= 50 && age <= 59;
        if (cat === "60+" || cat === "MASTER_D") return age >= 60;
        return true;
      });
    }

    if (filters?.age !== undefined && filters.age !== "" && filters.age !== "all") {
      const targetAge = Number(filters.age);
      if (Number.isFinite(targetAge)) {
        list = list.filter((u) => {
          const birth = u.birthYear || u.anneeNaissance;
          return Boolean(birth && currentYear - birth === targetAge);
        });
      }
    }

    if (filters?.minAge !== undefined && filters.minAge !== "") {
      const minA = Number(filters.minAge);
      if (Number.isFinite(minA)) {
        list = list.filter((u) => {
          const birth = u.birthYear || u.anneeNaissance;
          return Boolean(birth && currentYear - birth >= minA);
        });
      }
    }

    if (filters?.maxAge !== undefined && filters.maxAge !== "") {
      const maxA = Number(filters.maxAge);
      if (Number.isFinite(maxA)) {
        list = list.filter((u) => {
          const birth = u.birthYear || u.anneeNaissance;
          return Boolean(birth && currentYear - birth <= maxA);
        });
      }
    }

    list.sort((a, b) => {
      const wonDiff = (b.duelsWon || 0) - (a.duelsWon || 0);
      if (wonDiff !== 0) return wonDiff;
      const ptsDiff = (b.duelPoints || 0) - (a.duelPoints || 0);
      if (ptsDiff !== 0) return ptsDiff;
      return (a.duelsLost || 0) - (b.duelsLost || 0);
    });

    return list.slice(0, 100).map((u, idx) => {
      const birth = u.birthYear || u.anneeNaissance || null;
      const age = birth ? currentYear - birth : null;
      return {
        rank: idx + 1,
        id: u.id,
        login: u.login || u.id,
        name: u.name || u.login || u.id,
        currentLeague: String(u.currentLeague || u.league || "BRONZE").toUpperCase(),
        country: u.country || u.pays || "",
        gender: u.gender || u.sexe || "",
        birthYear: birth,
        age,
        duelsWon: u.duelsWon || 0,
        duelsLost: u.duelsLost || 0,
        duelsDrawn: u.duelsDrawn || 0,
        duelPoints: u.duelPoints || 0,
        totalDuels: (u.duelsWon || 0) + (u.duelsLost || 0) + (u.duelsDrawn || 0),
        acceptsDuels: sanitizeDuelPreferences(u.duelPreferences).acceptsDuels,
      };
    });
  }
}

export default DuelService.getInstance();
