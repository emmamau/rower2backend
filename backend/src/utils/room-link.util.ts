/**
 * Utilitaires de normalisation et de construction d'URLs de salon privé.
 * Conforme aux routes Angular du frontend (/r/:code et /salon/:code).
 */

/**
 * Normalise un code salon style Meet de 9 lettres vers le format "xxx-xxx-xxx".
 */
export function normalizeSalonCode(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (/^[a-z]{9}$/.test(cleaned)) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 9)}`;
  }
  return null;
}

/**
 * Construit l'URL canonique de partage pour un salon privé : ${origin}/r/${code}
 */
export function buildShareableRoomUrl(origin: string, code: string): string {
  const cleanOrigin = (origin || "").trim().replace(/\/+$/, "");
  const normalized = normalizeSalonCode(code) || (code ? code.trim() : "");
  return `${cleanOrigin}/r/${encodeURIComponent(normalized)}`;
}

/**
 * Construit l'URL de lancement direct en mode régate (liens des courriels d'invitation) :
 * ${origin}/r/${code}?mode=regatta — le frontend ouvre la vue Régate et propose le plein écran paysage.
 */
export function buildRegattaLaunchUrl(origin: string, code: string): string {
  return `${buildShareableRoomUrl(origin, code)}?mode=regatta`;
}

/**
 * Ajoute le paramètre ?mode=regatta à une URL de salon existante (sans le dupliquer).
 */
export function withRegattaMode(url: string): string {
  if (!url) return url;
  if (/[?&]mode=regatta(?:&|#|$)/.test(url)) return url;
  const hashIdx = url.indexOf("#");
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
  return `${base}${base.includes("?") ? "&" : "?"}mode=regatta${hash}`;
}

/**
 * Ajoute le paramètre ?email=... à une URL de salon existante (sans le dupliquer),
 * permettant de pré-remplir l'authentification lors de l'accès mobile ou web.
 */
export function withInvitationEmail(url: string, email?: string): string {
  if (!url || !email) return url;
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) return url;
  if (/[?&]email=/i.test(url)) return url;
  const hashIdx = url.indexOf("#");
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
  return `${base}${base.includes("?") ? "&" : "?"}email=${encodeURIComponent(cleanEmail)}${hash}`;
}
