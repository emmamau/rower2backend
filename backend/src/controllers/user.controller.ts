import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import { KayakCustomization, RegattaPreferences, RegattaMetricKey } from "../models/user.model";
import { hashPassword, verifyPassword, isEmmaAdminUser, generateSecureToken } from "../services/auth.service";
import JwtService from "../services/jwt.service";
import emailService from "../services/email.service";
import stripeService from "../services/stripe.service";
import userStore, { StoredUser } from "../services/user-store.service";
import raceManager from "../services/race-manager.service";
import pairingService from "../services/pairing.service";
import { getLeagueByPoints, WEEKLY_LEAGUES, LeagueTier } from "../utils/league.util";
import { ensureCurrentWeek } from "../services/league-db.service";
import duelService, { sanitizeDuelPreferences } from "../services/duel.service";

const Activities = db.activities;

export const PASSWORD_SPECIAL_CHARS_REGEX = /[!@#$%^&*(),.?":{}|<>]/;

export function validateStrongPassword(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Le mot de passe est obligatoire." };
  }
  if (password.length < 8) {
    return { valid: false, message: "Le mot de passe doit comporter au moins 8 caractères." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Le mot de passe doit comporter au moins une lettre majuscule." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Le mot de passe doit comporter au moins une lettre minuscule." };
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: "Le mot de passe doit comporter au moins un chiffre." };
  }
  if (!PASSWORD_SPECIAL_CHARS_REGEX.test(password)) {
    return {
      valid: false,
      message: 'Le mot de passe doit comporter au moins un caractère spécial (!@#$%^&*(),.?":{}|<>).'
    };
  }
  return { valid: true };
}

function isValidHexColor(color: any): boolean {
  return typeof color === "string" && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color.trim());
}

const VALID_PATTERNS = ["solid", "racing-stripe", "dual-tone", "gradient"];

const DEFAULT_KAYAK_CUSTOMIZATION: KayakCustomization = {
  hullColor: "#00e5ff",
  bladeColor: "#00f0ff",
  pattern: "racing-stripe",
  glowColor: "#00f0ff",
};

const VALID_REGATTA_METRICS: RegattaMetricKey[] = [
  "chrono",
  "power",
  "spm",
  "speed",
  "pace",
  "position",
  "distToPrev",
  "distToLeader",
  "distToNext",
  "distRemaining",
  "distCovered",
  "force",
  "work",
  "avgSpeed",
  "avgPower",
  "avgPace",
  "none",
];

const DEFAULT_REGATTA_METRICS: RegattaMetricKey[] = [
  "position",
  "power",
  "pace",
  "distCovered",
  "distRemaining",
  "distToPrev",
];

const DEFAULT_REGATTA_PREFERENCES: RegattaPreferences = {
  zoomLevel: 1,
  selectedMetrics: [...DEFAULT_REGATTA_METRICS],
  myLaneMetrics: ["position", "distRemaining"],
  myLanePosition: "auto",
  myHeaderMetric: "distCovered",
  opponentLaneMetrics: ["distRemaining", "pace"],
  opponentLanePosition: "auto",
  opponentHeaderMetric: "distCovered",
  watermarkMetric: "chrono",
};

function sanitizeRegattaPreferences(prefs?: any): RegattaPreferences {
  const rawZoom = Number(prefs?.zoomLevel);
  const zoomLevel = Number.isFinite(rawZoom)
    ? Math.min(4, Math.max(1, Math.round(rawZoom * 2) / 2))
    : DEFAULT_REGATTA_PREFERENCES.zoomLevel;

  const validSet = new Set<string>(VALID_REGATTA_METRICS);
  const uniqueMetrics: RegattaMetricKey[] = [];

  if (Array.isArray(prefs?.selectedMetrics)) {
    for (const item of prefs.selectedMetrics) {
      const k = String(item || "").trim() as RegattaMetricKey;
      if (validSet.has(k) && k !== "none" && !uniqueMetrics.includes(k)) {
        uniqueMetrics.push(k);
      }
    }
  }

  if (uniqueMetrics.length === 0) {
    uniqueMetrics.push(...DEFAULT_REGATTA_METRICS);
  } else if (uniqueMetrics.length < 3) {
    for (const fallbackKey of DEFAULT_REGATTA_METRICS) {
      if (!uniqueMetrics.includes(fallbackKey)) {
        uniqueMetrics.push(fallbackKey);
      }
      if (uniqueMetrics.length >= 3) break;
    }
  }

  const sanitizeMetricPair = (pair: any, fallback: [RegattaMetricKey, RegattaMetricKey]): [RegattaMetricKey, RegattaMetricKey] => {
    if (!Array.isArray(pair) || pair.length < 2) return [...fallback];
    const k1 = String(pair[0] || "").trim() as RegattaMetricKey;
    const k2 = String(pair[1] || "").trim() as RegattaMetricKey;
    const validK1 = validSet.has(k1) ? k1 : fallback[0];
    const validK2 = validSet.has(k2) ? k2 : fallback[1];
    return [validK1, validK2];
  };

  const sanitizePosition = (pos: any): "auto" | "front" | "back" => {
    const s = String(pos || "").trim().toLowerCase();
    return (s === "front" || s === "back" || s === "auto") ? s : "auto";
  };

  const sanitizeSingleMetric = (key: any, fallback: RegattaMetricKey): RegattaMetricKey => {
    const s = String(key || "").trim() as RegattaMetricKey;
    return validSet.has(s) ? s : fallback;
  };

  return {
    zoomLevel,
    selectedMetrics: uniqueMetrics,
    myLaneMetrics: sanitizeMetricPair(prefs?.myLaneMetrics, DEFAULT_REGATTA_PREFERENCES.myLaneMetrics || ["position", "distRemaining"]),
    myLanePosition: sanitizePosition(prefs?.myLanePosition),
    myHeaderMetric: sanitizeSingleMetric(prefs?.myHeaderMetric, DEFAULT_REGATTA_PREFERENCES.myHeaderMetric || "distCovered"),
    opponentLaneMetrics: sanitizeMetricPair(prefs?.opponentLaneMetrics, DEFAULT_REGATTA_PREFERENCES.opponentLaneMetrics || ["distRemaining", "pace"]),
    opponentLanePosition: sanitizePosition(prefs?.opponentLanePosition),
    opponentHeaderMetric: sanitizeSingleMetric(prefs?.opponentHeaderMetric, DEFAULT_REGATTA_PREFERENCES.opponentHeaderMetric || "distCovered"),
    watermarkMetric: sanitizeSingleMetric(prefs?.watermarkMetric, DEFAULT_REGATTA_PREFERENCES.watermarkMetric || "chrono"),
  };
}

/**
 * Sanitise l'objet utilisateur pour ne jamais exposer de données sensibles (mot de passe / sel / tokens).
 */
