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
}

const DEFAULT_FALLBACK_LIMITS: Record<string, PlanLimits> = {
  free: {
    code: "FREE",
    name: "Offre Gratuite",
    maxBots: 1,
    maxDistance: 2000,
    maxParticipants: 2,
    maxConcurrentRooms: 1,
    maxWeeklyRooms: 5,
    canCreateDuel1v1: true,
    canScheduleRaces: false,
    priceMonthly: 0,
    priceYearly: 0,
    isActive: true,
  },
  intermediate: {
    code: "STANDARD",
    name: "Offre Club",
    maxBots: 3,
    maxDistance: 5000,
    maxParticipants: 5,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 10,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 5.99,
    priceYearly: 59.99,
    isActive: true,
  },
  standard: {
    code: "STANDARD",
    name: "Offre Club",
    maxBots: 3,
    maxDistance: 5000,
    maxParticipants: 5,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 10,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 5.99,
    priceYearly: 59.99,
    isActive: true,
  },
  club: {
    code: "STANDARD",
    name: "Offre Club",
    maxBots: 3,
    maxDistance: 5000,
    maxParticipants: 5,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 10,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 5.99,
    priceYearly: 59.99,
    isActive: true,
  },
  premium: {
    code: "PREMIUM",
    name: "Offre Élite Pro",
    maxBots: 5,
    maxDistance: 10000,
    maxParticipants: 10,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 15,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 8.99,
    priceYearly: 89.99,
    isActive: true,
  },
  pro: {
    code: "PREMIUM",
    name: "Offre Élite Pro",
    maxBots: 5,
    maxDistance: 10000,
    maxParticipants: 10,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 15,
    canCreateDuel1v1: true,
    canScheduleRaces: true,
    priceMonthly: 8.99,
    priceYearly: 89.99,
    isActive: true,
  },
  elite_pro: {
    code: "PREMIUM",
    name: "Offre Élite Pro",
    maxBots: 5,
    maxDistance: 10000,
    maxParticipants: 10,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 15,
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
    if (lookupCode === "INTERMEDIATE" || lookupCode === "CLUB") lookupCode = "STANDARD";
    if (lookupCode === "PRO" || lookupCode === "ELITE_PRO") lookupCode = "PREMIUM";

    const dbPlan = this.cachedPlans.get(lookupCode);
    if (dbPlan) {
      return {
        code: dbPlan.code,
        name: dbPlan.name,
        maxBots: Number(dbPlan.maxBotsPerRace || dbPlan.max_bots_per_race || 1),
        maxDistance: Number(dbPlan.maxRaceDistanceM || dbPlan.max_race_distance_m || 2000),
        maxParticipants: Number(dbPlan.maxPlayersPerRoom || dbPlan.max_players_per_room || 2),
        maxConcurrentRooms: Number(dbPlan.maxConcurrentRooms || dbPlan.max_concurrent_rooms || 1),
        maxWeeklyRooms: Number(dbPlan.maxRoomsPerWeek || dbPlan.max_rooms_per_week || 5),
        canCreateDuel1v1: Boolean(dbPlan.canCreateDuel1v1 ?? dbPlan.can_create_duel_1v1 ?? true),
        canScheduleRaces: Boolean(dbPlan.canScheduleRaces ?? dbPlan.can_schedule_races ?? false),
        priceMonthly: Number(dbPlan.priceMonthly || dbPlan.price_monthly || 0),
        priceYearly: Number(dbPlan.priceYearly || dbPlan.price_yearly || 0),
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
    if (lookupCode === "INTERMEDIATE" || lookupCode === "CLUB") lookupCode = "STANDARD";
    if (lookupCode === "PRO" || lookupCode === "ELITE_PRO") lookupCode = "PREMIUM";

    const dbPlan = this.cachedPlans.get(lookupCode);
    if (dbPlan) {
      return dbPlan.isActive !== undefined ? Boolean(dbPlan.isActive) : (dbPlan.is_active !== undefined ? Boolean(dbPlan.is_active) : true);
    }

    const fallbackKey = lookupCode === "STANDARD" ? "intermediate" : (lookupCode === "PREMIUM" ? "premium" : clean);
    const fb = DEFAULT_FALLBACK_LIMITS[fallbackKey];
    return fb && fb.isActive !== undefined ? Boolean(fb.isActive) : true;
  }

  public async setPlanActive(code: string, targetActive?: boolean): Promise<boolean> {
    let lookupCode = (code || "").trim().toUpperCase();
    if (lookupCode === "INTERMEDIATE" || lookupCode === "CLUB") lookupCode = "STANDARD";
    if (lookupCode === "PRO" || lookupCode === "ELITE_PRO") lookupCode = "PREMIUM";

    await this.loadAllPlans();
    const existing = this.cachedPlans.get(lookupCode);
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
