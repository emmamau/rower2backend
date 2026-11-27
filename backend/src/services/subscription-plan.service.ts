import db from "../models";

const SubscriptionPlans = db.subscriptionPlans;

export interface PlanLimits {
  code: string;
  name: string;
  maxBots: number;
  maxDistance: number;
  maxParticipants: number;
  maxConcurrentRooms: number;
  maxWeeklyRooms: number;
  canCreateDuel1v1: boolean;
  canScheduleRaces: boolean;
  priceMonthly: number;
  priceYearly: number;
  isActive?: boolean;
  isPioneerEnabled?: boolean;
}

const DEFAULT_FALLBACK_LIMITS: Record<string, PlanLimits> = {
  free: {
    code: "FREE",
    name: "Découverte",
    maxBots: 1,
    maxDistance: 2000,
    maxParticipants: 2,
    maxConcurrentRooms: 1,
    maxWeeklyRooms: 2,
    canCreateDuel1v1: true,
    canScheduleRaces: false,
    priceMonthly: 0,
    priceYearly: 0,
    isActive: true,
  },
  competitor: {
    code: "COMPETITOR",
    name: "Compétiteur",
    maxBots: 3,
    maxDistance: 5000,
    maxParticipants: 5,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 5,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 5.99,
    priceYearly: 59.99,
    isActive: true,
  },
  intermediate: {
    code: "COMPETITOR",
    name: "Compétiteur",
    maxBots: 3,
    maxDistance: 5000,
    maxParticipants: 5,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 5,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 5.99,
    priceYearly: 59.99,
    isActive: true,
  },
  standard: {
    code: "COMPETITOR",
    name: "Compétiteur",
    maxBots: 3,
    maxDistance: 5000,
    maxParticipants: 5,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 5,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 5.99,
    priceYearly: 59.99,
    isActive: true,
  },
  club: {
    code: "COMPETITOR",
    name: "Compétiteur",
    maxBots: 3,
    maxDistance: 5000,
    maxParticipants: 5,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 5,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 5.99,
    priceYearly: 59.99,
    isActive: true,
  },
  club_elite: {
    code: "CLUB_ELITE",
    name: "Club / Élite",
    maxBots: 5,
    maxDistance: 10000,
    maxParticipants: 10,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 10,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 8.99,
    priceYearly: 89.99,
    isActive: true,
  },
  premium: {
    code: "CLUB_ELITE",
    name: "Club / Élite",
    maxBots: 5,
    maxDistance: 10000,
    maxParticipants: 10,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 10,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 8.99,
    priceYearly: 89.99,
    isActive: true,
  },
  pro: {
    code: "CLUB_ELITE",
    name: "Club / Élite",
    maxBots: 5,
    maxDistance: 10000,
    maxParticipants: 10,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 10,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 8.99,
    priceYearly: 89.99,
    isActive: true,
  },
  elite_pro: {
    code: "CLUB_ELITE",
    name: "Club / Élite",
    maxBots: 5,
    maxDistance: 10000,
    maxParticipants: 10,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 10,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 8.99,
    priceYearly: 89.99,
    isActive: true,
  },
};

export class SubscriptionPlanService {
  private static instance: SubscriptionPlanService;
  private cachedPlans: Map<string, any> = new Map();
  private lastFetched: number = 0;
  private readonly TTL_MS = 30000; // 30 secondes

  private constructor() {}

  public static getInstance(): SubscriptionPlanService {
    if (!SubscriptionPlanService.instance) {
      SubscriptionPlanService.instance = new SubscriptionPlanService();
    }
    return SubscriptionPlanService.instance;
  }

  public invalidateCache(): void {
    this.cachedPlans.clear();
    this.lastFetched = 0;
  }

  public async loadAllPlans(): Promise<any[]> {
    const now = Date.now();
    if (this.cachedPlans.size > 0 && now - this.lastFetched < this.TTL_MS) {
      return Array.from(this.cachedPlans.values());
    }

    try {
      const rows = await SubscriptionPlans.findAll({ order: [["priceMonthly", "ASC"]] });
      if (rows && rows.length > 0) {
        this.cachedPlans.clear();
        for (const row of rows) {
          const plain: any = typeof (row as any).toJSON === "function" ? (row as any).toJSON() : row;
          this.cachedPlans.set(String(plain.code).toUpperCase(), plain);
        }
        this.lastFetched = now;
        return Array.from(this.cachedPlans.values());
      }
    } catch (err: unknown) {
      // Tolérance DB
    }

    return Object.values(DEFAULT_FALLBACK_LIMITS);
  }

