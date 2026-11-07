import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import { hashPassword, verifyPassword, isEmmaAdminUser, generateSecureToken } from "../services/auth.service";
import emailService from "../services/email.service";
import userStore from "../services/user-store.service";
import raceManager from "../services/race-manager.service";

const Activities = db.activities;

/**
 * Sanitise l'objet utilisateur pour ne jamais exposer de données sensibles (mot de passe / sel / tokens).
 */
function sanitizeUser(user: any): Record<string, any> {
  const plain = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete plain.passwordHash;
  delete plain.passwordSalt;
  delete plain.resetPasswordToken;
  delete plain.resetPasswordExpires;
  return plain;
}

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
    } = req.body || {};

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
    if (!cleanPassword || cleanPassword.length < 4) {
      res.status(400).json({ success: false, message: "Un mot de passe d'au moins 4 caractères est requis." });
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
      passwordHash: hash,
      passwordSalt: salt,
      isSubscriber: true, // Les inscrits sont abonnés et ont le droit de créer des salons privés
      isConfirmed: isEmmaAdmin, // EmmaRacer auto-confirmée, les autres confirmables via Garmin
      watchUserId: watchUserId ? String(watchUserId).trim() : undefined,
      isAdmin: isEmmaAdmin,
      totalRaces: 0,
      totalWins: 0,
      podiums: 0,
      points: 0,
      bestRank: 0,
      lastRank: 0,
    });

    // Créer une demande de confirmation d'inscription pour l'application Garmin
    const confirmReqId = `REG_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await userStore.createLoginRequest({
      id: confirmReqId,
      userId: watchUserId ? String(watchUserId).trim() : cleanLogin,
      login: cleanLogin,
      status: "pending",
    });

    // Envoi du courriel de bienvenue (préparé pour la production)
    emailService.sendWelcomeEmail(cleanEmail, `${cleanFirstName} ${cleanLastName}`, cleanLogin).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Compte abonné créé avec succès. Le login sert à confirmer l'inscription sur votre montre Garmin.",
      user: sanitizeUser(newUser),
      confirmationRequestId: confirmReqId,
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
    const { login, password, watchUserId } = req.body || {};

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

    res.status(200).json({
      success: true,
      message: "Connexion réussie.",
      user: sanitizeUser(user),
      isSubscriber: Boolean(user.isSubscriber || isEmma),
      isAdmin: Boolean(user.isAdmin || isEmma),
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
      // Pour éviter l'énumération des utilisateurs, on renvoie un message générique
      res.status(200).json({
        success: true,
        message: "Si un compte correspond à cette saisie, un courriel de réinitialisation sera envoyé.",
      });
      return;
    }

    const resetToken = generateSecureToken(24);
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure de validité

    await userStore.updateUser(user.id, {
      resetPasswordToken: resetToken,
      resetPasswordExpires: expires,
    });

    if (user.email) {
      await emailService.sendPasswordResetEmail(user.email, user.login || user.id, resetToken);
    }

    res.status(200).json({
      success: true,
      message: "Si un compte correspond à cette saisie, un courriel de réinitialisation sera envoyé.",
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

    if (!cleanToken || !cleanNewPassword || cleanNewPassword.length < 4) {
      res.status(400).json({
        success: false,
        message: "Le jeton et un nouveau mot de passe d'au moins 4 caractères sont requis."
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
 * GET /api/user/account/:identifier
 * Retourne le compte complet d'un abonné (sans données de hachage).
 */
export const getUserAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier } = req.params;
    const user = await userStore.findUser(identifier);

    if (!user) {
      res.status(404).json({ success: false, message: "Compte introuvable." });
      return;
    }

    res.status(200).json({
      success: true,
      account: sanitizeUser(user),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur compte: " + message });
  }
};

/**
 * POST /api/user/auth/request
 * Déclenché quand le joueur entre son login et son identifiant sur le front web.
 * Vérifie que la montre est active (activité récente).
 * Si oui, crée une demande d'autorisation pour la montre.
 */
export const requestWebLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, login, prefix, suffix } = req.body || {};

    let targetUserId = userId;
    let targetLogin = login;

    if (suffix) {
      const cleanPrefix = String(prefix || "Rower").trim().slice(0, 10) || "Rower";
      const cleanSuffix = String(suffix).trim();
      targetUserId = `${cleanPrefix}_${cleanSuffix}`;
      targetLogin = cleanPrefix;
    }

    if (!targetUserId || !targetLogin) {
      res.status(400).json({ success: false, message: "userId et login (ou prefix et suffix) requis" });
      return;
    }

    const isPairingAttempt = Boolean(suffix);

    if (!isPairingAttempt) {
      // Vérifier si la montre a lancé l'application (présence d'une activité au cours des 10 dernières minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      let activeActivity = null;
      try {
        activeActivity = await Activities.findOne({
          where: {
            userId: targetUserId,
            updatedAt: { [Op.gte]: tenMinutesAgo },
          },
          order: [["updatedAt", "DESC"]],
        });
      } catch {
        // Tolérance test / hors-ligne
      }

      const inActiveRace = raceManager.isRacerActive(targetUserId) ||
        Boolean(raceManager.getCurrentPublicRace()?.participants?.has(targetUserId));

      if (!activeActivity && !inActiveRace && process.env.NODE_ENV !== "test" && !process.env.TEST_MODE) {
        res.status(403).json({
          success: false,
          error: "WATCH_NOT_CONNECTED",
          message: "L'application Garmin Rower Race doit être lancée sur votre montre pour vous connecter.",
        });
        return;
      }
    }

    // Créer ou renouveler la demande d'authentification
    const requestId = `REQ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const loginReq = await userStore.createLoginRequest({
      id: requestId,
      userId: targetUserId,
      login: targetLogin,
      status: "pending",
    });

    res.status(200).json({
      success: true,
      requestId: loginReq.id,
      userId: targetUserId,
      login: targetLogin,
      message: "Demande envoyée à votre montre. Veuillez accepter sur votre montre Garmin.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur demande login: " + message });
  }
};