function sanitizeUser(user: any): Record<string, any> {
  const plain = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete plain.passwordHash;
  delete plain.passwordSalt;
  delete plain.resetPasswordToken;
  delete plain.resetPasswordExpires;
  const tier = (String(plain.currentLeague || plain.current_league || "BRONZE").toUpperCase()) as LeagueTier;
  const leagueInfo = WEEKLY_LEAGUES[tier] || getLeagueByPoints(plain.points || 0);
  plain.currentLeague = tier;
  plain.league = tier.toLowerCase();
  plain.leagueName = leagueInfo.name;
  plain.leagueBadge = leagueInfo.badge;
  plain.totalCareerPoints = plain.totalCareerPoints !== undefined ? Number(plain.totalCareerPoints) : (plain.total_career_points !== undefined ? Number(plain.total_career_points) : Number(plain.points || 0));
  plain.isResting = plain.isResting !== undefined ? Boolean(plain.isResting) : Boolean(plain.is_resting);
  plain.role = plain.role ? String(plain.role).toUpperCase() : (plain.isAdmin || plain.is_admin ? "ADMIN" : "USER");
  plain.isRevoked = plain.isRevoked !== undefined ? Boolean(plain.isRevoked) : Boolean(plain.is_revoked);
  plain.subscriptionTier = String(plain.subscriptionTier || plain.subscription_tier || "free").toLowerCase();
  plain.isAdmin = Boolean(plain.isAdmin || plain.is_admin || plain.role === "ADMIN");
  const isPaidTier = plain.subscriptionTier !== "free" && plain.subscriptionTier !== "none" && Boolean(plain.subscriptionTier);
  plain.isSubscriber = Boolean(plain.isAdmin || (isPaidTier && (plain.isSubscriber ?? true)));
  plain.regattaPreferences = sanitizeRegattaPreferences(plain.regattaPreferences);
  plain.duelPreferences = sanitizeDuelPreferences(plain.duelPreferences);
  plain.duelsWon = Number(plain.duelsWon || 0);
  plain.duelsLost = Number(plain.duelsLost || 0);
  plain.duelsDrawn = Number(plain.duelsDrawn || 0);
  plain.duelPoints = Number(plain.duelPoints || 0);
  plain.referredBy = plain.referredBy ?? null;
  plain.language = plain.language ? String(plain.language).toLowerCase().trim() : "fr";
  return plain;
}

/**
 * Migre les activités et courses réalisées sous un identifiant invité temporaire vers un compte permanent.
 */
export const migrateGuestActivities = async (guestUserId?: string, targetUserId?: string): Promise<number> => {
  if (!guestUserId || !targetUserId) return 0;
  const cleanGuestId = String(guestUserId).trim();
  const cleanTargetId = String(targetUserId).trim();
  if (!cleanGuestId || !cleanTargetId || cleanGuestId === cleanTargetId) return 0;

  let totalUpdated = 0;
  try {
    const [affectedCount] = await Activities.update(
      { userId: cleanTargetId },
      { where: { userId: cleanGuestId } }
    );
    totalUpdated += affectedCount || 0;
    if (totalUpdated > 0) {
      const userActivities = await Activities.findAll({ where: { userId: cleanTargetId } });
      const totalRaces = userActivities.length;
      const totalWins = userActivities.filter((a: any) => a.finalRank === 1).length;
      const podiums = userActivities.filter((a: any) => a.finalRank && a.finalRank <= 3).length;
      await userStore.updateUser(cleanTargetId, {
        totalRaces,
        totalWins,
        podiums,
      });
    }
  } catch (err) {
    console.warn("[migrateGuestActivities] Erreur migration activités DB:", err);
  }

  for (const act of (userStore as any).inMemoryActivities || []) {
    if (act && act.userId === cleanGuestId) {
      act.userId = cleanTargetId;
      totalUpdated++;
    }
  }
  return totalUpdated;
};

/**
 * POST /api/user/register
 * Inscription d'un nouvel abonné ayant le droit de créer des salons privés.
 * Données requises : Nom, prenom, année naissance, sexe, pays, login, email, mot de passe.
 * Le login est unique et sert à confirmer l'inscription via l'application Garmin.
 */