  public async getLimitsForTier(tierOrUser?: any): Promise<PlanLimits> {
    let tierCode = "free";
    if (typeof tierOrUser === "string") {
      tierCode = tierOrUser.trim().toLowerCase();
    } else if (tierOrUser && typeof tierOrUser === "object") {
      tierCode = (tierOrUser.subscriptionTier || tierOrUser.subscription_tier || (tierOrUser.isSubscriber ? "intermediate" : "free")).trim().toLowerCase();
    }

    await this.loadAllPlans();

    // Mapping code normalisé
    let lookupCode = tierCode.toUpperCase();
    if (lookupCode === "INTERMEDIATE" || lookupCode === "CLUB" || lookupCode === "STANDARD") lookupCode = "COMPETITOR";
    if (lookupCode === "PREMIUM" || lookupCode === "PRO" || lookupCode === "ELITE_PRO") lookupCode = "CLUB_ELITE";

    let dbPlan = this.cachedPlans.get(lookupCode);
    if (!dbPlan && lookupCode === "COMPETITOR") {
      dbPlan = this.cachedPlans.get("STANDARD");
    }
    if (!dbPlan && lookupCode === "CLUB_ELITE") {
      dbPlan = this.cachedPlans.get("PREMIUM");
    }
    if (dbPlan) {
      return {
        code: dbPlan.code,
        name: dbPlan.name,
        maxBots: Number(dbPlan.maxBotsPerRace || dbPlan.max_bots_per_race || (lookupCode === "CLUB_ELITE" ? 5 : (lookupCode === "COMPETITOR" ? 3 : 1))),
        maxDistance: Number(dbPlan.maxRaceDistanceM || dbPlan.max_race_distance_m || (lookupCode === "CLUB_ELITE" ? 10000 : (lookupCode === "COMPETITOR" ? 5000 : 2000))),
        maxParticipants: Number(dbPlan.maxPlayersPerRoom || dbPlan.max_players_per_room || (lookupCode === "CLUB_ELITE" ? 10 : (lookupCode === "COMPETITOR" ? 5 : 2))),
        maxConcurrentRooms: Number(dbPlan.maxConcurrentRooms || dbPlan.max_concurrent_rooms || (lookupCode === "CLUB_ELITE" ? 5 : (lookupCode === "COMPETITOR" ? 3 : 1))),
        maxWeeklyRooms: Number(dbPlan.maxRoomsPerWeek || dbPlan.max_rooms_per_week || (lookupCode === "CLUB_ELITE" ? 10 : (lookupCode === "COMPETITOR" ? 5 : 2))),
        canCreateDuel1v1: Boolean(dbPlan.canCreateDuel1v1 ?? dbPlan.can_create_duel_1v1 ?? true),
        canScheduleRaces: Boolean(dbPlan.canScheduleRaces ?? dbPlan.can_schedule_races ?? (lookupCode !== "FREE")),
        priceMonthly: Number(dbPlan.priceMonthly || dbPlan.price_monthly || (lookupCode === "CLUB_ELITE" ? 8.99 : (lookupCode === "COMPETITOR" ? 5.99 : 0))),
        priceYearly: Number(dbPlan.priceYearly || dbPlan.price_yearly || (lookupCode === "CLUB_ELITE" ? 89.99 : (lookupCode === "COMPETITOR" ? 59.99 : 0))),
        isActive: dbPlan.isActive !== undefined ? Boolean(dbPlan.isActive) : (dbPlan.is_active !== undefined ? Boolean(dbPlan.is_active) : true),
      };
    }

    return DEFAULT_FALLBACK_LIMITS[tierCode] || DEFAULT_FALLBACK_LIMITS.free;
  }

  public async isTierActive(tierCode: string): Promise<boolean> {
    const clean = (tierCode || "free").trim().toLowerCase();
    if (clean === "free") return true;

    await this.loadAllPlans();

    let lookupCode = clean.toUpperCase();
    if (lookupCode === "INTERMEDIATE" || lookupCode === "CLUB" || lookupCode === "STANDARD") lookupCode = "COMPETITOR";
    if (lookupCode === "PRO" || lookupCode === "ELITE_PRO") lookupCode = "CLUB_ELITE";

    let dbPlan = this.cachedPlans.get(lookupCode);
    if (!dbPlan && lookupCode === "COMPETITOR") {
      dbPlan = this.cachedPlans.get("STANDARD");
    }
    if (!dbPlan && lookupCode === "CLUB_ELITE") {
      dbPlan = this.cachedPlans.get("PREMIUM");
    }
    if (dbPlan) {
      return dbPlan.isActive !== undefined ? Boolean(dbPlan.isActive) : (dbPlan.is_active !== undefined ? Boolean(dbPlan.is_active) : true);
    }

    const fallbackKey = lookupCode === "COMPETITOR" ? "competitor" : (lookupCode === "CLUB_ELITE" ? "club_elite" : clean);
    const fb = DEFAULT_FALLBACK_LIMITS[fallbackKey];
    return fb && fb.isActive !== undefined ? Boolean(fb.isActive) : true;
  }

