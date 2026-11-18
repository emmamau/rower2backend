import rateLimit from "express-rate-limit";
import { Request } from "express";

/**
 * Fonction de contournement sécurisée pour les suites de tests automatisées,
 * sauf si le test spécifie explicitement l'en-tête 'x-test-rate-limit' pour tester le limiteur.
 */
const skipInTests = (req: Request): boolean => {
  return process.env.NODE_ENV === "test" && !req.headers["x-test-rate-limit"];
};

/**
 * 1. Limiteur global API : max 150 requêtes/minute par IP sur /api/
 */
export const apiGlobalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 150,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInTests,
  message: {
    success: false,
    error: "TooManyRequests",
    message: "Trop de requêtes vers l'API. Veuillez réessayer dans une minute.",
  },
});

/**
 * 2. Limiteur d'authentification : max 15 tentatives par 15 minutes par IP sur /api/user/login, /api/garmin/pair-code, /api/garmin/pair
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInTests,
  message: {
    success: false,
    error: "TooManyRequests",
    message: "Trop de tentatives d'authentification ou d'appairage. Veuillez patienter 15 minutes.",
  },
});

/**
 * 3. Limiteur d'inscription : max 3 inscriptions par heure par IP sur /api/user/register
 */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInTests,
  message: {
    success: false,
    error: "TooManyRequests",
    message: "Limite de création de compte atteinte pour cette adresse IP (max 3 par heure).",
  },
});

/**
 * 4. Limiteur de télémétrie Garmin (/api/garmin/boost, /boost) :
 * Utilise un keyGenerator basé sur req.body.deviceToken || req.headers['x-device-token'] || req.ip.
 * Permet à 20 ou 50 montres connectées sur le même Wi-Fi d'un club de ramer simultanément sans se bloquer mutuellement.
 * Seuil : 120 requêtes / minute par montre (une montre émet un boost toutes les 1 à 2 secondes).
 */
export const garminBoostRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInTests,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req: Request): string => {
    const token =
      req.body?.deviceToken ||
      req.headers["x-device-token"] ||
      (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : "") ||
      req.ip ||
      "unknown-garmin-device";
    return String(token).trim();
  },
  message: {
    success: false,
    error: "TooManyRequests",
    message: "Cadence de télémétrie trop élevée pour cette montre. Veuillez ralentir la fréquence d'envoi.",
  },
});