export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      nom,
      lastName,
      prenom,
      firstName,
      anneeNaissance,
      birthYear,
      sexe,
      gender,
      pays,
      country,
      login,
      email,
      password,
      watchUserId,
      guestPairingToken,
      guestToken,
      kayakCustomization,
      regattaPreferences,
      duelPreferences,
      acceptsDuels,
      availableWindows,
      refusedDays,
      isAbsent,
      duelTimezone,
      duelInviteToken,
      inviteToken,
      referredBy,
      website_url,
      bot_trap,
    } = req.body || {};

    // 0. Protection Anti-Robots (Honeypot)
    const honeyField = website_url || bot_trap;
    if (honeyField && String(honeyField).trim() !== "") {
      // Simulation d'un succès immédiat sans écriture en base de données
      res.status(200).json({
        success: true,
        message: "Compte abonné créé avec succès.",
      });
      return;
    }

    const cleanLastName = String(lastName || nom || "").trim();
    const cleanFirstName = String(firstName || prenom || "").trim();
    const cleanLogin = String(login || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "").trim();
    const cleanGender = String(gender || sexe || "").trim();
    const cleanCountry = String(country || pays || "").trim();
    const rawBirthYear = Number(birthYear || anneeNaissance);

    if (!cleanLogin) {
      res.status(400).json({ success: false, message: "Le login est obligatoire." });
      return;
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(cleanLogin)) {
      res.status(400).json({
        success: false,
        message: "Le login doit comporter entre 3 et 32 caractères alphanumériques (tirets et soulignés autorisés)."
      });
      return;
    }
    const pwdCheck = validateStrongPassword(cleanPassword);
    if (!pwdCheck.valid) {
      res.status(400).json({ success: false, message: pwdCheck.message });
      return;
    }
    if (!cleanEmail || !cleanEmail.includes("@")) {
      res.status(400).json({ success: false, message: "Une adresse email valide est obligatoire." });
      return;
    }
    if (!cleanLastName || !cleanFirstName) {
      res.status(400).json({ success: false, message: "Le nom et le prénom sont obligatoires." });
      return;
    }
    if (!Number.isInteger(rawBirthYear) || rawBirthYear < 1900 || rawBirthYear > new Date().getFullYear()) {
      res.status(400).json({ success: false, message: "L'année de naissance doit être valide." });
      return;
    }
    if (!cleanGender) {
      res.status(400).json({ success: false, message: "Le sexe est obligatoire." });
      return;
    }
    if (!cleanCountry) {
      res.status(400).json({ success: false, message: "Le pays est obligatoire." });
      return;
    }

    // Vérifier l'unicité stricte du login
    const existingLogin = await userStore.findUser(cleanLogin);
    if (existingLogin) {
      if (isEmmaAdminUser(cleanLogin)) {
        // EmmaRacer est l'admin en dur : permet de configurer ou réclamer ses identifiants
        const { hash, salt } = hashPassword(cleanPassword);
        const updated = await userStore.updateUser(existingLogin.id, {
          name: `${cleanFirstName} ${cleanLastName}`.trim() || cleanLogin,
          email: cleanEmail,
          lastName: cleanLastName,
          nom: cleanLastName,
          firstName: cleanFirstName,
          prenom: cleanFirstName,
          birthYear: rawBirthYear,
          anneeNaissance: rawBirthYear,
          gender: cleanGender,
          sexe: cleanGender,
          country: cleanCountry,
          pays: cleanCountry,
          passwordHash: hash,
          passwordSalt: salt,
          isAdmin: true,
          isSubscriber: true,
          isConfirmed: true,
        });
        res.status(201).json({
          success: true,
          message: "Compte administratrice EmmaRacer configuré avec succès.",
          user: sanitizeUser(updated || existingLogin),
        });
        return;
      }

      res.status(409).json({ success: false, message: "Ce login est déjà utilisé. Veuillez en choisir un autre." });
      return;
    }

    // Vérifier l'unicité de l'email
    const existingEmail = await userStore.findUserByEmail(cleanEmail);
    if (existingEmail) {
      res.status(409).json({ success: false, message: "Cette adresse email est déjà associée à un compte." });
      return;
    }

    // Hachage sécurisé du mot de passe
    const { hash, salt } = hashPassword(cleanPassword);

    // EmmaRacer est administratrice en dur
    const isEmmaAdmin = isEmmaAdminUser(cleanLogin, `${cleanFirstName} ${cleanLastName}`);

    let initialKayak: KayakCustomization = DEFAULT_KAYAK_CUSTOMIZATION;
    if (kayakCustomization && typeof kayakCustomization === "object") {
      const { hullColor, bladeColor, pattern, glowColor } = kayakCustomization;
      if (
        isValidHexColor(hullColor) &&
        isValidHexColor(bladeColor) &&
        isValidHexColor(glowColor) &&
        VALID_PATTERNS.includes(pattern)
      ) {
        initialKayak = {
          hullColor: hullColor.trim(),
          bladeColor: bladeColor.trim(),
          pattern,
          glowColor: glowColor.trim(),
        };
      }
    }

    // Détection de la langue préférée de l'utilisateur
    const rawLang = String(req.body?.language || req.body?.lang || "").toLowerCase().trim();
    const acceptLang = String(req.headers["accept-language"] || "").toLowerCase();
    const isFrenchCountry = ["france", "fr", "belgique", "belgium", "suisse", "switzerland", "canada", "luxembourg"].some((c) =>
      cleanCountry.toLowerCase().includes(c)
    );
    let userLanguage = "fr";
    if (rawLang) {
      userLanguage = rawLang.startsWith("fr") ? "fr" : "en";
    } else if (isFrenchCountry) {
      userLanguage = "fr";
    } else if (acceptLang.startsWith("fr")) {
      userLanguage = "fr";
    } else if (acceptLang) {
      userLanguage = "en";
    }

    const resolvedDuelPreferences = sanitizeDuelPreferences(
      duelPreferences || {
        acceptsDuels,
        isAbsent,
        refusedDays,
        availableWindows,
        timezone: duelTimezone,
      }
    );

    const rawDuelInviteToken = String(duelInviteToken || inviteToken || "").trim();
    const pendingGuestChallenges = await duelService.findPendingGuestChallenges(
      cleanEmail,
      rawDuelInviteToken || undefined
    );
    const explicitReferredBy = referredBy ? String(referredBy).trim().slice(0, 64) : null;
    let resolvedReferredBy: string | null = null;
    if (explicitReferredBy) {
      const explicitReferrer = await userStore.findUser(explicitReferredBy);
      if (explicitReferrer) {
        resolvedReferredBy = explicitReferrer.id.slice(0, 64);
      }
    }
    if (!resolvedReferredBy && pendingGuestChallenges.length > 0) {
      const challengeReferrerId = String(pendingGuestChallenges[0].challengerUserId || "").trim().slice(0, 64);
      if (challengeReferrerId) {
        const challengeReferrer = await userStore.findUser(challengeReferrerId);
        if (challengeReferrer) {
          resolvedReferredBy = challengeReferrer.id.slice(0, 64);
        }
      }
    }

    const newUser = await userStore.createUser({
      id: cleanLogin,
      name: `${cleanFirstName} ${cleanLastName}`.trim() || cleanLogin,
      login: cleanLogin,
      email: cleanEmail,
      lastName: cleanLastName,
      nom: cleanLastName,
      firstName: cleanFirstName,
      prenom: cleanFirstName,
      birthYear: rawBirthYear,
      anneeNaissance: rawBirthYear,
      gender: cleanGender,
      sexe: cleanGender,
      country: cleanCountry,
      pays: cleanCountry,
      language: userLanguage,
      passwordHash: hash,
      passwordSalt: salt,
      isSubscriber: isEmmaAdmin,
      subscriptionTier: isEmmaAdmin ? "premium" : "free",
      isConfirmed: true,
      watchUserId: watchUserId ? String(watchUserId).trim() : undefined,
      isAdmin: isEmmaAdmin,
      totalRaces: 0,
      totalWins: 0,
      podiums: 0,
      points: 0,
      bestRank: 0,
      lastRank: 0,
      duelsWon: 0,
      duelsLost: 0,
      duelsDrawn: 0,
      duelPoints: 0,
      referredBy: resolvedReferredBy,
      kayakCustomization: initialKayak,
      regattaPreferences: sanitizeRegattaPreferences(regattaPreferences),
      duelPreferences: resolvedDuelPreferences,
    });

    if (pendingGuestChallenges.length > 0) {
      await duelService.linkGuestToRegisteredUser(newUser, rawDuelInviteToken || undefined);
    }

    // Migration automatique de l'appairage invité vers le nouveau compte abonné
    const tokenToMigrate = guestPairingToken || guestToken || req.body?.deviceToken || req.body?.guestUserId;
    let migratedPairing = false;
    if (tokenToMigrate) {
      try {
        migratedPairing = await pairingService.transferPairingTokenToUser(String(tokenToMigrate), newUser.login || newUser.id);
      } catch (migErr) {
        console.warn("[Register] Erreur migration appairage invité vers utilisateur:", migErr);
      }
    }
    if (req.body?.guestUserId && req.body?.guestUserId !== tokenToMigrate) {
      try {
        await pairingService.transferPairingTokenToUser(String(req.body.guestUserId), newUser.login || newUser.id);
      } catch {}
    }

    // Migration automatique des activités et courses réalisées en tant qu'invité
    const candidateGuestId = req.body?.guestUserId || tokenToMigrate;
    if (candidateGuestId && candidateGuestId !== newUser.id) {
      try {
        await migrateGuestActivities(String(candidateGuestId), newUser.id);
      } catch (actErr) {
        console.warn("[Register] Erreur migration activités invité:", actErr);
      }
    }

    // Envoi du courriel de bienvenue (de manière asynchrone sans bloquer la réponse HTTP)
    if (cleanEmail) {
      emailService.sendWelcomeEmail(cleanEmail, `${cleanFirstName} ${cleanLastName}`.trim(), cleanLogin, userLanguage).catch((mailErr) => {
        console.warn("[Register] Erreur non bloquante envoi email bienvenue:", mailErr);
      });
    }

    const sanitized = sanitizeUser(newUser);
    if (migratedPairing) {
      sanitized.isGarminPaired = true;
    }

    const effectiveRole = String(sanitized.role || "USER").toUpperCase();
    sanitized.role = effectiveRole;

    const token = JwtService.sign({
      userId: newUser.id,
      login: newUser.login,
      email: newUser.email,
      role: effectiveRole,
      isRevoked: Boolean(newUser.isRevoked),
    });

    res.status(201).json({
      success: true,
      message: "Compte abonné créé avec succès.",
      user: sanitized,
      token,
      isGarminPaired: Boolean(sanitized.isGarminPaired),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur lors de l'inscription: " + message });
  }
};

/**
 * POST /api/user/login
 * Connexion sécurisée avec login et mot de passe.
 */
