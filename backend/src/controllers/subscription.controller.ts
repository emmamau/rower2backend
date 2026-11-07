import { Request, Response } from "express";
import crypto from "crypto";
import userStore from "../services/user-store.service";
import { isEmmaAdminUser } from "../services/auth.service";

export interface SubscriptionTierConfig {
  id: "free" | "intermediate" | "premium";
  name: string;
  priceEur: number;
  priceFormatted: string;
  maxGuests: number;
  maxParticipants: number;
  maxDistance: number;
  maxBots: number;
  historyDays: number | null; // null = unlimited
  customPrefixAllowed: boolean;
  features: string[];
}

export const SUBSCRIPTION_TIERS: Record<string, SubscriptionTierConfig> = {
  free: {
    id: "free",
    name: "Offre Gratuite",
    priceEur: 0,
    priceFormatted: "0 €",
    maxGuests: 1,
    maxParticipants: 2,
    maxDistance: 2000,
    maxBots: 1,
    historyDays: 10,
    customPrefixAllowed: false,
    features: [
      "1 joueur invité en salon privé (2 coureurs max)",
      "Courses jusqu'à 2 000 m (2 km)",
      "1 bot d'entraînement",
      "Historique des courses sur 10 jours",
      "Classement public et cockpit direct",
    ],
  },
  intermediate: {
    id: "intermediate",
    name: "Offre Club",
    priceEur: 5.99,
    priceFormatted: "5,99 € / mois",
    maxGuests: 5,
    maxParticipants: 5,
    maxDistance: 5000,
    maxBots: 3,
    historyDays: null,
    customPrefixAllowed: true,
    features: [
      "Jusqu'à 5 joueurs dans vos salons privés",
      "Courses jusqu'à 5 000 m (5 km)",
      "Jusqu'à 3 bots avec allure configurable",
      "Historique illimité des courses et classements",
      "Personnalisation de votre préfixe joueur",
      "Départ manuel ou programmé à date/heure précise",
    ],
  },
  premium: {
    id: "premium",
    name: "Offre Élite Pro",
    priceEur: 8.99,
    priceFormatted: "8,99 € / mois",
    maxGuests: 10,
    maxParticipants: 10,
    maxDistance: 10000,
    maxBots: 5,
    historyDays: null,
    customPrefixAllowed: true,
    features: [
      "Jusqu'à 10 joueurs dans vos salons privés",
      "Courses longue distance jusqu'à 10 000 m (10 km)",
      "Jusqu'à 5 bots avec allure de course max",
      "Historique illimité et export des statistiques",
      "Personnalisation intégrale de l'identifiant joueur",
      "Tous modes de départ (top départ ou heure programmée)",
      "Accès prioritaire aux nouvelles fonctionnalités",
    ],
  },
};

/**
 * GET /api/v1/subscriptions/tiers
 * Retourne les 3 offres d'abonnement officielles et leurs caractéristiques
 */
export const getSubscriptionTiers = (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    tiers: Object.values(SUBSCRIPTION_TIERS),
  });
};

/**
 * GET /api/v1/subscriptions/status/:userId
 * Récupère le statut d'abonnement actif d'un utilisateur et ses quotas
 */
export const getUserSubscriptionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const user = await userStore.findUser(userId);

    const isEmma = user ? isEmmaAdminUser(user.login || user.id, user.name) : isEmmaAdminUser(userId);
    const tierId: "free" | "intermediate" | "premium" = isEmma
      ? "premium"
      : (user?.subscriptionTier as any) || (user?.isSubscriber ? "intermediate" : "free");

    const tierConfig = SUBSCRIPTION_TIERS[tierId] || SUBSCRIPTION_TIERS.free;

    res.status(200).json({
      success: true,
      userId,
      tier: tierId,
      status: isEmma ? "active" : user?.subscriptionStatus || (user?.isSubscriber ? "active" : "none"),
      isSubscriber: Boolean(user?.isSubscriber || isEmma),
      isAdmin: Boolean(user?.isAdmin || isEmma),
      limits: tierConfig,
      lemonCustomerId: user?.lemonCustomerId || null,
      lemonSubscriptionId: user?.lemonSubscriptionId || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur statut abonnement: " + message });
  }
};

/**
 * POST /api/v1/subscriptions/checkout
 * Initialise une session de paiement Lemon Squeezy pour une mise à niveau d'abonnement
 */
