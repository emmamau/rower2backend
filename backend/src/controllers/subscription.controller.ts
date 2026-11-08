import { Request, Response } from "express";
import crypto from "crypto";
import userStore from "../services/user-store.service";
import { isEmmaAdminUser } from "../services/auth.service";
import stripeService from "../services/stripe.service";

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
      "Progression en ligues et classement compétitif",
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
      stripeCustomerId: user?.stripeCustomerId || null,
      stripeSubscriptionId: user?.stripeSubscriptionId || null,
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

    const successRedirectUrl =
      returnUrl || `${req.protocol}://${req.get("host")}/?subscription=success&tier=${cleanTier}&session_id={CHECKOUT_SESSION_ID}`;

    // Si Stripe est configuré (priorité officielle Stripe)
    if (stripeService.isConfigured()) {
      try {
        const session = await stripeService.createCheckoutSession({
          userId: user.id,
          tier: cleanTier as "intermediate" | "premium",
          customerEmail: user.email,
          customerName: user.name || user.login,
          successUrl: successRedirectUrl,
          cancelUrl: `${req.protocol}://${req.get("host")}/?subscription=canceled`,
        });

        res.status(200).json({
          success: true,
          checkoutUrl: session.url,
          sessionId: session.sessionId,
          mode: "live",
        });
        return;
      } catch (stripeErr) {
        console.warn("Stripe Checkout Session fallback:", stripeErr);
      }
    }

    const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    const variantId =
      cleanTier === "premium"
        ? process.env.LEMON_SQUEEZY_VARIANT_PREMIUM
        : process.env.LEMON_SQUEEZY_VARIANT_INTERMEDIATE;

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

/**
 * POST /api/v1/subscriptions/stripe/checkout
 * Crée une session Stripe Checkout officielle pour s'abonner
 */
export const createStripeCheckoutSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, tier, returnUrl, successUrl, cancelUrl } = req.body || {};
    const cleanUserId = String(userId || "").trim();
    const cleanTier = String(tier || "intermediate").toLowerCase();

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

    const host = req.get("host") || "www.rowerrace.com";
    const protocol = req.protocol || "https";
    const defaultSuccessUrl =
      successUrl ||
      returnUrl ||
      `${protocol}://${host}/?subscription=success&tier=${cleanTier}&session_id={CHECKOUT_SESSION_ID}`;
    const defaultCancelUrl = cancelUrl || `${protocol}://${host}/?subscription=canceled`;

    if (stripeService.isConfigured()) {
      const session = await stripeService.createCheckoutSession({
        userId: user.id,
        tier: cleanTier as "intermediate" | "premium",
        customerEmail: user.email,
        customerName: user.name || user.login,
        successUrl: defaultSuccessUrl,
        cancelUrl: defaultCancelUrl,
      });

      res.status(200).json({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.sessionId,
        mode: "live",
      });
      return;
    }

    // Mode simulation si clés Stripe non encore renseignées
    const mockCheckoutUrl = `${protocol}://${host}/api/v1/subscriptions/simulate-checkout?userId=${encodeURIComponent(
      user.id
    )}&tier=${cleanTier}&redirect=${encodeURIComponent(defaultSuccessUrl.replace("{CHECKOUT_SESSION_ID}", "sim_stripe_123"))}`;

    res.status(200).json({
      success: true,
      checkoutUrl: mockCheckoutUrl,
      mode: "simulation",
      message: "Session Stripe simulée (configurez STRIPE_SECRET_KEY pour le mode réel).",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur checkout Stripe: " + message });
  }
};

/**
 * POST /api/v1/subscriptions/stripe/portal
 * Ouvre le portail client Stripe pour la gestion en libre-service
 */
export const createStripePortalSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, customerId, returnUrl } = req.body || {};
    let resolvedCustomerId = customerId;

    if (!resolvedCustomerId && userId) {
      const user = await userStore.findUser(String(userId).trim());
      resolvedCustomerId = user?.stripeCustomerId;
    }

    if (!resolvedCustomerId) {
      res.status(400).json({
        success: false,
        message: "Identifiant client Stripe introuvable pour cet utilisateur.",
      });
      return;
    }

    const host = req.get("host") || "www.rowerrace.com";
    const protocol = req.protocol || "https";
    const redirectUrl = returnUrl || `${protocol}://${host}/`;

    if (stripeService.isConfigured()) {
      const portal = await stripeService.createPortalSession(resolvedCustomerId, redirectUrl);
      res.status(200).json({
        success: true,
        url: portal.url,
      });
      return;
    }

    res.status(200).json({
      success: true,
      url: redirectUrl,
      mode: "simulation",
      message: "Portail client Stripe simulé (configurez STRIPE_SECRET_KEY pour le portail en direct).",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur portail Stripe: " + message });
  }
};