  private normalizeLookupCode(code: string): string {
    let lookupCode = (code || "").trim().toUpperCase();
    if (lookupCode === "INTERMEDIATE" || lookupCode === "CLUB" || lookupCode === "STANDARD") lookupCode = "COMPETITOR";
    if (lookupCode === "PREMIUM" || lookupCode === "PRO" || lookupCode === "ELITE_PRO") lookupCode = "CLUB_ELITE";
    return lookupCode;
  }

  /** Mode « Pionnier gratuit » activé pour cette offre (la Découverte n'a pas de mode Pionnier). */
  public async isPioneerEnabledForTier(tierCode: string): Promise<boolean> {
    const lookupCode = this.normalizeLookupCode(tierCode || "free");
    if (lookupCode === "FREE") return false;

    await this.loadAllPlans();
    let dbPlan = this.cachedPlans.get(lookupCode);
    if (!dbPlan && lookupCode === "COMPETITOR") dbPlan = this.cachedPlans.get("STANDARD");
    if (!dbPlan && lookupCode === "CLUB_ELITE") dbPlan = this.cachedPlans.get("PREMIUM");
    if (dbPlan) {
      const v = dbPlan.isPioneerEnabled ?? dbPlan.is_pioneer_enabled;
      return v === undefined || v === null ? true : Boolean(v);
    }
    const fallbackKey = lookupCode === "COMPETITOR" ? "competitor" : "club_elite";
    const fb = DEFAULT_FALLBACK_LIMITS[fallbackKey];
    return fb && fb.isPioneerEnabled !== undefined ? Boolean(fb.isPioneerEnabled) : true;
  }

  /** Une offre est souscrivable si elle est activée en payant OU en Pionnier. La Découverte l'est toujours. */
  public async isTierSubscribable(tierCode: string): Promise<boolean> {
    if (this.normalizeLookupCode(tierCode || "free") === "FREE") return true;
    return (await this.isTierActive(tierCode)) || (await this.isPioneerEnabledForTier(tierCode));
  }

  public async setPlanPioneerEnabled(code: string, targetEnabled?: boolean): Promise<boolean> {
    const lookupCode = this.normalizeLookupCode(code);
    await this.loadAllPlans();
    let existing = this.cachedPlans.get(lookupCode);
    if (!existing && lookupCode === "COMPETITOR") existing = this.cachedPlans.get("STANDARD");
    if (!existing && lookupCode === "CLUB_ELITE") existing = this.cachedPlans.get("PREMIUM");
    const current = existing
      ? ((existing.isPioneerEnabled ?? existing.is_pioneer_enabled) !== false)
      : true;
    const next = targetEnabled !== undefined ? Boolean(targetEnabled) : !current;

    if (existing) {
      existing.isPioneerEnabled = next;
      existing.is_pioneer_enabled = next;
    }
    for (const key of Object.keys(DEFAULT_FALLBACK_LIMITS)) {
      if (DEFAULT_FALLBACK_LIMITS[key].code?.toUpperCase() === lookupCode) {
        DEFAULT_FALLBACK_LIMITS[key].isPioneerEnabled = next;
      }
    }
    return next;
  }

  public async setPlanActive(code: string, targetActive?: boolean): Promise<boolean> {
    let lookupCode = (code || "").trim().toUpperCase();
    if (lookupCode === "INTERMEDIATE" || lookupCode === "CLUB" || lookupCode === "STANDARD") lookupCode = "COMPETITOR";
    if (lookupCode === "PREMIUM" || lookupCode === "PRO" || lookupCode === "ELITE_PRO") lookupCode = "CLUB_ELITE";

    await this.loadAllPlans();
    let existing = this.cachedPlans.get(lookupCode);
    if (!existing && lookupCode === "COMPETITOR") existing = this.cachedPlans.get("STANDARD");
    if (!existing && lookupCode === "CLUB_ELITE") existing = this.cachedPlans.get("PREMIUM");
    const currentActive = existing ? (existing.isActive !== false && existing.is_active !== false) : true;
    const newActive = targetActive !== undefined ? Boolean(targetActive) : !currentActive;

    if (existing) {
      existing.isActive = newActive;
      existing.is_active = newActive;
      this.cachedPlans.set(lookupCode, existing);
    }

    for (const key of Object.keys(DEFAULT_FALLBACK_LIMITS)) {
      if (DEFAULT_FALLBACK_LIMITS[key].code?.toUpperCase() === lookupCode) {
        DEFAULT_FALLBACK_LIMITS[key].isActive = newActive;
      }
    }

    return newActive;
  }
}

export default SubscriptionPlanService.getInstance();
