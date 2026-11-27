import db from "../models";
import { hashPassword } from "./auth.service";
import userStore from "./user-store.service";

const Users = db.users;
const PublicRaceSettings = db.publicRaceSettings;
const SubscriptionPlans = db.subscriptionPlans;

export class AdminInitService {
  /**
   * Point d'entrée principal appelé au démarrage du serveur après db.sequelize.sync()
   */
  public static async init(): Promise<void> {
    try {
      console.log("[AdminInit] Initialisation du schéma d'administration et des données par défaut...");
      await this.ensureTablesAndColumns();
      await this.ensurePublicRaceSettings();
      await this.ensureSubscriptionPlans();
      await this.ensureDefaultAdmin();
      console.log("[AdminInit] Initialisation administrative terminée avec succès.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[AdminInit] Avertissement / Erreur lors de l'initialisation administrative:", message);
    }
  }

  /**
   * 1. Vérification & ajout idempotent des colonnes sur les tables existantes
   */
  public static async ensureTablesAndColumns(): Promise<void> {
    try {
      await db.sequelize.query(`
        DO $$
        BEGIN
          -- Colonnes sur rower_race_users
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'rower_race_users') THEN
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'role') THEN
              ALTER TABLE rower_race_users ADD COLUMN role VARCHAR(20) DEFAULT 'USER';
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'is_revoked') THEN
              ALTER TABLE rower_race_users ADD COLUMN is_revoked BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'subscription_tier') THEN
              ALTER TABLE rower_race_users ADD COLUMN subscription_tier VARCHAR(32) DEFAULT 'free';
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'is_subscriber') THEN
              ALTER TABLE rower_race_users ADD COLUMN is_subscriber BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'is_admin') THEN
              ALTER TABLE rower_race_users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'subscription_status') THEN
              ALTER TABLE rower_race_users ADD COLUMN subscription_status VARCHAR(32) DEFAULT 'none';
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'custom_concurrent_rooms') THEN
              ALTER TABLE rower_race_users ADD COLUMN custom_concurrent_rooms INTEGER NULL;
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'custom_weekly_rooms') THEN
              ALTER TABLE rower_race_users ADD COLUMN custom_weekly_rooms INTEGER NULL;
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'is_pioneer') THEN
              ALTER TABLE rower_race_users ADD COLUMN is_pioneer BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'rower_race_users' AND column_name = 'pioneer_activated_at') THEN
              ALTER TABLE rower_race_users ADD COLUMN pioneer_activated_at TIMESTAMP NULL;
            END IF;
          END IF;

          -- Colonnes sur subscription_plans : mode Pionnier par offre
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'subscription_plans') THEN
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'subscription_plans' AND column_name = 'is_pioneer_enabled') THEN
              ALTER TABLE subscription_plans ADD COLUMN is_pioneer_enabled BOOLEAN DEFAULT ${process.env.LAUNCH_PIONEER_MODE !== "false" ? "TRUE" : "FALSE"};
            END IF;
          END IF;

          -- Colonnes sur users (si présente)
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') THEN
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role') THEN
              ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'USER';
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_revoked') THEN
              ALTER TABLE users ADD COLUMN is_revoked BOOLEAN DEFAULT FALSE;
            END IF;
          END IF;
          -- Colonnes sur public_race_settings
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'public_race_settings') THEN
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'public_race_settings' AND column_name = 'overtake_threshold_m') THEN
              ALTER TABLE public_race_settings ADD COLUMN overtake_threshold_m INTEGER DEFAULT 5;
            END IF;
            IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'public_race_settings' AND column_name = 'inactivity_abandon_sec') THEN
              ALTER TABLE public_race_settings ADD COLUMN inactivity_abandon_sec INTEGER DEFAULT 60;
            END IF;
          END IF;
        END $$;
      `);
    } catch (err: unknown) {
      // Tolérance si dialecte ou permissions limitées
      console.log("[AdminInit] Colonnes vérifiées via Sequelize sync.");
    }
  }