export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { login, password, watchUserId, deviceToken, guestPairingToken, guestUserId } = req.body || {};

    const cleanLogin = String(login || "").trim();
    const cleanPassword = String(password || "").trim();

    if (!cleanLogin || !cleanPassword) {
      res.status(400).json({ success: false, message: "Le login et le mot de passe sont obligatoires." });
      return;
    }

    // Recherche par login ou email
    let user = await userStore.findUser(cleanLogin);
    if (!user && cleanLogin.includes("@")) {
      user = await userStore.findUserByEmail(cleanLogin);
    }

    if (!user) {
      res.status(401).json({ success: false, message: "Identifiants invalides." });
      return;
    }

    // Blocage immédiat des utilisateurs révoqués
    const isRevoked = Boolean(user.isRevoked || user.is_revoked);
    if (isRevoked) {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Compte révoqué. Accès interdit.",
      });
      return;
    }

    const storedHash = user.passwordHash;
    const storedSalt = user.passwordSalt;

    if (!storedHash || !storedSalt) {
      res.status(401).json({
        success: false,
        message: "Ce compte n'a pas de mot de passe configuré. Veuillez créer un compte abonné."
      });
      return;
    }

    const isValid = verifyPassword(cleanPassword, storedHash, storedSalt);
    if (!isValid) {
      res.status(401).json({ success: false, message: "Identifiants invalides." });
      return;
    }

    // Vérifier le statut EmmaRacer admin en dur
    const userLogin = user.login || user.id;
    const userName = user.name || "";
    const isEmma = isEmmaAdminUser(userLogin, userName);

    if (isEmma && (!user.isAdmin || !user.isSubscriber)) {
      user = (await userStore.updateUser(user.id, { isAdmin: true, isSubscriber: true })) || user;
    }

    if (watchUserId && !user.watchUserId) {
      user = (await userStore.updateUser(user.id, { watchUserId: String(watchUserId).trim() })) || user;
    }

    // Si une montre était déjà appairée dans le navigateur (invité / session en cours), la rattacher automatiquement au compte
    const canonicalAccountUserId = user.login || user.id;
    for (const candidateTokenOrId of [deviceToken, guestPairingToken, guestUserId, watchUserId]) {
      if (candidateTokenOrId && String(candidateTokenOrId).trim() && String(candidateTokenOrId).trim() !== canonicalAccountUserId) {
        try {
          await pairingService.transferPairingTokenToUser(String(candidateTokenOrId).trim(), canonicalAccountUserId);
        } catch {}
      }
    }

    if (guestUserId && String(guestUserId).trim() && String(guestUserId).trim() !== canonicalAccountUserId) {
      try {
        await migrateGuestActivities(String(guestUserId).trim(), canonicalAccountUserId);
      } catch {}
    }

    // Résolution du statut d'appairage Garmin associé de façon centrale au compte utilisateur
    let isGarminPaired = false;
    let pairedDevice: { deviceId?: string; deviceToken?: string } | null = null;
    try {
      const pairingStatus = await pairingService.getPairingStatus({ userId: user.id });
      if (pairingStatus && pairingStatus.paired) {
        isGarminPaired = true;
        pairedDevice = {
          deviceId: pairingStatus.deviceId,
          deviceToken: pairingStatus.deviceToken,
        };
      } else if (user.login && user.login !== user.id) {
        const pairingByLogin = await pairingService.getPairingStatus({ userId: user.login });
        if (pairingByLogin && pairingByLogin.paired) {
          isGarminPaired = true;
          pairedDevice = {
            deviceId: pairingByLogin.deviceId,
            deviceToken: pairingByLogin.deviceToken,
          };
        }
      }
    } catch {
      // Tolérance
    }

    const sanitized = sanitizeUser(user);
    sanitized.isGarminPaired = isGarminPaired;
    if (pairedDevice) sanitized.pairedDevice = pairedDevice;

    const effectiveRole = String(sanitized.role || "USER").toUpperCase();
    sanitized.role = effectiveRole;

    const token = JwtService.sign({
      userId: String(user.id),
      login: user.login || user.id,
      email: user.email,
      role: effectiveRole,
      isRevoked: false,
    });

    res.status(200).json({
      success: true,
      message: "Connexion réussie.",
      token,
      role: effectiveRole,
      user: sanitized,
      isGarminPaired,
      pairedDevice,
      isSubscriber: Boolean(sanitized.isSubscriber),
      isAdmin: Boolean(sanitized.isAdmin),
      subscriptionTier: sanitized.subscriptionTier,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur lors de la connexion: " + message });
  }
};

/**
 * POST /api/user/forgot-password
 * Prépare la procédure de réinitialisation du mot de passe (envoi d'un courriel avec jeton).
 */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailOrLogin } = req.body || {};
    const cleanInput = String(emailOrLogin || "").trim();

    if (!cleanInput) {
      res.status(400).json({ success: false, message: "Email ou login requis." });
      return;
    }

    let user = await userStore.findUser(cleanInput);
    if (!user && cleanInput.includes("@")) {
      user = await userStore.findUserByEmail(cleanInput);
    }

    if (!user) {
      // Pour éviter l'énumération des utilisateurs, on renvoie un message rassurant sans divulguer l'existence
      res.status(200).json({
        success: true,
        message: "Si un compte correspond à cette saisie, un courriel de réinitialisation avec un lien sécurisé a été envoyé.",
      });
      return;
    }

    // Génération d'un jeton cryptographique aléatoire de 64 caractères (32 octets hexadécimaux)
    const resetToken = generateSecureToken(32);
    // Expiration définie à exactement 1 heure (3 600 000 ms)
    const expires = new Date(Date.now() + 3600000);

    await userStore.updateUser(user.id, {
      resetPasswordToken: resetToken,
      resetPasswordExpires: expires,
    });

    if (user.email) {
      const rawLang = String(req.body?.language || req.body?.lang || user.language || "").toLowerCase().trim();
      const acceptLang = String(req.headers["accept-language"] || "").toLowerCase();
      const userCountry = String(user.country || user.pays || "").toLowerCase();
      const isFrenchCountry = ["france", "fr", "belgique", "belgium", "suisse", "switzerland", "canada", "luxembourg"].some((c) =>
        userCountry.includes(c)
      );
      let userLang = "en";
      if (rawLang) {
        userLang = rawLang.startsWith("fr") ? "fr" : "en";
      } else if (user.language) {
        userLang = user.language.startsWith("fr") ? "fr" : "en";
      } else if (isFrenchCountry || acceptLang.startsWith("fr")) {
        userLang = "fr";
      }
      await emailService.sendPasswordResetEmail(user.email, user.login || user.id, resetToken, userLang);
    }

    res.status(200).json({
      success: true,
      message: "Si un compte correspond à cette saisie, un courriel de réinitialisation avec un lien sécurisé a été envoyé.",
      token: process.env.NODE_ENV === "test" || !process.env.NODE_ENV ? resetToken : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur réinitialisation: " + message });
  }
};

/**
 * POST /api/user/reset-password
 * Réinitialisation du mot de passe à l'aide du jeton reçu.
 */
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body || {};

    const cleanToken = String(token || "").trim();
    const cleanNewPassword = String(newPassword || "").trim();

    if (!cleanToken) {
      res.status(400).json({
        success: false,
        message: "Le jeton de réinitialisation est obligatoire."
      });
      return;
    }

    const pwdCheck = validateStrongPassword(cleanNewPassword);
    if (!pwdCheck.valid) {
      res.status(400).json({
        success: false,
        message: pwdCheck.message
      });
      return;
    }

    // Recherche sécurisée et directe de l'utilisateur ayant ce jeton valide non expiré
    const targetUser = await userStore.findUserByResetToken(cleanToken);

    if (!targetUser) {
      res.status(400).json({
        success: false,
        message: "Ce lien de réinitialisation est invalide ou a expiré."
      });
      return;
    }

    const { hash, salt } = hashPassword(cleanNewPassword);

    await userStore.updateUser(targetUser.id, {
      passwordHash: hash,
      passwordSalt: salt,
      resetPasswordToken: undefined,
      resetPasswordExpires: undefined,
    });

    res.status(200).json({
      success: true,
      message: "Votre mot de passe a été mis à jour avec succès. Vous pouvez maintenant vous connecter.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur mise à jour mot de passe: " + message });
  }
};

