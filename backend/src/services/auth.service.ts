import crypto from "crypto";

export interface PasswordHashResult {
  hash: string;
  salt: string;
}

/**
 * Hachage de mot de passe sécurisé utilisant l'algorithme standard PBKDF2 de Node.js (sans dépendance externe).
 */
export function hashPassword(password: string): PasswordHashResult {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return { hash, salt };
}

/**
 * Vérifie un mot de passe en clair par rapport à un hash et sel stockés.
 */
export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  if (!password || !storedHash || !salt) return false;
  try {
    const hashToVerify = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(hashToVerify, "hex"));
  } catch {
    return false;
  }
}

export function isEmmaAdminUser(loginOrId?: string, name?: string): boolean {
  const normalize = (val?: string) =>
    String(val || "")
      .trim()
      .toLowerCase()
      .replace(/[-_ ]/g, "");
  const n1 = normalize(loginOrId);
  const n2 = normalize(name);
  return n1 === "emmaracer" || n2 === "emmaracer" || n1 === "admin" || n2 === "admin";
}

/**
 * Génère un jeton aléatoire sécurisé (utilisé pour confirmation ou reset de mot de passe).
 */
export function generateSecureToken(bytes: number = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}
