import { fr } from './locales/fr';
import { en } from './locales/en';
import { de } from './locales/de';
import { es } from './locales/es';
import { it } from './locales/it';
import { pt } from './locales/pt';

export type SupportedLang = 'fr' | 'en' | 'de' | 'es' | 'it' | 'pt';

export type TranslationDictionary = Record<string, string>;

export const SUPPORTED_LANGUAGES: { code: SupportedLang; label: string; flag: string }[] = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' }
];

export const TRANSLATIONS: Record<SupportedLang, TranslationDictionary> = {
  fr,
  en,
  de,
  es,
  it,
  pt
};

export { fr, en, de, es, it, pt };
