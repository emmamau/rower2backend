import { Request } from "express";

/**
 * Service de géolocalisation d'adresse IP pour les joueurs invités
 */
export class IpGeoService {
  private static cache = new Map<string, string>();

  // ISO 3166-1 alpha-2 vers nom de pays en français/anglais courant
  private static countryCodes: Record<string, string> = {
    FR: "France",
    CH: "Suisse",
    BE: "Belgique",
    CA: "Canada",
    GB: "Royaume-Uni",
    UK: "Royaume-Uni",
    US: "États-Unis",
    DE: "Allemagne",
    ES: "Espagne",
    IT: "Italie",
    NL: "Pays-Bas",
    PT: "Portugal",
    AU: "Australie",
    NZ: "Nouvelle-Zélande",
    IE: "Irlande",
    AT: "Autriche",
    SE: "Suède",
    NO: "Norvège",
    DK: "Danemark",
    FI: "Finlande",
    PL: "Pologne",
    CZ: "République Tchèque",
    LU: "Luxembourg",
    MC: "Monaco",
    JP: "Japon",
    BR: "Brésil",
    MX: "Mexique",
    MA: "Maroc",
    TN: "Tunisie",
    DZ: "Algérie",
    SN: "Sénégal",
    CI: "Côte d'Ivoire"
  };

  /**
   * Extrait l'adresse IP cliente depuis les headers de proxy (Render / Nginx / Cloudflare)
   */
  public static extractClientIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      const parts = forwarded.split(",");
      const first = parts[0]?.trim();
      if (first) return first;
    }
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) {
      return realIp.trim();
    }
    const sockIp = req.socket?.remoteAddress || (req as any).ip;
    if (sockIp) {
      return String(sockIp).replace(/^::ffff:/, "");
    }
    return "127.0.0.1";
  }

  /**
   * Vérifie si une IP est privée ou locale (loopback, 192.168, 10.x, etc.)
   */
  public static isPrivateOrLocalIp(ip: string): boolean {
    if (!ip) return true;
    const clean = ip.replace(/^::ffff:/, "");
    if (clean === "127.0.0.1" || clean === "::1" || clean === "localhost") return true;
    if (clean.startsWith("10.") || clean.startsWith("192.168.")) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
    return false;
  }

  /**
   * Résout le pays d'un joueur invité à partir de la requête HTTP
   */
  public static async resolveCountryFromRequest(req: Request): Promise<string> {
    // 1. En-têtes CDN directs (Render / Cloudflare)
    const cfCountry = req.headers["cf-ipcountry"] || req.headers["x-country-code"];
    if (typeof cfCountry === "string" && cfCountry.trim().length === 2) {
      const iso = cfCountry.trim().toUpperCase();
      if (this.countryCodes[iso]) {
        return this.countryCodes[iso];
      }
    }

    const ip = this.extractClientIp(req);
    return this.resolveCountryFromIp(ip);
  }

  /**
   * Résout le pays à partir d'une IP (avec cache et fallback non bloquant)
   */
  public static async resolveCountryFromIp(ip: string): Promise<string> {
    if (this.isPrivateOrLocalIp(ip)) {
      return "France"; // Pays par défaut pour le développement local et les tests
    }

    if (this.cache.has(ip)) {
      return this.cache.get(ip)!;
    }

    try {
      // Lookup non-bloquant avec timeout court de 1200ms
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);

      const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode`, {
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json() as { status?: string; country?: string; countryCode?: string };
        if (data && data.status === "success" && data.country) {
          const resolved = data.country;
          this.cache.set(ip, resolved);
          return resolved;
        }
      }
    } catch {
      // Tolérance réseau / hors-ligne
    }

    return "France";
  }
}