/**
 * PUT /api/user/password
 * Permet à un utilisateur connecté de modifier son mot de passe en fournissant son mot de passe actuel.
 */
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = String(
      (req as any).user?.userId ||
        (req as any).user?.id ||
        (req as any).user?.login ||
        ""
    ).trim();

    if (!userId) {
      res.status(401).json({ success: false, message: "Authentification requise." });
      return;
    }

    const { currentPassword, newPassword } = req.body || {};
    const cleanCurrent = String(currentPassword || "").trim();
    const cleanNew = String(newPassword || "").trim();

    if (!cleanCurrent || !cleanNew) {
      res.status(400).json({
        success: false,
        message: "Le mot de passe actuel et le nouveau mot de passe sont requis.",
      });
      return;
    }

    const user = await userStore.findUser(userId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur non trouvé." });
      return;
    }

    const storedHash = user.passwordHash;
    const storedSalt = user.passwordSalt;

    if (!storedHash || !storedSalt) {
      res.status(400).json({
        success: false,
        message: "Ce compte n'a pas de mot de passe configuré.",
      });
      return;
    }

    const isCurrentValid = verifyPassword(cleanCurrent, storedHash, storedSalt);
    if (!isCurrentValid) {
      res.status(401).json({
        success: false,
        message: "Le mot de passe actuel est incorrect.",
      });
      return;
    }

    const pwdCheck = validateStrongPassword(cleanNew);
    if (!pwdCheck.valid) {
      res.status(400).json({
        success: false,
        message: pwdCheck.message,
      });
      return;
    }

    if (cleanCurrent === cleanNew) {
      res.status(400).json({
        success: false,
        message: "Le nouveau mot de passe doit être différent du mot de passe actuel.",
      });
      return;
    }

    const { hash, salt } = hashPassword(cleanNew);
    await userStore.updateUser(user.id, {
      passwordHash: hash,
      passwordSalt: salt,
      resetPasswordToken: undefined,
      resetPasswordExpires: undefined,
    });

    res.status(200).json({
      success: true,
      message: "Votre mot de passe a été modifié avec succès.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur modification mot de passe: " + message });
  }
};

/**
 * GET /api/user/account/:identifier
 * Retourne le compte complet d'un abonné (sans données de hachage).
 */
export const getUserAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureCurrentWeek();
    const { identifier } = req.params;
    const user = await userStore.findUser(identifier);

    if (!user) {
      res.status(404).json({ success: false, message: "Compte introuvable." });
      return;
    }

    const sanitized = sanitizeUser(user);
    try {
      const pairingStatus = await pairingService.getPairingStatus({ userId: user.id });
      if (pairingStatus && pairingStatus.paired) {
        sanitized.isGarminPaired = true;
        sanitized.pairedDevice = {
          deviceId: pairingStatus.deviceId,
          deviceToken: pairingStatus.deviceToken,
        };
      } else if (user.login && user.login !== user.id) {
        const pairingByLogin = await pairingService.getPairingStatus({ userId: user.login });
        if (pairingByLogin && pairingByLogin.paired) {
          sanitized.isGarminPaired = true;
          sanitized.pairedDevice = {
            deviceId: pairingByLogin.deviceId,
            deviceToken: pairingByLogin.deviceToken,
          };
        }
      }
    } catch {}

    res.status(200).json({
      success: true,
      account: sanitized,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur compte: " + message });
  }
};

/**
 * GET /api/user/profile/:userId
 * Retourne uniquement les classements et stats de courses, et les droits d'accès
 */
