import Stripe from "stripe";
import { SUBSCRIPTION_TIERS } from "../controllers/subscription.controller";

/**
 * Service d'intégration officiel Stripe pour Rower Race
 * Utilise la version d'API Stripe 2026-10-28.endive et le client Stripe instancié.
 */

const getStripeApiKey = (): string => {
  return process.env.STRIPE_SECRET_KEY || process.env.STRIPE_RESTRICTED_KEY || "";
};

export const getStripeClient = (): Stripe | null => {
  const key = getStripeApiKey();
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: "2026-10-28.endive" as any,
  });
};

export interface CreateStripeCheckoutParams {
  userId: string;
  tier: "intermediate" | "premium";
  customerEmail?: string;
  customerName?: string;
  successUrl: string;
  cancelUrl: string;
}

export class StripeService {
  private static instance: StripeService;

  public static getInstance(): StripeService {
    if (!StripeService.instance) {
      StripeService.instance = new StripeService();
    }
    return StripeService.instance;
  }

  public isConfigured(): boolean {
    return Boolean(getStripeApiKey());
  }

  /**
   * Crée une session Stripe Checkout en mode abonnement ('subscription')
   * Suit les règles officielles Stripe :
   * - Pas de 'payment_method_types' hardcodé (Dynamic Payment Methods activés par défaut)
   * - Tag 'integration_identifier' avec suffixe aléatoire de 8 caractères
   * - Métadonnées d'identification du joueur (userId, tier)
   */
  public async createCheckoutSession(params: CreateStripeCheckoutParams): Promise<{ url: string; sessionId: string }> {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe n'est pas configuré. Veuillez définir STRIPE_SECRET_KEY ou STRIPE_RESTRICTED_KEY.");
    }

    const { userId, tier, customerEmail, customerName, successUrl, cancelUrl } = params;
    const tierConfig = SUBSCRIPTION_TIERS[tier] || SUBSCRIPTION_TIERS.intermediate;

    // Détermination de l'ID de prix récurrent
    const configuredPriceId =
      tier === "premium" ? process.env.STRIPE_PRICE_PREMIUM : process.env.STRIPE_PRICE_CLUB;

    // Suffixe aléatoire de 8 lettres pour le tag integration_identifier
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const integrationIdentifier = `rowerrace_${randomSuffix}`;

    const lineItem = configuredPriceId
      ? { price: configuredPriceId, quantity: 1 }
      : {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Rower Race - ${tierConfig.name}`,
              description: tierConfig.features.slice(0, 3).join(", "),
            },
            unit_amount: Math.round(tierConfig.priceEur * 100),
            recurring: {
              interval: "month" as const,
            },
          },
          quantity: 1,
        };

    const sessionPayload: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [lineItem],
      customer_email: customerEmail || undefined,
      client_reference_id: userId,
      metadata: {
        userId,
        tier,
      },
      subscription_data: {
        metadata: {
          userId,
          tier,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      integration_identifier: integrationIdentifier,
    } as any;

    const session = await stripe.checkout.sessions.create(sessionPayload);

    if (!session.url) {
      throw new Error("La session Stripe Checkout n'a pas retourné d'URL de redirection.");
    }

    return {
      url: session.url,
      sessionId: session.id,
    };
  }

  /**
   * Crée une session de Portail Client Stripe (Customer Portal)
   * Permet aux athlètes de gérer leur abonnement, changer de carte bancaire ou résilier en autonomie.
   */
  public async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe n'est pas configuré.");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  /**
   * Valide la signature cryptographique du webhook Stripe
   */
  public constructWebhookEvent(
    payload: Buffer | string,
    signature: string,
    webhookSecret: string
  ): Stripe.Event {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe n'est pas configuré.");
    }
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}

export default StripeService.getInstance();