/**
 * POST /api/v1/subscriptions/stripe/webhook
 * Traitement sécurisé des webhooks Stripe avec vérification de signature
 */
export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const sig = req.get("stripe-signature") || "";
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: any;
    if (webhookSecret && sig) {
      try {
        const rawPayload = (req as any).rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
        event = stripeService.constructWebhookEvent(rawPayload, sig, webhookSecret);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Erreur validation signature Stripe webhook:", msg);
        res.status(400).json({ success: false, message: `Webhook signature error: ${msg}` });
        return;
      }
    } else {
      event = req.body;
    }

    const eventType = event?.type;
    const dataObj = event?.data?.object || {};

    switch (eventType) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = dataObj;
        const userId = session.client_reference_id || session.metadata?.userId;
        const tier = session.metadata?.tier || "intermediate";
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

        if (userId) {
          await userStore.updateUser(userId, {
            subscriptionTier: tier,
            subscriptionStatus: "active",
            isSubscriber: true,
            stripeCustomerId: customerId || undefined,
            stripeSubscriptionId: subscriptionId || undefined,
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = dataObj;
        const userId = sub.metadata?.userId;
        const tier = sub.metadata?.tier || "intermediate";
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const targetUser = userId
          ? await userStore.findUser(userId)
          : (customerId ? await userStore.findUserByStripeCustomerId(customerId) : null);

        if (targetUser) {
          if (sub.status === "active") {
            await userStore.updateUser(targetUser.id, {
              subscriptionTier: tier,
              subscriptionStatus: "active",
              isSubscriber: true,
              stripeCustomerId: customerId || undefined,
              stripeSubscriptionId: sub.id,
            });
          } else if (sub.status === "canceled") {
            await userStore.updateUser(targetUser.id, {
              subscriptionTier: "free",
              subscriptionStatus: "canceled",
              isSubscriber: false,
            });
          } else if (sub.status === "past_due" || sub.status === "unpaid") {
            await userStore.updateUser(targetUser.id, {
              subscriptionStatus: "past_due",
            });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = dataObj;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const targetUser = sub.metadata?.userId
          ? await userStore.findUser(sub.metadata.userId)
          : (customerId ? await userStore.findUserByStripeCustomerId(customerId) : null);

        if (targetUser) {
          await userStore.updateUser(targetUser.id, {
            subscriptionTier: "free",
            subscriptionStatus: "canceled",
            isSubscriber: false,
          });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = dataObj;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        const targetUser = customerId ? await userStore.findUserByStripeCustomerId(customerId) : null;
        if (targetUser) {
          await userStore.updateUser(targetUser.id, {
            subscriptionStatus: "active",
            isSubscriber: true,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = dataObj;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        const targetUser = customerId ? await userStore.findUserByStripeCustomerId(customerId) : null;
        if (targetUser) {
          await userStore.updateUser(targetUser.id, {
            subscriptionStatus: "past_due",
          });
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = dataObj;
        console.warn(`[Stripe Dispute] Litige reçu: ${dispute.id} montant: ${dispute.amount}`);
        break;
      }

      case "charge.refunded": {
        const charge = dataObj;
        const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
        const targetUser = customerId ? await userStore.findUserByStripeCustomerId(customerId) : null;
        if (targetUser) {
          await userStore.updateUser(targetUser.id, {
            subscriptionTier: "free",
            subscriptionStatus: "canceled",
            isSubscriber: false,
          });
        }
        break;
      }

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur webhook Stripe: " + message });
  }
};

export default {
  SUBSCRIPTION_TIERS,
  getSubscriptionTiers,
  getUserSubscriptionStatus,
  createCheckoutSession,
  simulateCheckout,
  handleLemonSqueezyWebhook,
  createStripeCheckoutSession,
  createStripePortalSession,
  handleStripeWebhook,
};
