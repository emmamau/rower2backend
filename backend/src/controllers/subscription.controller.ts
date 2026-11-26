import { Request, Response } from "express";
import crypto from "crypto";
import db from "../models";
import userStore from "../services/user-store.service";
import { isEmmaAdminUser } from "../services/auth.service";
import stripeService from "../services/stripe.service";
import emailService from "../services/email.service";
import subscriptionPlanService from "../services/subscription-plan.service";

let launchPioneerMode: boolean = process.env.LAUNCH_PIONEER_MODE !== "false";

export const getPioneerMode = (): boolean => launchPioneerMode;
export const setPioneerMode = (active: boolean): void => {
  launchPioneerMode = Boolean(active);
};

export interface SubscriptionTierConfig {
  id: "free" | "competitor" | "club_elite" | "intermediate" | "premium";
  name: string;
  priceEur: number;
  priceFormatted: string;
  maxGuests: number;
  maxParticipants: number;
  maxDistance: number;
  maxBots: number;
  maxConcurrentRooms: number;
  maxWeeklyRooms: number;
  historyDays: number | null; // null = unlimited
  customPrefixAllowed: boolean;
  features: string[];
}

export const SUBSCRIPTION_TIERS: Record<string, SubscriptionTierConfig> = {
  free: {
    id: "free",
    name: "Découverte",
    priceEur: 0,
    priceFormatted: "0 € / mois",
    maxGuests: 1,
    maxParticipants: 2,
    maxDistance: 2000,
    maxBots: 1,
    maxConcurrentRooms: 1,
    maxWeeklyRooms: 2,
    historyDays: 10,
    customPrefixAllowed: false,
    features: [
      "Courses publiques illimitées (Ligue Bronze)",
      "1 salon privé ouvert à la fois (2 salons max par semaine)",
      "Jusqu'à 2 joueurs max par salon privé (1 invité)",
      "Courses jusqu'à 2 000 m (2 km)",
      "1 bot d'entraînement virtuel (allure fixe)",
      "Historique des courses limité aux 10 derniers jours",
      "Cockpit en direct et classements publics",
    ],
  },
  competitor: {
    id: "competitor",
    name: "Compétiteur",
    priceEur: 5.99,
    priceFormatted: "5,99 € / mois",
    maxGuests: 4,
    maxParticipants: 5,
    maxDistance: 5000,
    maxBots: 3,
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 5,
    historyDays: null,
    customPrefixAllowed: true,
    features: [
      "Accès complet aux Ligues Argent & Or + défis 1v1 illimités",
      "Jusqu'à 3 salons privés ouverts à la fois (5 salons max par semaine)",
      "Jusqu'à 5 joueurs max par salon privé",
      "Courses jusqu'à 5 000 m (5 km)",
      "Jusqu'à 3 bots configurables",
      "Historique et statistiques avancées illimités",
      "Départ manuel ou programmé à l'heure",
    ],
  },
  club_elite: {
    id: "club_elite",
    name: "Club / Élite",
    priceEur: 8.99,
    priceFormatted: "8,99 € / mois",
    maxGuests: 9,
    maxParticipants: 10,
    maxDistance: 10000,
    maxBots: 5,
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 10,
    historyDays: null,
    customPrefixAllowed: true,
    features: [
      "Tout l'accès Compétiteur (Ligues Argent & Or, défis 1v1 illimités)",
      "Jusqu'à 5 salons privés ouverts à la fois (10 salons max par semaine)",
      "Jusqu'à 10 joueurs max par salon privé",
      "Courses longues jusqu'à 10 000 m (ou marathon)",
      "Jusqu'à 5 bots configurables avec allure max",
      "Historique illimité & export complet des données (.fit, .tcx, .csv)",
      "Support prioritaire & accès anticipé aux nouveautés",
    ],
  },
};

