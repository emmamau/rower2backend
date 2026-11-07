import { Application, Router } from "express";
import subscriptionController from "../controllers/subscription.controller";

export default (app: Application): void => {
  const router = Router();

  router.get("/tiers", subscriptionController.getSubscriptionTiers);
  router.get("/status/:userId", subscriptionController.getUserSubscriptionStatus);
  router.post("/checkout", subscriptionController.createCheckoutSession);
  router.get("/simulate-checkout", subscriptionController.simulateCheckout);
  router.post("/webhook", subscriptionController.handleLemonSqueezyWebhook);

  // Routes officielles Stripe
  router.post("/stripe/checkout", subscriptionController.createStripeCheckoutSession);
  router.post("/stripe/portal", subscriptionController.createStripePortalSession);
  router.post("/stripe/webhook", subscriptionController.handleStripeWebhook);

  app.use("/api/v1/subscriptions", router);
  app.use("/api/subscriptions", router);
};