/**
 * GET /api/user/auth/status/:requestId
 * Le front Angular consulte si la montre a accepté la connexion
 */
export const checkWebLoginStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const loginReq = await userStore.findLoginRequestById(requestId);

    if (!loginReq) {
      res.status(404).json({ success: false, message: "Demande de connexion introuvable" });
      return;
    }

    res.status(200).json({
      success: true,
      status: loginReq.status,
      userId: loginReq.userId,
      login: loginReq.login,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur statut login: " + message });
  }
};

/**
 * GET /api/user/auth/pending?userId=...
 * La montre Garmin consulte régulièrement s'il y a une demande de connexion du front web ou confirmation d'inscription
 */
export const getPendingLoginRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, login } = req.query;
    const lookupId = String(userId || login || "").trim();

    if (!lookupId) {
      res.status(400).json({ success: false, message: "userId ou login requis" });
      return;
    }

    const pending = await userStore.findPendingLoginRequest(lookupId);

    if (!pending) {
      res.status(200).json({ hasPending: false });
      return;
    }

    res.status(200).json({
      hasPending: true,
      requestId: pending.id,
      login: pending.login,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur attente login: " + message });
  }
};

/**
 * POST /api/user/auth/respond
 * La montre Garmin accepte ou refuse la connexion ou l'inscription
 */
export const respondLoginRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId, approved } = req.body;
    const pending = await userStore.findLoginRequestById(requestId);

    if (!pending) {
      res.status(404).json({ success: false, message: "Demande introuvable" });
      return;
    }

    const updated = await userStore.updateLoginRequest(requestId, {
      status: approved ? "approved" : "rejected",
      respondedAt: new Date(),
    });

    if (approved) {
      const uId = pending.userId;
      const uLogin = pending.login;

      let user = await userStore.findUser(uLogin) || await userStore.findUser(uId);
      const isEmmaAdmin = isEmmaAdminUser(uLogin, uId);

      if (!user) {
        user = await userStore.createUser({
          id: uId,
          name: uLogin,
          login: uLogin,
          watchUserId: uId,
          isSubscriber: isEmmaAdmin,
          isConfirmed: true,
          totalRaces: 0,
          totalWins: 0,
          podiums: 0,
          isAdmin: isEmmaAdmin,
        });
      } else {
        user = (await userStore.updateUser(user.id, {
          name: user.name || uLogin,
          isConfirmed: true,
          watchUserId: uId,
          isAdmin: Boolean(isEmmaAdmin || user.isAdmin),
          isSubscriber: Boolean(isEmmaAdmin || user.isSubscriber),
        })) || user;
      }

      if (user && user.email) {
        emailService.sendRegistrationConfirmationEmail(user.email, uLogin).catch(() => {});
      }
    }

    res.status(200).json({ success: true, status: updated?.status || (approved ? "approved" : "rejected") });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur réponse login: " + message });
  }
};

/**
 * GET /api/user/profile/:userId
 * Retourne uniquement les classements et stats de courses, et les droits d'accès
 */