// Aliases d'offres pour rétrocompatibilité totale
SUBSCRIPTION_TIERS.intermediate = SUBSCRIPTION_TIERS.competitor;
SUBSCRIPTION_TIERS.standard = SUBSCRIPTION_TIERS.competitor;
SUBSCRIPTION_TIERS.club = SUBSCRIPTION_TIERS.competitor;
SUBSCRIPTION_TIERS.premium = SUBSCRIPTION_TIERS.club_elite;
SUBSCRIPTION_TIERS.pro = SUBSCRIPTION_TIERS.club_elite;
SUBSCRIPTION_TIERS.elite_pro = SUBSCRIPTION_TIERS.club_elite;

export const normalizeTier = (tierOrUser?: any): string => {
  let raw = "";
  if (typeof tierOrUser === "string") {
    raw = tierOrUser.trim().toLowerCase();
  } else if (tierOrUser && typeof tierOrUser === "object") {
    raw = String(tierOrUser.subscriptionTier || tierOrUser.subscription_tier || (tierOrUser.isSubscriber ? "competitor" : "free")).trim().toLowerCase();
  }
  if (raw === "competitor" || raw === "intermediate" || raw === "standard" || raw === "club") {
    return "competitor";
  }
  if (raw === "club_elite" || raw === "premium" || raw === "pro" || raw === "elite_pro") {
    return "club_elite";
  }
  if (raw === "free" || raw === "decouverte") {
    return "free";
  }
  return raw;
};

/**
 * Détermine l'URL de base du frontend client.
 * Priorité :
 * 1. En-tête HTTP 'Origin' (ex. https://rower-dashboard-frontend.onrender.com ou http://localhost:4200)
 * 2. En-tête HTTP 'Referer'
 * 3. Variable d'environnement FRONTEND_URL
 * 4. Fallback officiel de production
 */
export const getFrontendBaseUrl = (req: Request): string => {
  const origin = req.get("origin");
  if (origin && !origin.includes("rower-api-service")) {
    return origin.trim().replace(/\/+$/, "");
  }

  const referer = req.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      if (!parsed.hostname.includes("rower-api-service")) {
        return parsed.origin.trim().replace(/\/+$/, "");
      }
    } catch {}
  }

  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.trim().replace(/\/+$/, "");
  }

  return process.env.NODE_ENV === "production"
    ? "https://rower-dashboard-frontend.onrender.com"
    : "http://localhost:4200";
};

/**
 * GET /api/v1/subscriptions/tiers
 * Retourne les 3 offres d'abonnement officielles et leurs caractéristiques,
 * enrichies avec leur statut d'activation (isActive) configuré par l'administrateur.
 */