export const getUserProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureCurrentWeek();
    const { userId } = req.params;
    let user = await userStore.findUser(userId);

    const uName = user ? user.name : "";
    const isEmmaAdmin = isEmmaAdminUser(userId, uName);
    const isGuest = !userId || userId === "anonymous" || userId.startsWith("guest_") || userId.startsWith("usr_");

    if (!user) {
      if (isGuest && !isEmmaAdmin) {
        // Profil invité 100% virtuel en RAM (ne crée JAMAIS de ligne dans la table SQL Users)
        user = {
          id: userId,
          name: `Racer_${userId.slice(-4)}`,
          login: userId,
          totalRaces: 0,
          totalWins: 0,
          podiums: 0,
          points: 0,
          bestRank: 0,
          lastRank: 0,
          isAdmin: false,
          isSubscriber: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as StoredUser;
        userStore.cacheUser(user);
      } else {
        user = await userStore.createUser({
          id: userId,
          name: `Racer_${userId.slice(-4)}`,
          login: userId,
          totalRaces: 0,
          totalWins: 0,
          podiums: 0,
          points: 0,
          bestRank: 0,
          lastRank: 0,
          isAdmin: isEmmaAdmin,
          isSubscriber: isEmmaAdmin,
        });
      }
    } else if (isEmmaAdmin && (!user.isAdmin || !user.isSubscriber)) {
      user = (await userStore.updateUser(user.id, { isAdmin: true, isSubscriber: true })) || user;
    }

    if (!user) {
      res.status(404).json({ message: "Utilisateur introuvable" });
      return;
    }

    let pastActivities: any[] = [];
    try {
      pastActivities = await Activities.findAll({
        where: { userId },
        order: [["createdAt", "DESC"]],
        limit: 10,
        attributes: ["activityId", "targetDistance", "netDistance", "elapsedTime", "status", "finalRank", "createdAt"],
      });
    } catch {
      // Tolérance test / DB
    }

    const allUsers = await userStore.getAllUsersForLeaderboard();
    const generalRank = allUsers.findIndex((u) => u.id === userId || u.login === userId) + 1;

    // Résolution du statut d'appairage Garmin pour le profil
    let isGarminPaired = false;
    let pairedDevice: { deviceId?: string; deviceToken?: string } | null = null;
    try {
      const pairingStatus = await pairingService.getPairingStatus({ userId: user.id });
      if (pairingStatus && pairingStatus.paired) {
        isGarminPaired = true;
        pairedDevice = {
          deviceId: pairingStatus.deviceId,
          deviceToken: pairingStatus.deviceToken,
        };
      } else if (user.login && user.login !== user.id) {
        const pairingByLogin = await pairingService.getPairingStatus({ userId: user.login });
        if (pairingByLogin && pairingByLogin.paired) {
          isGarminPaired = true;
          pairedDevice = {
            deviceId: pairingByLogin.deviceId,
            deviceToken: pairingByLogin.deviceToken,
          };
        }
      }
    } catch {
      // Tolérance
    }

    const sanitized = sanitizeUser(user);
    sanitized.isGarminPaired = isGarminPaired;
    if (pairedDevice) sanitized.pairedDevice = pairedDevice;

    res.status(200).json({
      user: sanitized,
      isGarminPaired,
      pairedDevice,
      generalRank: generalRank > 0 ? generalRank : 1,
      totalPlayers: allUsers.length,
      history: pastActivities,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur profil: " + message });
  }
};

/**
 * GET /api/user/leaderboard
 * Retourne le classement général des joueurs basé sur les points accumulés.
 */
export const getGeneralLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { country, gender, ageCategory, category, league, age, minAge, maxAge, sortBy } = req.query;
    const currentYear = new Date().getFullYear();
    let all = await userStore.getAllUsersForLeaderboard();
    all = all.filter(
      (u) =>
        (u.totalRaces && u.totalRaces > 0) ||
        (u.points && u.points > 0) ||
        (u.totalWins && u.totalWins > 0) ||
        (u.duelsWon && u.duelsWon > 0) ||
        (u.duelsLost && u.duelsLost > 0) ||
        (u.duelsDrawn && u.duelsDrawn > 0)
    );

    if (league && typeof league === "string" && league.trim().toLowerCase() !== "all") {
      const targetLeague = league.trim().toUpperCase();
      all = all.filter((u) => String(u.currentLeague || u.league || "BRONZE").toUpperCase() === targetLeague);
    }

    if (country && typeof country === "string" && country.trim().toLowerCase() !== "all") {
      const targetCountry = country.trim().toLowerCase();
      all = all.filter((u) => (u.country || u.pays || "").toLowerCase() === targetCountry);
    }

    if (gender && typeof gender === "string" && gender.trim().toLowerCase() !== "all") {
      const targetGender = gender.trim().toLowerCase();
      all = all.filter((u) => {
        const g = (u.gender || u.sexe || "").toLowerCase();
        if (targetGender === "m" || targetGender === "homme") return g === "m" || g === "homme";
        if (targetGender === "f" || targetGender === "femme") return g === "f" || g === "femme";
        return g === targetGender;
      });
    }

    const effectiveAgeCat = (category || ageCategory) as string | undefined;
    if (effectiveAgeCat && typeof effectiveAgeCat === "string" && effectiveAgeCat.trim().toLowerCase() !== "all") {
      const cat = effectiveAgeCat.trim().toUpperCase();
      all = all.filter((u) => {
        const birth = u.birthYear || u.anneeNaissance;
        if (!birth || !Number.isFinite(birth)) return false;
        const playerAge = currentYear - birth;
        if (cat === "U19" || cat === "-19") return playerAge < 19;
        if (cat === "19-29" || cat === "SENIOR") return playerAge >= 19 && playerAge <= 29;
        if (cat === "30-39" || cat === "MASTER_A") return playerAge >= 30 && playerAge <= 39;
        if (cat === "40-49" || cat === "MASTER_B") return playerAge >= 40 && playerAge <= 49;
        if (cat === "50-59" || cat === "MASTER_C") return playerAge >= 50 && playerAge <= 59;
        if (cat === "60+" || cat === "MASTER_D") return playerAge >= 60;
        return true;
      });
    }

    if (age !== undefined && age !== "" && String(age).toLowerCase() !== "all") {
      const targetAge = Number(age);
      if (Number.isFinite(targetAge)) {
        all = all.filter((u) => {
          const birth = u.birthYear || u.anneeNaissance;
          return Boolean(birth && currentYear - birth === targetAge);
        });
      }
    }

    if (minAge !== undefined && minAge !== "") {
      const minA = Number(minAge);
      if (Number.isFinite(minA)) {
        all = all.filter((u) => {
          const birth = u.birthYear || u.anneeNaissance;
          return Boolean(birth && currentYear - birth >= minA);
        });
      }
    }

    if (maxAge !== undefined && maxAge !== "") {
      const maxA = Number(maxAge);
      if (Number.isFinite(maxA)) {
        all = all.filter((u) => {
          const birth = u.birthYear || u.anneeNaissance;
          return Boolean(birth && currentYear - birth <= maxA);
        });
      }
    }

    if (sortBy === "duels") {
      all.sort((a, b) => {
        const wonDiff = (b.duelsWon || 0) - (a.duelsWon || 0);
        if (wonDiff !== 0) return wonDiff;
        const ptsDiff = (b.duelPoints || 0) - (a.duelPoints || 0);
        if (ptsDiff !== 0) return ptsDiff;
        return (a.duelsLost || 0) - (b.duelsLost || 0);
      });
    }

    const players = all.slice(0, 100).map((u) => {
      const leagueInfo = getLeagueByPoints(u.points);
      const duelPrefs = sanitizeDuelPreferences(u.duelPreferences);
      return {
        id: u.id,
        login: u.login || u.id,
        name: u.login || u.name,
        points: u.points,
        league: u.league || leagueInfo.id,
        currentLeague: String(u.currentLeague || u.league || "BRONZE").toUpperCase(),
        leagueName: leagueInfo.name,
        leagueBadge: leagueInfo.badge,
        totalRaces: u.totalRaces,
        totalWins: u.totalWins,
        podiums: u.podiums,
        bestRank: u.bestRank,
        lastRank: u.lastRank,
        duelsWon: u.duelsWon || 0,
        duelsLost: u.duelsLost || 0,
        duelsDrawn: u.duelsDrawn || 0,
        duelPoints: u.duelPoints || 0,
        acceptsDuels: duelPrefs.acceptsDuels,
        isSubscriber: u.isSubscriber,
        isAdmin: u.isAdmin,
        country: u.country || u.pays || "",
        gender: u.gender || u.sexe || "",
        birthYear: u.birthYear || u.anneeNaissance || null,
      };
    });

    res.status(200).json({
      success: true,
      players,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur classement général: " + message });
  }
};

/**
 * POST /api/user/unsubscribe
 * Permet à un utilisateur abonné de résilier son abonnement et de repasser en offre gratuite.
 */
function isAuthorizedForUser(req: Request, targetId: string): boolean {
  const authUser = (req as any).user;
  if (!authUser) return true;
  const isSelf = Boolean(
    (authUser.id && targetId === String(authUser.id)) ||
    (authUser.login && targetId === String(authUser.login))
  );
  const isAdmin = Boolean(authUser.isAdmin || authUser.role === "ADMIN" || isEmmaAdminUser(authUser.id, authUser.name));
  return isSelf || isAdmin;
}

export const unsubscribeUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.body || {};
    const cleanId = String(userId || (req as any).user?.id || (req as any).user?.login || "").trim();
    if (!cleanId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis." });
      return;
    }

    if (!isAuthorizedForUser(req, cleanId)) {
      res.status(403).json({ success: false, message: "Accès refusé : vous ne pouvez résilier que votre propre compte." });
      return;
    }

    const user = await userStore.findUser(cleanId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const isEmma = isEmmaAdminUser(user.id, user.name);
    const oldTier = String(user.subscriptionTier || "intermediate").toLowerCase();

    // Résiliation Stripe si abonnement Stripe actif
    if (!isEmma && user.stripeSubscriptionId) {
      try {
        await stripeService.cancelSubscription(user.stripeSubscriptionId, false);
      } catch (e) {
        console.warn("[unsubscribeUser] Erreur annulation Stripe:", e);
      }
    }

    const updated = await userStore.updateUser(user.id, {
      isSubscriber: isEmma ? true : false,
      subscriptionTier: isEmma ? "premium" : "free",
      subscriptionStatus: isEmma ? "active" : "canceled",
    });

    // Envoi du courriel transactionnel de confirmation de résiliation
    if (!isEmma && user.email) {
      const planName = oldTier === "premium" ? "Offre Élite Pro" : "Offre Club";
      const userLang = (user.language || (req.headers["accept-language"] || "fr")).toString().toLowerCase().startsWith("fr") ? "fr" : "en";
      try {
        await emailService.sendSubscriptionCancellationEmail(
          user.email,
          user.name || user.login,
          planName,
          undefined,
          userLang
        );
      } catch (err) {
        console.warn("[unsubscribeUser] Erreur envoi email résiliation:", err);
      }
    }

    res.status(200).json({
      success: true,
      message: "Abonnement résilié avec succès. Vous conservez votre compte en offre gratuite avec accès aux 10 derniers jours de statistiques.",
      user: sanitizeUser(updated || user),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur résiliation abonnement: " + message });
  }
};

/**
 * DELETE /api/user/account
 * DELETE /api/user/account/:userId
 * Suppression définitive du compte utilisateur et de ses données associées (Conformité RGPD Art. 17).
 */
export const deleteUserAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.body?.userId || req.params?.userId || req.query?.userId;
    const cleanId = String(userId || (req as any).user?.id || (req as any).user?.login || "").trim();
    if (!cleanId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis pour la suppression." });
      return;
    }

    if (!isAuthorizedForUser(req, cleanId)) {
      res.status(403).json({ success: false, message: "Accès refusé : vous ne pouvez supprimer que votre propre compte." });
      return;
    }

    const user = await userStore.findUser(cleanId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    if (isEmmaAdminUser(user.id, user.name)) {
      res.status(403).json({ success: false, message: "Le compte administratrice EmmaRacer ne peut pas être supprimé." });
      return;
    }

    const userEmail = user.email;
    const userDisplayName = user.name || user.login;
    const stripeSubId = user.stripeSubscriptionId;

    // Résiliation immédiate de l'abonnement Stripe en cours sans frais résiduels
    if (stripeSubId) {
      try {
        await stripeService.cancelSubscription(stripeSubId, true);
      } catch (e) {
        console.warn("[deleteUserAccount] Erreur annulation immédiate Stripe:", e);
      }
    }

    // Envoi de l'email de confirmation de fermeture de compte
    if (userEmail) {
      try {
        const userLang = (user.language || (req.headers["accept-language"] || "fr")).toString().toLowerCase().startsWith("fr") ? "fr" : "en";
        await emailService.sendAccountClosureEmail(userEmail, userDisplayName, userLang);
      } catch (err) {
        console.warn("[deleteUserAccount] Erreur envoi email suppression compte:", err);
      }
    }

    // Purge de l'historique d'activités associé
    userStore.purgeUserActivities(user.id, [user.login, user.watchUserId || ""]);
    try {
      await Activities.destroy({
        where: {
          [Op.or]: [
            { userId: user.id },
            { userId: user.login },
            ...(user.watchUserId ? [{ userId: user.watchUserId }] : [])
          ]
        }
      });
    } catch {
      // Tolérance
    }

    await userStore.deleteUser(user.id);

    res.status(200).json({
      success: true,
      message: "Votre compte et l'ensemble de vos données personnelles et sportives ont été définitivement supprimés.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur suppression de compte: " + message });
  }
};

const getActField = (act: any, field: string): any => {
  if (!act) return undefined;
  if (typeof act.get === "function") {
    return act.get(field);
  }
  return act[field];
};

/**
 * GET /api/user/statistics
 * GET /api/user/statistics/:userId
 * Espace statistiques et analyses de courses :
 * - Utilisateur abonné : historique complet illimité de toutes les précédentes courses
 * - Utilisateur avec un compte mais non-abonné (gratuit) : limité aux 10 derniers jours
 */
export const getUserStatistics = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params?.userId || req.query?.userId;
    const cleanId = String(userId || "").trim();
    if (!cleanId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis." });
      return;
    }

    const user = await userStore.findUser(cleanId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable. Veuillez vous connecter avec votre compte." });
      return;
    }

    const isEmma = isEmmaAdminUser(user.id, user.name);
    const resolvedTier = String(user.subscriptionTier || "free").toLowerCase().trim();
    const isPaidTier = resolvedTier !== "free" && resolvedTier !== "none" && Boolean(resolvedTier);
    const isSubscriber = Boolean(isEmma || user.isAdmin || (isPaidTier && (user.isSubscriber ?? true)));

    let allUserActivities: any[] = [];
    try {
      allUserActivities = await Activities.findAll({
        where: {
          [Op.or]: [
            { userId: user.id },
            { userId: user.login },
            ...(user.watchUserId ? [{ userId: user.watchUserId }] : [])
          ],
          isBot: false,
        },
        order: [["createdAt", "DESC"]]
      });
    } catch {
      allUserActivities = [];
    }

    if (allUserActivities.length === 0) {
      allUserActivities = userStore.findActivitiesForUser(user.id, [user.login, user.watchUserId || ""]);
    }

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const totalRacesAvailable = allUserActivities.length;

    let filteredActivities = allUserActivities;
    let olderRacesLocked = 0;

    if (!isSubscriber) {
      filteredActivities = allUserActivities.filter((act) => {
        const d = new Date(getActField(act, "createdAt") || getActField(act, "updatedAt") || Date.now());
        return d >= tenDaysAgo;
      });
      olderRacesLocked = totalRacesAvailable - filteredActivities.length;
    }

    let totalDist = 0;
    let totalSec = 0;
    let sumWatts = 0;
    let wattsCount = 0;
    let bestPace = 0;
    let wins = 0;
    let podiums = 0;

    const mapped = filteredActivities.map((act) => {
      const netDist = Number(getActField(act, "netDistance")) || 0;
      const targetDist = Number(getActField(act, "targetDistance")) || 0;
      const elSec = Number(getActField(act, "elapsedTime")) || 0;
      const pwr = Number(getActField(act, "avgPower") || getActField(act, "lastPower")) || 0;
      const pace = Number(getActField(act, "avgPace") || getActField(act, "lastPace")) || 0;
      const spm = Number(getActField(act, "avgStrokeRate") || getActField(act, "lastStrokeRate")) || 0;
      const strokes = Number(getActField(act, "totalStrokes") || getActField(act, "lastStrokeCount")) || 0;
      const energy = Number(getActField(act, "totalEnergy")) || 0;
      const rawRank = getActField(act, "finalRank");
      const rank = rawRank !== undefined && rawRank !== null ? Number(rawRank) : undefined;
      const status = String(getActField(act, "status") || "finished");

      totalDist += netDist;
      totalSec += elSec;
      if (pwr > 0) {
        sumWatts += pwr;
        wattsCount++;
      }
      if (pace > 0 && (bestPace === 0 || pace < bestPace)) {
        bestPace = pace;
      }
      if (rank === 1) wins++;
      if (rank && rank <= 3) podiums++;

      return {
        id: getActField(act, "id"),
        activityId: getActField(act, "activityId"),
        createdAt: getActField(act, "createdAt"),
        netDistance: netDist,
        targetDistance: targetDist,
        elapsedTime: elSec,
        avgPower: pwr,
        avgPace: pace,
        avgStrokeRate: spm,
        totalStrokes: strokes,
        totalEnergy: energy,
        finalRank: rank,
        status,
        watchModel: getActField(act, "watchModel"),
        rowerModel: getActField(act, "rowerModel"),
      };
    });

    const avgPower = wattsCount > 0 ? Math.round(sumWatts / wattsCount) : 0;

    res.status(200).json({
      success: true,
      isSubscriber,
      subscriptionTier: user.subscriptionTier || (isSubscriber ? "intermediate" : "free"),
      historyDaysLimit: isSubscriber ? null : 10,
      totalRacesAvailable,
      olderRacesLocked,
      summary: {
        totalRaces: filteredActivities.length,
        totalDistanceMeters: totalDist,
        totalDurationSeconds: totalSec,
        avgPowerWatts: avgPower,
        bestPaceSec: bestPace,
        totalWins: wins,
        podiums,
      },
      activities: mapped,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur récupération statistiques: " + message });
  }
};

/**
 * PUT /api/user/kayak
 * Met à jour la personnalisation visuelle du kayak (couleurs, motif, aura lumineuse).
 */
export const updateKayakCustomization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, kayakCustomization } = req.body || {};
    const cleanUserId = String(userId || (req as any).user?.id || (req as any).user?.login || "").trim();

    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis." });
      return;
    }

    if (!isAuthorizedForUser(req, cleanUserId)) {
      res.status(403).json({ success: false, message: "Accès refusé : vous ne pouvez modifier que votre propre kayak." });
      return;
    }
    if (!kayakCustomization || typeof kayakCustomization !== "object") {
      res.status(400).json({ success: false, message: "La configuration du kayak est requise." });
      return;
    }

    const { hullColor, bladeColor, pattern, glowColor } = kayakCustomization;
    if (!isValidHexColor(hullColor) || !isValidHexColor(bladeColor) || !isValidHexColor(glowColor)) {
      res.status(400).json({ success: false, message: "Les couleurs doivent être au format hexadécimal (#RRGGBB)." });
      return;
    }
    if (!VALID_PATTERNS.includes(pattern)) {
      res.status(400).json({ success: false, message: "Le motif choisi est invalide." });
      return;
    }

    const cleanCustomization: KayakCustomization = {
      hullColor: hullColor.trim(),
      bladeColor: bladeColor.trim(),
      pattern,
      glowColor: glowColor.trim(),
    };

    const user = (await userStore.getUserById(cleanUserId)) || (await userStore.findUser(cleanUserId));
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const updated = await userStore.updateUser(cleanUserId, { kayakCustomization: cleanCustomization });
    raceManager.updateParticipantKayak(cleanUserId, cleanCustomization);
    res.status(200).json({
      success: true,
      message: "Style du kayak mis à jour avec succès.",
      user: sanitizeUser(updated || user),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || "Erreur lors de la mise à jour du kayak." });
  }
};

