import { Request, Response } from "express";
import crypto from "crypto";
import userStore from "../services/user-store.service";
import { isEmmaAdminUser } from "../services/auth.service";
import stripeService from "../services/stripe.service";
import emailService from "../services/email.service";
import subscriptionPlanService from "../services/subscription-plan.service";

export interface SubscriptionTierConfig {
  id: "free" | "intermediate" | "premium";
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
    name: "Offre Gratuite",
    priceEur: 0,
    priceFormatted: "0 €",
    maxGuests: 1,
    maxParticipants: 2,
    maxDistance: 2000,
    maxBots: 1,
    maxConcurrentRooms: 1,
    maxWeeklyRooms: 5,
    historyDays: 10,
    customPrefixAllowed: false,
    features: [
      "1 salon ouvert à la fois (5 salons max / semaine)",
      "1 joueur invité en salon privé (2 coureurs max)",
      "Courses jusqu'à 2 000 m (2 km)",
      "1 bot d'entraînement virtuel",
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
    maxConcurrentRooms: 3,
    maxWeeklyRooms: 10,
    historyDays: null,
    customPrefixAllowed: true,
    features: [
      "Jusqu'à 3 salons ouverts à la fois (10 salons max / semaine)",
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
    maxConcurrentRooms: 5,
    maxWeeklyRooms: 15,
    historyDays: null,
    customPrefixAllowed: true,
    features: [
      "Jusqu'à 5 salons ouverts à la fois (15 salons max / semaine)",
      "Jusqu'à 10 joueurs dans vos salons privés",
      "Courses longue distance jusqu'à 10 000 m (10 km)",
      "Jusqu'à 5 bots avec allure de course max",
      "Historique illimité et export des statistiques",
      "Analyses et statistiques de courses illimitées",
      "Tous modes de départ (top départ ou heure programmée)",
      "Accès prioritaire aux nouvelles fonctionnalités",
    ],
  },
};

// Aliases d'offres
SUBSCRIPTION_TIERS.pro = SUBSCRIPTION_TIERS.premium;
SUBSCRIPTION_TIERS.elite_pro = SUBSCRIPTION_TIERS.premium;
SUBSCRIPTION_TIERS.club = SUBSCRIPTION_TIERS.intermediate;
SUBSCRIPTION_TIERS.standard = SUBSCRIPTION_TIERS.intermediate;

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
    const standardDb = plans.find((p: any) => String(p.code || "").toUpperCase() === "STANDARD");
    const premiumDb = plans.find((p: any) => String(p.code || "").toUpperCase() === "PREMIUM");
    const freeDb = plans.find((p: any) => String(p.code || "").toUpperCase() === "FREE");

    const isStandardActive = standardDb ? Boolean(standardDb.isActive ?? standardDb.is_active ?? true) : true;
    const isPremiumActive = premiumDb ? Boolean(premiumDb.isActive ?? premiumDb.is_active ?? true) : true;
    const isFreeActive = freeDb ? Boolean(freeDb.isActive ?? freeDb.is_active ?? true) : true;

    res.status(200).json({
      success: true,
      tiers: [
        { ...SUBSCRIPTION_TIERS.free, isActive: isFreeActive },
        { ...SUBSCRIPTION_TIERS.intermediate, isActive: isStandardActive },
        { ...SUBSCRIPTION_TIERS.premium, isActive: isPremiumActive },
      ],
    });
  } catch {
    res.status(200).json({
      success: true,
      tiers: [
        { ...SUBSCRIPTION_TIERS.free, isActive: true },
        { ...SUBSCRIPTION_TIERS.intermediate, isActive: true },
        { ...SUBSCRIPTION_TIERS.premium, isActive: true },
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
    const rawTier = String((user?.subscriptionTier as any) || (user?.isSubscriber ? "intermediate" : "free")).toLowerCase().trim();
    const tierId: "free" | "intermediate" | "premium" = isEmma
      ? "premium"
      : (rawTier === "pro" || rawTier === "elite_pro" ? "premium" : (rawTier === "club" || rawTier === "standard" ? "intermediate" : (rawTier as any) || "free"));

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
    let cleanTier = String(tier || "intermediate").toLowerCase().trim();
    if (cleanTier === "pro" || cleanTier === "elite_pro") cleanTier = "premium";
    if (cleanTier === "club" || cleanTier === "standard") cleanTier = "intermediate";

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
};
