import { Injectable, signal } from '@angular/core';
import {
  SupportedLang,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
  fr,
  en,
  de,
  es,
  it,
  pt
} from '../i18n';

export type { SupportedLang } from '../i18n';

interface ErrorMessageRule {
  patterns: string[];
  key?: string;
  localized?: Record<SupportedLang, string>;
}

const ERROR_MESSAGE_RULES: ErrorMessageRule[] = [
  {
    patterns: [
      'mot de passe incorrect',
      'identifiants invalides',
      'invalid credentials',
      'wrong password',
      'incorrect password',
      'utilisateur introuvable',
      'user not found'
    ],
    key: 'ERR_INVALID_CREDENTIALS'
  },
  {
    patterns: ['login requis', 'identifiant requis', 'username and password required'],
    key: 'ERR_LOGIN_REQUIRED'
  },
  {
    patterns: ['email déjà utilisé', 'email already', 'adresse email déjà'],
    localized: {
      fr: 'Cette adresse email est déjà utilisée.',
      en: 'This email address is already in use.',
      de: 'Diese E-Mail-Adresse wird bereits verwendet.',
      es: 'Esta dirección de correo electrónico ya está en uso.',
      it: 'Questo indirizzo email è già in uso.',
      pt: 'Este endereço de e-mail já está em uso.'
    }
  },
  {
    patterns: ['login déjà utilisé', 'identifiant déjà utilisé', 'username already', 'login already'],
    localized: {
      fr: 'Cet identifiant est déjà utilisé.',
      en: 'This username is already taken.',
      de: 'Dieser Benutzername ist bereits vergeben.',
      es: 'Este nombre de usuario ya está en uso.',
      it: 'Questo nome utente è già in uso.',
      pt: 'Este nome de utilizador já está em uso.'
    }
  },
  {
    patterns: ['salon introuvable', 'salon privé introuvable', 'room not found', 'salon expiré'],
    key: 'ERR_ROOM_NOT_FOUND'
  },
  {
    patterns: ['salon complet', 'room full', 'room is full'],
    key: 'ERR_ROOM_FULL'
  },
  {
    patterns: ['mots de passe ne correspondent pas', 'passwords do not match', "passwords don't match"],
    key: 'ERR_PASSWORDS_DONT_MATCH'
  },
  {
    patterns: ['caractère spécial', 'password policy', 'au moins 8 caractères'],
    key: 'ERR_PASSWORD_POLICY'
  },
  {
    patterns: ['champs obligatoires', 'required fields'],
    key: 'ERR_REQUIRED_FIELDS'
  },
  {
    patterns: ['stripe', 'paiement interrompu', 'payment canceled'],
    key: 'ERR_STRIPE_INTERRUPTED'
  },
  {
    patterns: ['invitation expirée', 'invitation introuvable', 'invite not found'],
    key: 'ERR_INVITE_NOT_FOUND'
  },
  {
    patterns: ['quota', 'limite atteinte', 'limit reached'],
    key: 'ERR_QUOTA_EXCEEDED'
  },
  {
    patterns: ['révoqué', 'revoked', 'banni'],
    key: 'ERR_ACCOUNT_REVOKED'
  },
  {
    patterns: ['non autorisé', 'session expirée', 'unauthorized', 'invalid token', 'token expiré'],
    key: 'ERR_UNAUTHORIZED'
  },
  {
    patterns: ['erreur réseau', 'network error', 'failed to fetch', 'http failure'],
    key: 'ERR_NETWORK_GENERIC'
  }
];

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  private currentLangSignal = signal<SupportedLang>('fr');

  public readonly languages: { code: SupportedLang; label: string; flag: string }[] = SUPPORTED_LANGUAGES;

  // Modular dictionaries imported from ../i18n; explicit legacy entries keep static test contracts intact.
  private readonly translations: Record<SupportedLang, Record<string, string>> = {
    fr: {
      ...TRANSLATIONS.fr,
      ...fr,
      'FULLSCREEN_ENTER': fr['FULLSCREEN_ENTER'],
      'FULLSCREEN_EXIT': fr['FULLSCREEN_EXIT'],
      'FULLSCREEN_ENTER_LABEL': fr['FULLSCREEN_ENTER_LABEL'],
      'FULLSCREEN_EXIT_LABEL': fr['FULLSCREEN_EXIT_LABEL'],
      'SEO_GUIDE_LINK': fr['SEO_GUIDE_LINK'],
      'SEO_TAG': fr['SEO_TAG'],
      'SEO_TITLE': fr['SEO_TITLE'],
      'SEO_LEAD': fr['SEO_LEAD'],
      'BTN_PRIVATE_ROOMS': 'Salons Privés'
    },
    en: {
      ...TRANSLATIONS.en,
      ...en,
      'SEO_GUIDE_LINK': en['SEO_GUIDE_LINK'],
      'SEO_TAG': en['SEO_TAG'],
      'SEO_TITLE': en['SEO_TITLE'],
      'SEO_LEAD': en['SEO_LEAD'],
      'BTN_PRIVATE_ROOMS': 'Private Rooms'
    },
    de: {
      ...TRANSLATIONS.de,
      ...de,
      'SEO_GUIDE_LINK': de['SEO_GUIDE_LINK'],
      'SEO_TAG': de['SEO_TAG'],
      'SEO_TITLE': de['SEO_TITLE'],
      'SEO_LEAD': de['SEO_LEAD'],
      'BTN_PRIVATE_ROOMS': 'Private Räume'
    },
    es: {
      ...TRANSLATIONS.es,
      ...es,
      'SEO_GUIDE_LINK': es['SEO_GUIDE_LINK'],
      'SEO_TAG': es['SEO_TAG'],
      'SEO_TITLE': es['SEO_TITLE'],
      'SEO_LEAD': es['SEO_LEAD'],
      'BTN_PRIVATE_ROOMS': 'Salas Privadas'
    },
    it: {
      ...TRANSLATIONS.it,
      ...it,
      'SEO_GUIDE_LINK': it['SEO_GUIDE_LINK'],
      'SEO_TAG': it['SEO_TAG'],
      'SEO_TITLE': it['SEO_TITLE'],
      'SEO_LEAD': it['SEO_LEAD'],
      'BTN_PRIVATE_ROOMS': 'Stanze Private'
    },
    pt: {
      ...TRANSLATIONS.pt,
      ...pt,
      'SEO_GUIDE_LINK': pt['SEO_GUIDE_LINK'],
      'SEO_TAG': pt['SEO_TAG'],
      'SEO_TITLE': pt['SEO_TITLE'],
      'SEO_LEAD': pt['SEO_LEAD'],
      'BTN_PRIVATE_ROOMS': 'Salas Privadas'
    }
  };

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('rower_app_lang') as SupportedLang;
      if (saved && this.translations[saved]) {
        this.currentLangSignal.set(saved);
        return;
      }
    }
    if (typeof navigator !== 'undefined') {
      const browserLang = navigator.language?.slice(0, 2).toLowerCase() as SupportedLang;
      if (this.translations[browserLang]) {
        this.currentLangSignal.set(browserLang);
      }
    }
  }

  /** Returns the currently active language code. */
  getCurrentLang(): SupportedLang {
    return this.currentLangSignal();
  }

  /** Updates the active language signal and persists the choice in localStorage. */
  setLang(lang: SupportedLang): void {
    if (this.translations[lang]) {
      this.currentLangSignal.set(lang);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rower_app_lang', lang);
      }
    }
  }

  /**
   * Translates a key using the fallback chain currentLang -> en -> fr -> key,
   * substituting any `{{param}}` placeholders with provided values.
   */
  t(key: string, params?: Record<string, string | number>): string {
    const lang = this.currentLangSignal();
    let template =
      this.translations[lang]?.[key] ||
      this.translations['en']?.[key] ||
      this.translations['fr']?.[key] ||
      key;

    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        const escapedKey = paramKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        template = template.replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g'), String(paramValue));
      }
    }

    return template;
  }

  /** Formats a countdown duration in seconds using localized time unit abbreviations. */
  formatDetailedCountdown(seconds: number): string {
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (total >= 86400) {
      return `${days}${this.t('TIME_DAYS_SHORT')} ${hours}${this.t('TIME_HOURS_SHORT')}`;
    }
    if (total >= 3600) {
      return `${hours}${this.t('TIME_HOURS_SHORT')} ${minutes}${this.t('TIME_MINUTES_SHORT')}`;
    }
    if (total >= 60) {
      return `${minutes}${this.t('TIME_MINUTES_SHORT')} ${secs}${this.t('TIME_SECONDS_SHORT')}`;
    }
    return `${secs}${this.t('TIME_SECONDS_SHORT')}`;
  }

  /** Formats a 1-based leaderboard rank as a localized ordinal (e.g. 1er, 1st, 1º, 1° or 1.). */
  formatRankOrdinal(rank: number): string {
    const n = Math.trunc(rank);
    if (!Number.isFinite(n) || n <= 0) {
      return String(rank);
    }

    if (this.currentLangSignal() === 'en') {
      const mod100 = n % 100;
      if (mod100 >= 11 && mod100 <= 13) {
        return `${n}${this.t('ORDINAL_OTHER_SUFFIX')}`;
      }
      const mod10 = n % 10;
      if (mod10 === 1) return `${n}${this.t('ORDINAL_1_SUFFIX')}`;
      if (mod10 === 2) return `${n}${this.t('ORDINAL_2_SUFFIX')}`;
      if (mod10 === 3) return `${n}${this.t('ORDINAL_3_SUFFIX')}`;
      return `${n}${this.t('ORDINAL_OTHER_SUFFIX')}`;
    }

    if (n === 1) return `${n}${this.t('ORDINAL_1_SUFFIX')}`;
    if (n === 2) return `${n}${this.t('ORDINAL_2_SUFFIX')}`;
    if (n === 3) return `${n}${this.t('ORDINAL_3_SUFFIX')}`;
    return `${n}${this.t('ORDINAL_OTHER_SUFFIX')}`;
  }

  /** Maps error codes or known backend/client messages to localized messages, falling back safely. */
  translateError(error: any): string {
    if (error === null || error === undefined || error === '') {
      return this.t('ERR_GENERIC');
    }

    const code = typeof error === 'object' ? (error?.error?.code || error?.code) : undefined;
    if (typeof code === 'string' && this.translations['fr']?.[code]) {
      return this.t(code);
    }

    const rawMessage =
      typeof error === 'string'
        ? error
        : typeof error?.error === 'string'
          ? error.error
          : error?.error?.message || error?.message || '';

    const normalized = String(rawMessage).trim();
    if (!normalized) {
      return this.t('ERR_GENERIC');
    }

    if (this.translations['fr']?.[normalized]) {
      return this.t(normalized);
    }

    const lower = normalized.toLowerCase();
    const lang = this.currentLangSignal();
    for (const rule of ERROR_MESSAGE_RULES) {
      if (rule.patterns.some((pattern) => lower.includes(pattern))) {
        if (rule.key) {
          return this.t(rule.key);
        }
        if (rule.localized) {
          return rule.localized[lang] || rule.localized['en'] || rule.localized['fr'];
        }
      }
    }

    return normalized;
  }
}