export const getUserProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    let user = await userStore.findUser(userId);

    const uName = user ? user.name : "";
    const isEmmaAdmin = isEmmaAdminUser(userId, uName);

    if (!user) {
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
    } else if (isEmmaAdmin && (!user.isAdmin || !user.isSubscriber)) {
      user = (await userStore.updateUser(user.id, { isAdmin: true, isSubscriber: true })) || user;
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

    res.status(200).json({
      user: sanitizeUser(user),
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
    const { country, gender, ageCategory } = req.query;
    const currentYear = new Date().getFullYear();
    let all = await userStore.getAllUsersForLeaderboard();
    all = all.filter((u) => (u.totalRaces && u.totalRaces > 0) || (u.points && u.points > 0) || (u.totalWins && u.totalWins > 0));

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

    if (ageCategory && typeof ageCategory === "string" && ageCategory.trim().toLowerCase() !== "all") {
      const cat = ageCategory.trim().toUpperCase();
      all = all.filter((u) => {
        const birth = u.birthYear || u.anneeNaissance;
        if (!birth || !Number.isFinite(birth)) return false;
        const age = currentYear - birth;
        if (cat === "U19" || cat === "-19") return age < 19;
        if (cat === "19-29" || cat === "SENIOR") return age >= 19 && age <= 29;
        if (cat === "30-39" || cat === "MASTER_A") return age >= 30 && age <= 39;
        if (cat === "40-49" || cat === "MASTER_B") return age >= 40 && age <= 49;
        if (cat === "50-59" || cat === "MASTER_C") return age >= 50 && age <= 59;
        if (cat === "60+" || cat === "MASTER_D") return age >= 60;
        return true;
      });
    }

    const players = all.slice(0, 100).map((u) => ({
      id: u.id,
      name: u.name,
      points: u.points,
      totalRaces: u.totalRaces,
      totalWins: u.totalWins,
      podiums: u.podiums,
      bestRank: u.bestRank,
      lastRank: u.lastRank,
      isSubscriber: u.isSubscriber,
      isAdmin: u.isAdmin,
      country: u.country || u.pays || "",
      gender: u.gender || u.sexe || "",
      birthYear: u.birthYear || u.anneeNaissance || null,
    }));

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
 * PUT /api/user/prefix
 * Permet aux utilisateurs abonnés de personnaliser la première partie de leur identifiant joueur.
 */
export const updateUserPrefix = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, userPrefix } = req.body || {};
    const cleanUserId = String(userId || "").trim();
    const cleanPrefix = String(userPrefix || "").trim();

    if (!cleanUserId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est obligatoire." });
      return;
    }

    if (!cleanPrefix || !/^[a-zA-Z0-9]{3,12}$/.test(cleanPrefix)) {
      res.status(400).json({
        success: false,
        message: "Le préfixe doit comporter entre 3 et 12 caractères alphanumériques (sans espaces ni caractères spéciaux)."
      });
      return;
    }

    const user = await userStore.findUser(cleanUserId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const isEmma = isEmmaAdminUser(user.login || user.id, user.name);
    if (!user.isSubscriber && !user.isAdmin && !isEmma) {
      res.status(403).json({
        success: false,
        message: "Seuls les abonnés actifs ont le privilège de personnaliser leur préfixe d'identifiant joueur."
      });
      return;
    }

    const suffix = user.userSuffix || "IQ" + Math.random().toString(36).substring(2, 5).toUpperCase();
    const updated = await userStore.updateUser(user.id, {
      userPrefix: cleanPrefix,
      userSuffix: suffix
    });

    res.status(200).json({
      success: true,
      message: "Préfixe mis à jour avec succès.",
      userPrefix: cleanPrefix,
      userSuffix: suffix,
      fullPlayerId: `${cleanPrefix}_${suffix}`,
      user: sanitizeUser(updated || user)
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur mise à jour préfixe: " + message });
  }
};

/**
 * POST /api/user/unsubscribe
 * Permet à un utilisateur abonné de résilier son abonnement et de repasser en offre gratuite.
 */
export const unsubscribeUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.body || {};
    const cleanId = String(userId || "").trim();
    if (!cleanId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis." });
      return;
    }

    const user = await userStore.findUser(cleanId);
    if (!user) {
      res.status(404).json({ success: false, message: "Utilisateur introuvable." });
      return;
    }

    const isEmma = isEmmaAdminUser(user.id, user.name);
    const updated = await userStore.updateUser(user.id, {
      isSubscriber: isEmma ? true : false,
      subscriptionTier: isEmma ? "premium" : "free",
      subscriptionStatus: isEmma ? "active" : "canceled",
    });

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
    const cleanId = String(userId || "").trim();
    if (!cleanId) {
      res.status(400).json({ success: false, message: "L'identifiant utilisateur est requis pour la suppression." });
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
    const isSubscriber = Boolean(isEmma || user.isAdmin || user.isSubscriber || user.subscriptionTier === "intermediate" || user.subscriptionTier === "premium");

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

export default {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  getUserAccount,
  requestWebLogin,
  checkWebLoginStatus,
  getPendingLoginRequest,
  respondLoginRequest,
  getUserProfile,
  getGeneralLeaderboard,
  updateUserPrefix,
  unsubscribeUser,
  deleteUserAccount,
  getUserStatistics,
};