export const getSubscriptionTiers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const plans = await subscriptionPlanService.loadAllPlans();
    const competitorDb = plans.find((p: any) => {
      const code = String(p.code || "").toUpperCase();
      return code === "COMPETITOR" || code === "STANDARD";
    });
    const clubEliteDb = plans.find((p: any) => {
      const code = String(p.code || "").toUpperCase();
      return code === "CLUB_ELITE" || code === "PREMIUM";
    });
    const freeDb = plans.find((p: any) => String(p.code || "").toUpperCase() === "FREE");

    const isCompetitorActive = competitorDb ? Boolean(competitorDb.isActive ?? competitorDb.is_active ?? true) : true;
    const isClubEliteActive = clubEliteDb ? Boolean(clubEliteDb.isActive ?? clubEliteDb.is_active ?? true) : true;
    const isFreeActive = freeDb ? Boolean(freeDb.isActive ?? freeDb.is_active ?? true) : true;

    const isPioneer = getPioneerMode();

    const formatTier = (tierConfig: SubscriptionTierConfig, isActive: boolean) => ({
      ...tierConfig,
      priceEur: isActive ? tierConfig.priceEur : null,
      priceFormatted: isActive ? tierConfig.priceFormatted : null,
      isActive,
    });

    res.status(200).json({
      success: true,
      pioneerMode: isPioneer,
      tiers: [
        formatTier(SUBSCRIPTION_TIERS.free, isFreeActive),
        formatTier(SUBSCRIPTION_TIERS.competitor, isCompetitorActive),
        formatTier(SUBSCRIPTION_TIERS.club_elite, isClubEliteActive),
      ],
    });
  } catch {
    res.status(200).json({
      success: true,
      pioneerMode: getPioneerMode(),
      tiers: [
        { ...SUBSCRIPTION_TIERS.free, isActive: true },
        { ...SUBSCRIPTION_TIERS.competitor, isActive: true },
        { ...SUBSCRIPTION_TIERS.club_elite, isActive: true },
      ],
    });
  }
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
    const normalized = normalizeTier(user?.subscriptionTier || (user?.isSubscriber ? "competitor" : "free"));
    const tierId: "free" | "competitor" | "club_elite" = isEmma
      ? "club_elite"
      : (normalized === "competitor" || normalized === "club_elite" ? normalized : "free");

    const tierConfig = SUBSCRIPTION_TIERS[tierId] || SUBSCRIPTION_TIERS.free;

    const isSub = Boolean(
      isEmma ||
      user?.isAdmin ||
      user?.isSubscriber ||
      (user as any)?.is_subscriber ||
      (user?.subscriptionTier && !["free", "none", ""].includes(String(user.subscriptionTier).toLowerCase().trim())) ||
      (user?.subscriptionStatus === "active" && String(user?.subscriptionTier).toLowerCase().trim() !== "free")
    );

    res.status(200).json({
      success: true,
      userId,
      tier: tierId,
      status: isEmma ? "active" : user?.subscriptionStatus || (isSub ? "active" : "none"),
      isSubscriber: isSub,
      isPioneer: Boolean(user?.isPioneer || (user as any)?.is_pioneer),
      pioneerActivatedAt: user?.pioneerActivatedAt || (user as any)?.pioneer_activated_at || null,
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
 * Initialise une session de paiement officielle Stripe pour une mise à niveau d'abonnement
 */
export const createCheckoutSession = async (req: Request, res: Response): Promise<void> => {
  return createStripeCheckoutSession(req, res);
};

/**
 * GET /api/v1/subscriptions/simulate-checkout
 * POST /api/v1/subscriptions/simulate-checkout
 * Permet de tester le flux complet de souscription sans carte bancaire réelle en dev
 */
export const simulateCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    if (process.env.NODE_ENV === "production") {
      res.status(403).send("La simulation de paiement est strictement désactivée en production.");
      return;
    }

    const isPost = req.method === "POST";
    const userId = isPost ? req.body?.userId : req.query?.userId;
    const tier = isPost ? req.body?.tier : req.query?.tier;
    const redirect = isPost ? req.body?.redirect : req.query?.redirect;
    const confirm = req.query?.confirm === "true" || req.query?.confirm === "1" || req.query?.auto === "true";

    const cleanUserId = String(userId || "").trim();
    const cleanTier = String(tier || "intermediate").trim();

    if (!cleanUserId) {
      res.status(400).send("Identifiant utilisateur manquant.");
      return;
    }

    const user = await userStore.findUser(cleanUserId);
    if (!user) {
      res.status(404).send("Utilisateur non trouvé.");
      return;
    }

    // En environnement de test / dev : si l'utilisateur accède à la simulation sans confirmation préalable,
    // on affiche une page explicative indiquant qu'aucune carte bancaire n'a été demandée car les clés Stripe sont absentes.
    if (!isPost && !confirm) {
      const tierLabel = cleanTier === "premium" ? "Élite Pro (8,99 €/m)" : "Offre Club (5,99 €/m)";
      const cancelUrl = redirect ? String(redirect).replace("subscription=success", "subscription=canceled") : "/";
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Simulation Paiement Stripe - Rower Race</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b1329; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
    .card { background: #16203c; border: 1px solid #2d3e66; border-radius: 14px; padding: 2rem; max-width: 520px; width: 100%; box-shadow: 0 15px 35px rgba(0,0,0,0.6); text-align: center; }
    .badge { display: inline-block; background: #f59e0b; color: #0b1329; font-weight: 800; font-size: 0.75rem; padding: 0.35rem 0.8rem; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1.25rem; }
    h2 { margin: 0 0 0.5rem 0; color: #00e5ff; font-size: 1.6rem; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 0.75rem 0; }
    .warning-box { background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 0.85rem; margin: 1.25rem 0; font-size: 0.88rem; color: #fbbf24; text-align: left; }
    .info-box { background: #0d162d; border-radius: 8px; padding: 1rem; margin: 1.25rem 0; text-align: left; font-size: 0.9rem; border: 1px solid #243356; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .info-row:last-child { margin-bottom: 0; }
    .btn { display: block; width: 100%; padding: 0.85rem 1rem; border-radius: 8px; font-weight: 700; font-size: 1rem; cursor: pointer; text-decoration: none; border: none; box-sizing: border-box; transition: all 0.2s; }
    .btn-confirm { background: #00e5ff; color: #0b1329; margin-bottom: 0.75rem; }
    .btn-confirm:hover { background: #38bdf8; transform: translateY(-1px); }
    .btn-cancel { background: transparent; color: #94a3b8; border: 1px solid #334155; }
    .btn-cancel:hover { background: #1e293b; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Environnement Développeur / Test</div>
    <h2>Simulation Paiement Stripe</h2>
    <p>Aucune clé <code>STRIPE_SECRET_KEY</code> n'est configurée sur ce serveur.</p>
    <div class="warning-box">
      ℹ️ <strong>Pourquoi aucun numéro de carte n'a été demandé ?</strong><br>
      En production ou dès que votre clé Stripe secrète est configurée dans le fichier <code>.env</code>, vous êtes automatiquement redirigé vers <strong>Stripe Checkout</strong> pour saisir votre carte bancaire en toute sécurité.
    </div>
    <div class="info-box">
      <div class="info-row"><span style="color:#64748b;">Offre sélectionnée :</span> <strong>${tierLabel}</strong></div>
      <div class="info-row"><span style="color:#64748b;">Joueur :</span> <strong>${user.name || user.login}</strong></div>
    </div>
    <form method="POST" action="/api/v1/subscriptions/simulate-checkout">
      <input type="hidden" name="userId" value="${cleanUserId}">
      <input type="hidden" name="tier" value="${cleanTier}">
      <input type="hidden" name="redirect" value="${redirect || ''}">
      <button type="submit" class="btn btn-confirm">Valider la souscription simulée</button>
    </form>
    <a href="${cancelUrl}" class="btn btn-cancel">Annuler</a>
  </div>
</body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }

    const updated = await userStore.updateUser(cleanUserId, {
      subscriptionTier: cleanTier,
      subscriptionStatus: "active",
      isSubscriber: true,
      lemonSubscriptionId: `sub_sim_${Date.now()}`,
    });

    if (updated && updated.email && cleanTier !== "free") {
      const planConfig = SUBSCRIPTION_TIERS[cleanTier] || SUBSCRIPTION_TIERS.intermediate;
      const userLang = (updated.language || ((updated as any).country || (updated as any).pays || "").toString().toLowerCase().includes("fr") ? "fr" : "en");
      await emailService.sendSubscriptionConfirmationEmail(
        updated.email,
        updated.name || updated.login,
        planConfig.name,
        planConfig.priceFormatted,
        undefined,
        userLang
      );
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
    const cleanTier = normalizeTier(tier);

    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est obligatoire." });
      return;
    }

    if (!["competitor", "club_elite", "free", "intermediate", "premium"].includes(cleanTier)) {
      res.status(400).json({ success: false, message: "Offre invalide (free, competitor ou club_elite)." });
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

    const isTierActive = await subscriptionPlanService.isTierActive(cleanTier);
    if (!isTierActive) {
      res.status(403).json({
        success: false,
        message: "Cette offre d'abonnement est actuellement désactivée par l'administrateur.",
      });
      return;
    }

    const frontendBase = getFrontendBaseUrl(req);
    const defaultSuccessUrl =
      successUrl ||
      returnUrl ||
      `${frontendBase}/?subscription=success&tier=${cleanTier}&session_id={CHECKOUT_SESSION_ID}`;
    const defaultCancelUrl = cancelUrl || `${frontendBase}/?subscription=canceled`;

    if (stripeService.isConfigured()) {
      try {
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
      } catch (stripeErr: unknown) {
        const message = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
        console.error("Erreur création session Stripe Checkout:", message);
        res.status(500).json({
          success: false,
          message: "Erreur lors de l'accès au paiement sécurisé Stripe : " + message,
        });
        return;
      }
    }

    // Protection stricte en production : aucun paiement simulé gratuit
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      res.status(503).json({
        success: false,
        message: "La passerelle de paiement sécurisée Stripe n'est pas encore configurée. Veuillez contacter l'administrateur.",
      });
      return;
    }

    // Mode simulation UNIQUEMENT en développement / tests locaux (si clés Stripe non encore renseignées)
    const simulatedSessionId = `sim_session_${Date.now()}`;
    const mockCheckoutUrl = `${req.protocol}://${req.get(
      "host"
    )}/api/v1/subscriptions/simulate-checkout?userId=${encodeURIComponent(
      user.id
    )}&tier=${cleanTier}&redirect=${encodeURIComponent(defaultSuccessUrl.replace("{CHECKOUT_SESSION_ID}", simulatedSessionId))}`;

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

    const frontendBase = getFrontendBaseUrl(req);
    const redirectUrl = returnUrl || `${frontendBase}/`;

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
          const updatedUser = await userStore.updateUser(userId, {
            subscriptionTier: tier,
            subscriptionStatus: "active",
            isSubscriber: true,
            stripeCustomerId: customerId || undefined,
            stripeSubscriptionId: subscriptionId || undefined,
          });

          const recipientEmail = updatedUser?.email || session.customer_details?.email || session.customer_email;
          if (recipientEmail) {
            const planConfig = SUBSCRIPTION_TIERS[tier] || SUBSCRIPTION_TIERS.intermediate;
            const userLang = (updatedUser?.language || (session.locale?.startsWith("fr") ? "fr" : "en"));
            await emailService.sendSubscriptionConfirmationEmail(
              recipientEmail,
              updatedUser?.name || updatedUser?.login || (userLang === "fr" ? "Rameur" : "Rower"),
              planConfig.name,
              planConfig.priceFormatted,
              undefined,
              userLang
            );
          }
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
            if (targetUser.email) {
              const planConfig = SUBSCRIPTION_TIERS[tier] || SUBSCRIPTION_TIERS.intermediate;
              const userLang = (targetUser.language || "fr").startsWith("fr") ? "fr" : "en";
              await emailService.sendSubscriptionCancellationEmail(
                targetUser.email,
                targetUser.name || targetUser.login || (userLang === "fr" ? "Rameur" : "Rower"),
                planConfig.name,
                undefined,
                userLang
              );
            }
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
          const oldTier = targetUser.subscriptionTier || "intermediate";
          await userStore.updateUser(targetUser.id, {
            subscriptionTier: "free",
            subscriptionStatus: "canceled",
            isSubscriber: false,
          });
          if (targetUser.email) {
            const planConfig = SUBSCRIPTION_TIERS[oldTier] || SUBSCRIPTION_TIERS.intermediate;
            const userLang = (targetUser.language || "fr").startsWith("fr") ? "fr" : "en";
            await emailService.sendSubscriptionCancellationEmail(
              targetUser.email,
              targetUser.name || targetUser.login || (userLang === "fr" ? "Rameur" : "Rower"),
              planConfig.name,
              undefined,
              userLang
            );
          }
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

/**
 * POST /api/v1/subscriptions/activate-pioneer
 * Active immédiatement un plan en mode « Accès Pionnier gratuit » (sans Stripe)
 */
export const activatePioneer = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!getPioneerMode()) {
      res.status(403).json({
        success: false,
        message: "Le mode Accès Pionnier n'est pas actif actuellement.",
      });
      return;
    }

    const { userId, plan, sourceTrigger } = req.body || {};
    const cleanUserId = String(userId || "").trim();
    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "Identifiant utilisateur manquant." });
      return;
    }

    const user = await userStore.findUser(cleanUserId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const normalizedPlan = normalizeTier(plan);
    if (normalizedPlan === "free") {
      res.status(400).json({ success: false, message: "Veuillez sélectionner l'offre Compétiteur ou Club / Élite." });
      return;
    }

    const updatedUser = await userStore.updateUser(user.id, {
      subscriptionTier: normalizedPlan,
      subscriptionStatus: "active",
      isSubscriber: true,
      isPioneer: true,
      pioneerActivatedAt: new Date(),
    });

    // Journalisation de l'intention d'upgrade / activation
    try {
      if (db.planUpgradeInterests) {
        await db.planUpgradeInterests.create({
          userId: user.id,
          targetPlan: normalizedPlan,
          sourceTrigger: sourceTrigger || "pioneer_modal",
        });
      }
    } catch (dbErr) {
      console.warn("[Subscription] Impossible d'enregistrer plan_upgrade_interests:", dbErr);
    }

    const tierConfig = SUBSCRIPTION_TIERS[normalizedPlan] || SUBSCRIPTION_TIERS.competitor;

    res.status(200).json({
      success: true,
      message: `Accès Pionnier activé avec succès pour le plan ${tierConfig.name} !`,
      tier: normalizedPlan,
      isPioneer: true,
      pioneerActivatedAt: updatedUser?.pioneerActivatedAt || new Date(),
      limits: tierConfig,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur activation Pionnier: " + msg });
  }
};

/**
 * GET /api/v1/subscriptions/pioneer-stats
 * Retourne le récapitulatif des activations Pionniers pour le back-office
 */
export const getPioneerStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const allUsers = await userStore.getAllUsers();
    const pioneerUsers = allUsers.filter((u: any) => Boolean(u.isPioneer || u.is_pioneer));

    let competitorCount = 0;
    let clubEliteCount = 0;
    for (const u of pioneerUsers) {
      const tier = normalizeTier(u.subscriptionTier || (u as any).subscription_tier);
      if (tier === "competitor") competitorCount++;
      else if (tier === "club_elite") clubEliteCount++;
    }

    let interests: any[] = [];
    try {
      if (db.planUpgradeInterests) {
        interests = await db.planUpgradeInterests.findAll({
          order: [["createdAt", "DESC"]],
          limit: 50,
        });
      }
    } catch {}

    res.status(200).json({
      success: true,
      pioneerMode: getPioneerMode(),
      totalPioneers: pioneerUsers.length,
      competitorCount,
      clubEliteCount,
      pioneers: pioneerUsers.map((u: any) => ({
        id: u.id,
        name: u.name || u.login,
        email: u.email || "",
        subscriptionTier: normalizeTier(u.subscriptionTier || u.subscription_tier),
        pioneerActivatedAt: u.pioneerActivatedAt || u.pioneer_activated_at || null,
        createdAt: u.createdAt || null,
      })),
      recentInterests: interests,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur stats pionniers: " + msg });
  }
};

/**
 * POST /api/v1/subscriptions/toggle-pioneer
 * Permet à l'administrateur de basculer le mode Pionnier à chaud
 */
export const togglePioneerMode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { active } = req.body || {};
    const newActive = active !== undefined ? Boolean(active) : !getPioneerMode();
    setPioneerMode(newActive);
    res.status(200).json({
      success: true,
      pioneerMode: newActive,
      message: `Mode Accès Pionnier ${newActive ? "activé" : "désactivé"}.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur toggle mode pionnier: " + msg });
  }
};

export default {
  SUBSCRIPTION_TIERS,
  getFrontendBaseUrl,
  getSubscriptionTiers,
  getUserSubscriptionStatus,
  createCheckoutSession,
  simulateCheckout,
  handleLemonSqueezyWebhook,
  createStripeCheckoutSession,
  createStripePortalSession,
  handleStripeWebhook,
  activatePioneer,
  getPioneerStats,
  togglePioneerMode,
  getPioneerMode,
  setPioneerMode,
  normalizeTier,
};
