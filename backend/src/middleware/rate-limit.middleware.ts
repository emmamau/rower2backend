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
 * Résout une clé d'identification par appareil/joueur (deviceToken, deviceId, userId)
 * avec repli sur l'adresse IP, afin que plusieurs joueurs ou montres connectés
 * sur le même Wi-Fi ou simulateur ne partagent pas le même quota.
 */
export const resolveClientRateLimitKey = (req: Request): string => {
  const bearer =
    req.headers.authorization && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : "";
  const token =
    req.body?.deviceToken ||
    req.headers["x-device-token"] ||
    (req.query?.deviceToken as string | undefined) ||
    bearer;
  if (token && String(token).trim()) {
    return String(token).trim();
  }

  const deviceId =
    req.headers["x-device-id"] ||
    req.body?.deviceId ||
    (req.query?.deviceId as string | undefined);
  if (deviceId && String(deviceId).trim()) {
    return `dev:${String(deviceId).trim()}`;
  }

  const userId =
    req.body?.userId ||
    (req.query?.userId as string | undefined) ||
    (req.query?.hostUserId as string | undefined);
  if (userId && String(userId).trim() && String(userId).trim() !== "anonymous") {
    return `usr:${String(userId).trim()}`;
  }

  return String(req.ip || "unknown-client").trim();
};

/**
 * Indique si la requête cible un endpoint de télémétrie en direct (géré par garminBoostRateLimiter).
 */
const isTelemetryEndpoint = (req: Request): boolean => {
  const url = String(req.originalUrl || req.url || "").split("?")[0];
  return (
    url === "/boost" ||
    url === "/api/boost" ||
    url === "/api/v1/boost" ||
    url === "/api/garmin/boost" ||
    url === "/api/v1/telemetry"
  );
};

/**
 * 1. Limiteur global API : max 600 requêtes/minute par appareil/utilisateur/IP sur /api/
 * Exclut les routes de télémétrie en direct qui disposent de leur propre limiteur dédié (garminBoostRateLimiter).
 */
export const apiGlobalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: resolveClientRateLimitKey,
  skip: (req: Request) => skipInTests(req) || isTelemetryEndpoint(req),
  message: {
    success: false,
    error: "TooManyRequests",
    message: "Trop de requêtes vers l'API. Veuillez réessayer dans une minute.",
  },
});

/**
 * 2. Limiteur d'authentification : max 30 tentatives par 15 minutes par appareil/IP sur /api/user/login, /api/garmin/pair-code, /api/garmin/pair
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: resolveClientRateLimitKey,
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
 * 4. Limiteur de télémétrie Garmin (/api/garmin/boost, /boost, /api/v1/telemetry) :
 * Utilise un keyGenerator basé sur deviceToken || deviceId || userId || req.ip.
 * Permet à 20 ou 50 montres connectées sur le même Wi-Fi d'un club ou simulateur de ramer simultanément sans se bloquer mutuellement.
 * Seuil : 120 requêtes / minute par montre.
 */
export const garminBoostRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInTests,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: resolveClientRateLimitKey,
  message: {
    success: false,
    error: "TooManyRequests",
    message: "Cadence de télémétrie trop élevée pour cette montre. Veuillez ralentir la fréquence d'envoi.",
  },
});