export const createCheckoutSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, tier, returnUrl } = req.body || {};
    const cleanUserId = String(userId || "").trim();
    const cleanTier = String(tier || "").toLowerCase();

    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est obligatoire." });
      return;
    }

    if (!["intermediate", "premium", "free"].includes(cleanTier)) {
      res.status(400).json({ success: false, message: "Offre invalide (free, intermediate ou premium)." });
      return;
    }

    const user = await userStore.findUser(cleanUserId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur non trouvé." });
      return;
    }

    // Si sélection de l'offre gratuite
    if (cleanTier === "free") {
      await userStore.updateUser(user.id, {
        subscriptionTier: "free",
        subscriptionStatus: "active",
        isSubscriber: false,
      });
      res.status(200).json({
        success: true,
        message: "Passage au plan gratuit effectué.",
        tier: "free",
      });
      return;
    }

    const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    const variantId =
      cleanTier === "premium"
        ? process.env.LEMON_SQUEEZY_VARIANT_PREMIUM
        : process.env.LEMON_SQUEEZY_VARIANT_INTERMEDIATE;

    const successRedirectUrl =
      returnUrl || `${req.protocol}://${req.get("host")}/?subscription=success&tier=${cleanTier}`;

    // Si les clés d'API Lemon Squeezy sont configurées en production
    if (apiKey && storeId && variantId) {
      try {
        const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
          method: "POST",
          headers: {
            Accept: "application/vnd.api+json",
            "Content-Type": "application/vnd.api+json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            data: {
              type: "checkouts",
              attributes: {
                checkout_data: {
                  email: user.email || undefined,
                  name: user.name || user.login,
                  custom: {
                    user_id: user.id,
                    tier: cleanTier,
                  },
                },
                product_options: {
                  redirect_url: successRedirectUrl,
                },
              },
              relationships: {
                store: {
                  data: {
                    type: "stores",
                    id: String(storeId),
                  },
                },
                variant: {
                  data: {
                    type: "variants",
                    id: String(variantId),
                  },
                },
              },
            },
          }),
        });

        const data: any = await response.json();
        const checkoutUrl = data?.data?.attributes?.url;

        if (checkoutUrl) {
          res.status(200).json({
            success: true,
            checkoutUrl,
            mode: "live",
          });
          return;
        }
      } catch (lemonErr) {
        console.warn("Lemon Squeezy API call fallback:", lemonErr);
      }
    }

    // Mode simulation / fallback direct pour le développement et la démo
    const mockCheckoutUrl = `${req.protocol}://${req.get(
      "host"
    )}/api/v1/subscriptions/simulate-checkout?userId=${encodeURIComponent(
      user.id
    )}&tier=${cleanTier}&redirect=${encodeURIComponent(successRedirectUrl)}`;

    res.status(200).json({
      success: true,
      checkoutUrl: mockCheckoutUrl,
      mode: "simulation",
      message: "Session de paiement Lemon Squeezy générée.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur checkout: " + message });
  }
};

/**
 * GET /api/v1/subscriptions/simulate-checkout
 * Permet de tester le flux complet de souscription sans carte bancaire réelle en dev
 */
export const simulateCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, tier, redirect } = req.query;
    const cleanUserId = String(userId || "");
    const cleanTier = String(tier || "intermediate");

    if (cleanUserId) {
      await userStore.updateUser(cleanUserId, {
        subscriptionTier: cleanTier,
        subscriptionStatus: "active",
        isSubscriber: true,
        lemonSubscriptionId: `sub_sim_${Date.now()}`,
      });
    }

    if (redirect) {
      res.redirect(String(redirect));
    } else {
      res.send(`<h2>Abonnement ${cleanTier} activé avec succès !</h2><p><a href="/">Retour au jeu</a></p>`);
    }
  } catch (err: unknown) {
    res.status(500).send("Erreur simulation: " + String(err));
  }
};

/**
 * POST /api/v1/subscriptions/webhook
 * Traite les notifications d'événements webhook de Lemon Squeezy
 */
export const handleLemonSqueezyWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    const signature = req.get("X-Signature") || "";

    if (secret && signature) {
      const hmac = crypto.createHmac("sha256", secret);
      const digest = Buffer.from(hmac.update(JSON.stringify(req.body)).digest("hex"), "utf8");
      const signatureBuffer = Buffer.from(signature, "utf8");
      if (digest.length !== signatureBuffer.length || !crypto.timingSafeEqual(digest, signatureBuffer)) {
        res.status(401).json({ success: false, message: "Signature webhook invalide." });
        return;
      }
    }

    const event = req.body;
    const eventName = event?.meta?.event_name;
    const customData = event?.meta?.custom_data || {};
    const userId = customData.user_id;
    const tier = customData.tier || "intermediate";
    const subAttrs = event?.data?.attributes || {};

    if (userId) {
      if (eventName === "subscription_created" || eventName === "subscription_resumed") {
        await userStore.updateUser(userId, {
          subscriptionTier: tier,
          subscriptionStatus: "active",
          isSubscriber: true,
          lemonCustomerId: String(subAttrs.customer_id || ""),
          lemonSubscriptionId: String(event?.data?.id || ""),
        });
      } else if (eventName === "subscription_cancelled" || eventName === "subscription_expired") {
        await userStore.updateUser(userId, {
          subscriptionTier: "free",
          subscriptionStatus: "canceled",
          isSubscriber: false,
        });
      } else if (eventName === "subscription_payment_failed") {
        await userStore.updateUser(userId, {
          subscriptionStatus: "past_due",
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur webhook: " + message });
  }
};

export default {
  SUBSCRIPTION_TIERS,
  getSubscriptionTiers,
  getUserSubscriptionStatus,
  createCheckoutSession,
  simulateCheckout,
  handleLemonSqueezyWebhook,
};