  /**
   * 2. Table de configuration des courses publiques (public_race_settings) : ligne unique id=1
   */
  public static async ensurePublicRaceSettings(): Promise<void> {
    try {
      const [setting, created] = await PublicRaceSettings.findOrCreate({
        where: { id: 1 },
        defaults: {
          id: 1,
          isEnabled: true,
          raceDistanceM: 1000,
          maxDurationSec: 600,
          maxPlayers: 6,
          botCount: 2,
          interRaceDelaySec: 120,
          overtakeThresholdM: 5,
          inactivityAbandonSec: 60,
        },
      });
      if (setting) {
        const plain: any = typeof setting.toJSON === "function" ? setting.toJSON() : setting;
        const updates: any = {};
        if (plain.overtakeThresholdM === undefined && plain.overtake_threshold_m === undefined) {
          updates.overtakeThresholdM = 5;
        }
        if (plain.inactivityAbandonSec === undefined && plain.inactivity_abandon_sec === undefined) {
          updates.inactivityAbandonSec = 60;
        }
        if (Object.keys(updates).length > 0) {
          await setting.update(updates);
        }
      }
      if (created) {
        console.log("[AdminInit] Configuration des courses publiques par défaut créée (id=1).");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[AdminInit] Erreur initialisation public_race_settings:", message);
    }
  }

  /**
   * 3. Table des offres et quotas (subscription_plans) : FREE, COMPETITOR, CLUB_ELITE
   */
  public static async ensureSubscriptionPlans(): Promise<void> {
    const defaultPlans = [
      {
        code: "FREE",
        name: "Découverte",
        description: "Accès de base : 1 bot, courses 2 000 m max, 2 joueurs par salon privé, 2 salons/semaine.",
        priceMonthly: 0,
        priceYearly: 0,
        maxBotsPerRace: 1,
        maxRaceDistanceM: 2000,
        maxPlayersPerRoom: 2,
        maxConcurrentRooms: 1,
        maxRoomsPerWeek: 2,
        canCreateDuel1v1: true,
        canScheduleRaces: false,
        isActive: true,
      },
      {
        code: "COMPETITOR",
        name: "Compétiteur",
        description: "Offre Compétiteur : jusqu'à 3 bots, 5 000 m, 5 rameurs par salon, 5 salons/semaine, ligues Argent/Or & planification horaire.",
        priceMonthly: 5.99,
        priceYearly: 59.99,
        maxBotsPerRace: 3,
        maxRaceDistanceM: 5000,
        maxPlayersPerRoom: 5,
        maxConcurrentRooms: 3,
        maxRoomsPerWeek: 5,
        canCreateDuel1v1: true,
        canScheduleRaces: true,
        isActive: true,
      },
      {
        code: "CLUB_ELITE",
        name: "Club / Élite",
        description: "Accès total : 5 bots configurables, 10 000 m, 10 rameurs par salon, 10 salons/semaine, export complet et support prioritaire.",
        priceMonthly: 8.99,
        priceYearly: 89.99,
        maxBotsPerRace: 5,
        maxRaceDistanceM: 10000,
        maxPlayersPerRoom: 10,
        maxConcurrentRooms: 5,
        maxRoomsPerWeek: 10,
        canCreateDuel1v1: true,
        canScheduleRaces: true,
        isActive: true,
      },
    ];

    for (const plan of defaultPlans) {
      try {
        const [planRow, created] = await SubscriptionPlans.findOrCreate({
          where: { code: plan.code },
          defaults: plan as any,
        });
        if (!created && planRow) {
          await planRow.update({
            name: plan.name,
            description: plan.description,
            priceMonthly: plan.priceMonthly,
            priceYearly: plan.priceYearly,
            maxBotsPerRace: plan.maxBotsPerRace,
            maxRaceDistanceM: plan.maxRaceDistanceM,
            maxPlayersPerRoom: plan.maxPlayersPerRoom,
            maxConcurrentRooms: plan.maxConcurrentRooms,
            maxRoomsPerWeek: plan.maxRoomsPerWeek,
            canCreateDuel1v1: plan.canCreateDuel1v1,
            canScheduleRaces: plan.canScheduleRaces,
          });
        }
        if (created) {
          console.log(`[AdminInit] Offre par défaut ${plan.code} (${plan.name}) initialisée.`);
        }
      } catch (err: unknown) {
        console.warn(`[AdminInit] Offre ${plan.code} vérifiée.`);
      }
    }

    // Migration transparente des anciens codes STANDARD et PREMIUM si présents
    try {
      const legacyStandard = await SubscriptionPlans.findOne({ where: { code: "STANDARD" } });
      if (legacyStandard) {
        await legacyStandard.update({
          name: "Compétiteur",
          maxRoomsPerWeek: 5,
          maxPlayersPerRoom: 5,
          maxRaceDistanceM: 5000,
        });
      }
      const legacyPremium = await SubscriptionPlans.findOne({ where: { code: "PREMIUM" } });
      if (legacyPremium) {
        await legacyPremium.update({
          name: "Club / Élite",
          maxRoomsPerWeek: 10,
          maxPlayersPerRoom: 10,
          maxRaceDistanceM: 10000,
        });
      }
    } catch {}
  }

  /**
   * 4. Initialisation Idempotente du Compte Administrateur par Défaut
   */
  public static async ensureDefaultAdmin(): Promise<void> {
    const adminEmail = (process.env.ADMIN_DEFAULT_EMAIL || "admin@rowerrace.com").trim().toLowerCase();
    const adminUsername = (process.env.ADMIN_DEFAULT_USERNAME || "Admin_RowerRace").trim();
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || "RowerAdmin2026!";

    try {
      // 1. Recherche par login ou email via userStore (gère DB + mémoire de façon transparente)
      let existingByEmail = await userStore.findUserByEmail(adminEmail);
      let existingByUsername = await userStore.findUser(adminUsername);
      let existingUser = existingByEmail || existingByUsername;

      if (!existingUser) {
        try {
          const dbUser = await Users.findOne({ where: { email: adminEmail } });
          if (dbUser) {
            existingUser = await userStore.findUser(dbUser.get("id") as string);
          }
        } catch {}
      }

      if (!existingUser) {
        // Aucun administrateur existant : création du compte par défaut
        const { hash, salt } = hashPassword(adminPassword);
        const adminId = `usr_${adminUsername.toLowerCase()}`;

        await userStore.createUser({
          id: adminId,
          login: adminUsername,
          name: adminUsername,
          email: adminEmail,
          passwordHash: hash,
          passwordSalt: salt,
          role: "ADMIN",
          isAdmin: true,
          isRevoked: false,
          isSubscriber: true,
          subscriptionTier: "premium",
          subscriptionStatus: "active",
          isConfirmed: true,
        });

        console.log(`[INIT] Compte administrateur par défaut vérifié/créé (${adminEmail})`);
      } else {
        // Le compte existe déjà : s'assurer qu'il a bien le rôle ADMIN sans toucher à son mot de passe existant
        if (existingUser.role !== "ADMIN" || !existingUser.isAdmin) {
          await userStore.updateUser(existingUser.id, {
            role: "ADMIN",
            isAdmin: true,
            isSubscriber: true,
            isRevoked: false,
          });
          console.log(`[INIT] Droits administrateurs confirmés pour le compte existant (${adminEmail})`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[AdminInit] Erreur lors de la vérification du compte admin par défaut:", message);
    }
  }
}

export default AdminInitService;
