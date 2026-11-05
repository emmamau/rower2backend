export type ParsedRoomIdentifier =
  | { valid: true; kind: 'code' | 'pin' | 'raceId'; value: string }
  | { valid: false; reason: 'empty' | 'invalid_format' };

/**
 * Normalizes a 9-letter Meet-style salon code into "xxx-xxx-xxx".
 */
export function normalizeSalonCode(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (/^[a-z]{9}$/.test(cleaned)) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 9)}`;
  }
  return null;
}

/**
 * Parses any user-supplied private salon identifier:
 * - Meet-style salon code ("krm-wzx-qpl", "KRMWZXQPL", "krm wzx qpl")
 * - 4-digit Garmin PIN ("4829", "4 8 2 9")
 * - Direct private race ID ("PRIV_krmwzxqpl")
 * - Full or relative share URL ("https://.../r/krm-wzx-qpl", "/salon/krm-wzx-qpl", "/?room=...", "/?pin=4829")
 * - Full multi-line invitation message containing a "/r/xxx-xxx-xxx" link
 */
export function parseRoomInviteInput(raw: string): ParsedRoomIdentifier {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, reason: 'empty' };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, reason: 'empty' };
  }

  // 1. Check if text contains a /r/<code-or-id> or /salon/<code-or-id> path (handles full URLs and pasted invite messages)
  const pathMatch = trimmed.match(/\/(?:r|salon)\/([a-zA-Z0-9_-]{4,32})(?:[/?#]|$|\s)/i);
  if (pathMatch && pathMatch[1]) {
    const extracted = classifySimpleToken(pathMatch[1]);
    if (extracted) {
      return extracted;
    }
    return { valid: false, reason: 'invalid_format' };
  }

  // 2. Check URL or query string parameters (?room=..., ?salon=..., ?code=..., ?pin=...)
  if (trimmed.includes('?') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const urlObj = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? new URL(trimmed)
        : new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, 'https://rowerrace.local');

      const pathSegs = urlObj.pathname.split('/').filter(Boolean);
      if (pathSegs.length >= 2 && (pathSegs[0].toLowerCase() === 'r' || pathSegs[0].toLowerCase() === 'salon')) {
        const tokenFromPath = classifySimpleToken(decodeURIComponent(pathSegs[1]));
        if (tokenFromPath) return tokenFromPath;
        return { valid: false, reason: 'invalid_format' };
      }

      const paramCandidate =
        urlObj.searchParams.get('room') ??
        urlObj.searchParams.get('salon') ??
        urlObj.searchParams.get('code') ??
        urlObj.searchParams.get('pin');

      if (paramCandidate !== null) {
        if (!paramCandidate.trim()) {
          return { valid: false, reason: 'empty' };
        }
        const tokenFromQuery = classifySimpleToken(paramCandidate);
        if (tokenFromQuery) return tokenFromQuery;
        return { valid: false, reason: 'invalid_format' };
      }
    } catch {
      // Fall through to raw token classification
    }
  }

  // 3. Direct token classification (code, PIN, or PRIV_ raceId)
  const direct = classifySimpleToken(trimmed);
  if (direct) {
    return direct;
  }

  return { valid: false, reason: 'invalid_format' };
}

function classifySimpleToken(token: string): Extract<ParsedRoomIdentifier, { valid: true }> | null {
  const clean = token.trim();
  if (!clean) return null;

  // Direct PRIV_ race ID
  if (/^PRIV_[a-zA-Z0-9]{6,24}$/.test(clean)) {
    return { valid: true, kind: 'raceId', value: clean };
  }

  // 4-digit Garmin PIN (allows spaces between digits)
  const digitsOnly = clean.replace(/\s+/g, '');
  if (/^\d{4}$/.test(digitsOnly)) {
    return { valid: true, kind: 'pin', value: digitsOnly };
  }

  // Meet-style 9-letter code
  const meetCode = normalizeSalonCode(clean);
  if (meetCode) {
    return { valid: true, kind: 'code', value: meetCode };
  }

  return null;
}

/**
 * Inspects browser location (pathname + search) on startup or popstate.
 * Returns null if the URL points to the default public championship.
 */
export function extractRoomFromLocation(pathname: string, search: string): ParsedRoomIdentifier | null {
  const cleanPath = (pathname || '/').trim();
  const segs = cleanPath.split('/').filter(Boolean);

  if (segs.length >= 1 && (segs[0].toLowerCase() === 'r' || segs[0].toLowerCase() === 'salon')) {
    if (segs.length < 2 || !segs[1]) {
      return { valid: false, reason: 'empty' };
    }
    const parsed = classifySimpleToken(decodeURIComponent(segs[1]));
    return parsed || { valid: false, reason: 'invalid_format' };
  }

  if (search && search.length > 1) {
    const params = new URLSearchParams(search);
    const rawParam =
      params.get('room') ??
      params.get('salon') ??
      params.get('code') ??
      params.get('pin');
    if (rawParam !== null) {
      if (!rawParam.trim()) {
        return { valid: false, reason: 'empty' };
      }
      const parsed = classifySimpleToken(rawParam);
      return parsed || { valid: false, reason: 'invalid_format' };
    }
  }

  return null;
}

/**
 * Builds the canonical shareable URL for a private salon code.
 */
export function buildShareableRoomUrl(origin: string, code: string): string {
  const cleanOrigin = (origin || '').trim().replace(/\/+$/, '');
  const normalized = normalizeSalonCode(code) || code.trim();
  return `${cleanOrigin}/r/${encodeURIComponent(normalized)}`;
}

/**
 * Builds a ready-to-send multi-line invitation message (Web URL + Web Code + Garmin 4-digit PIN).
 */
export function buildRoomInviteMessage(options: {
  headerLabel: string;
  title: string;
  targetDistance: number;
  urlLabel: string;
  shareUrl: string;
  codeLabel: string;
  code: string;
  pinLabel: string;
  pinCode?: string;
}): string {
  const lines = [
    `🚣 ${options.headerLabel} « ${options.title} » (${options.targetDistance}m)`,
    `🔗 ${options.urlLabel}: ${options.shareUrl}`,
    `🔑 ${options.codeLabel}: ${options.code}`
  ];
  if (options.pinCode) {
    lines.push(`⌚ ${options.pinLabel}: ${options.pinCode}`);
  }
  return lines.join('\n');
}