/**
 * PUT /api/user/regatta-preferences
 * Met à jour les préférences d'affichage en mode régate (niveau de zoom et données affichées sous le canevas).
 */
export const updateRegattaPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, regattaPreferences } = req.body || {};
    const cleanUserId = String(userId || (req as any).user?.id || (req as any).user?.login || "").trim();

    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis." });
      return;
    }

    if (!isAuthorizedForUser(req, cleanUserId)) {
      res.status(403).json({ success: false, message: "Accès refusé : vous ne pouvez modifier que vos propres préférences." });
      return;
    }
    if (!regattaPreferences || typeof regattaPreferences !== "object") {
      res.status(400).json({ success: false, message: "Les préférences de régate sont requises." });
      return;
    }

    const validSet = new Set<string>(VALID_REGATTA_METRICS);
    if (!Array.isArray(regattaPreferences.selectedMetrics)) {
      res.status(400).json({ success: false, message: "La liste des données à afficher est requise." });
      return;
    }

    const filteredMetrics = regattaPreferences.selectedMetrics
      .map((m: any) => String(m || "").trim())
      .filter((m: string, idx: number, arr: string[]) => validSet.has(m) && arr.indexOf(m) === idx) as RegattaMetricKey[];

    if (filteredMetrics.length < 3) {
      res.status(400).json({
        success: false,
        message: "Veuillez sélectionner au minimum 3 données à afficher sous les lignes d'eau.",
      });
      return;
    }

    const cleanPreferences = sanitizeRegattaPreferences({
      zoomLevel: regattaPreferences.zoomLevel,
      selectedMetrics: filteredMetrics,
      myLaneMetrics: regattaPreferences.myLaneMetrics,
      myLanePosition: regattaPreferences.myLanePosition,
      myHeaderMetric: regattaPreferences.myHeaderMetric,
      opponentLaneMetrics: regattaPreferences.opponentLaneMetrics,
      opponentLanePosition: regattaPreferences.opponentLanePosition,
      opponentHeaderMetric: regattaPreferences.opponentHeaderMetric,
      watermarkMetric: regattaPreferences.watermarkMetric,
    });

    const user = (await userStore.getUserById(cleanUserId)) || (await userStore.findUser(cleanUserId));
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const updated = await userStore.updateUser(cleanUserId, { regattaPreferences: cleanPreferences });
    res.status(200).json({
      success: true,
      message: "Préférences d'affichage en régate enregistrées avec succès.",
      user: sanitizeUser(updated || user),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || "Erreur lors de la mise à jour des préférences de régate.",
    });
  }
};

