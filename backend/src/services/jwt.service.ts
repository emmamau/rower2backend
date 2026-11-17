import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "rower-race-super-secure-jwt-secret-2026";

function base64UrlEncode(input: string | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

export interface JwtPayload {
  userId: string;
  login?: string;
  email?: string;
  role: string;
  isRevoked?: boolean;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

export class JwtService {
  /**
   * Génère un jeton JWT standard (HS256) sans dépendance externe.
   * Expiration par défaut : 7 jours (604800 secondes).
   */
  public static sign(payload: JwtPayload, expiresInSec: number = 7 * 24 * 3600): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      ...payload,
      iat: nowSec,
      exp: nowSec + expiresInSec,
    };

    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

    const signature = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const encodedSignature = base64UrlEncode(signature);

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  /**
   * Vérifie et décode un jeton JWT standard.
   */
  public static verify(token: string): { valid: boolean; payload?: JwtPayload; error?: string } {
    if (!token || typeof token !== "string") {
      return { valid: false, error: "Jeton manquant ou invalide" };
    }

    const parts = token.trim().split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Format de jeton JWT invalide" };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    try {
      // 1. Vérification de la signature cryptographique
      const expectedSignature = crypto
        .createHmac("sha256", JWT_SECRET)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest();
      const expectedEncoded = base64UrlEncode(expectedSignature);

      // Comparaison en temps constant pour prévenir les timing attacks
      if (
        encodedSignature.length !== expectedEncoded.length ||
        !crypto.timingSafeEqual(Buffer.from(encodedSignature), Buffer.from(expectedEncoded))
      ) {
        return { valid: false, error: "Signature de jeton invalide" };
      }

      // 2. Décodage du payload
      const jsonPayload = base64UrlDecode(encodedPayload);
      const payload = JSON.parse(jsonPayload) as JwtPayload;

      // 3. Vérification de l'expiration
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && nowSec > payload.exp) {
        return { valid: false, error: "Jeton expiré" };
      }

      return { valid: true, payload };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Erreur décodage jeton: ${message}` };
    }
  }
}

export default JwtService;
