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