/**
 * GET /api/auth/me ou /api/user/me
 * Retourne le profil de l'utilisateur authentifié via Bearer token
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    if (!token) {
      res.status(401).json({ success: false, message: "Authentification requise." });
      return;
    }

    const check = JwtService.verify(token);
    if (!check.valid || !check.payload) {
      res.status(401).json({ success: false, message: "Jeton invalide ou expiré." });
      return;
    }

    let user: any = null;
    try {
      user = await db.users.findByPk(check.payload.userId);
    } catch {}
    if (!user) {
      user = await userStore.findUser(check.payload.userId);
    }
    if (!user && check.payload.login) {
      user = await userStore.findUser(check.payload.login);
    }

    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur non trouvé." });
      return;
    }

    if (Boolean(user.isRevoked || user.is_revoked)) {
      res.status(403).json({ success: false, message: "Compte révoqué." });
      return;
    }

    const sanitized = sanitizeUser(user);
    res.status(200).json({
      success: true,
      user: sanitized,
      role: sanitized.role,
      isAdmin: sanitized.isAdmin,
      isSubscriber: sanitized.isSubscriber,
      subscriptionTier: sanitized.subscriptionTier,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur getMe: " + message });
  }
};

/**
 * PUT /api/user/language
 * Met à jour la langue préférée de l'utilisateur ('fr', 'en', etc.).
 */
export const updateUserLanguage = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawLang = String(req.body?.language || req.body?.lang || "").toLowerCase().trim();
    const cleanLang = rawLang.startsWith("fr") ? "fr" : "en";
    const userId = String(
      (req as any).user?.userId ||
        (req as any).user?.id ||
        (req as any).user?.login ||
        req.body?.userId ||
        ""
    ).trim();

    if (!userId) {
      res.status(401).json({ success: false, message: "Authentification requise." });
      return;
    }

    const user = await userStore.findUser(userId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur non trouvé." });
      return;
    }

    const updated = await userStore.updateUser(user.id, { language: cleanLang });
    res.status(200).json({
      success: true,
      message: "Langue mise à jour avec succès.",
      language: cleanLang,
      user: sanitizeUser(updated || user),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur mise à jour langue: " + message });
  }
};

/**
 * PUT /api/user/duel-preferences
 * Met à jour les préférences et disponibilités de duel d'un abonné.
 */
export const updateDuelPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, duelPreferences } = req.body || {};
    const cleanUserId = String(userId || (req as any).user?.id || (req as any).user?.login || "").trim();

    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis." });
      return;
    }

    if (!isAuthorizedForUser(req, cleanUserId)) {
      res.status(403).json({ success: false, message: "Accès refusé : vous ne pouvez modifier que vos propres préférences." });
      return;
    }

    const user = (await userStore.getUserById(cleanUserId)) || (await userStore.findUser(cleanUserId));
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const cleanPrefs = sanitizeDuelPreferences(duelPreferences || req.body);
    const updated = await userStore.updateUser(user.id, { duelPreferences: cleanPrefs });
    res.status(200).json({
      success: true,
      message: "Préférences et disponibilités de duel enregistrées avec succès.",
      duelPreferences: cleanPrefs,
      user: sanitizeUser(updated || user),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur mise à jour préférences duel: " + message });
  }
};

export default {
  registerUser,
  loginUser,
  getMe,
  forgotPassword,
  resetPassword,
  changePassword,
  getUserAccount,
  getUserProfile,
  getGeneralLeaderboard,
  unsubscribeUser,
  deleteUserAccount,
  getUserStatistics,
  updateKayakCustomization,
  updateRegattaPreferences,
  updateDuelPreferences,
  updateUserLanguage,
};
