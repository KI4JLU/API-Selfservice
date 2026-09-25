import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { resources } from '@api-selfservice/shared/i18n';
import { LOCALES, type Locale } from '@api-selfservice/shared';

export const LANG_STORAGE_KEY = 'api-selfservice.lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'de',
    supportedLngs: [...LOCALES],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LANG_STORAGE_KEY,
    },
  });

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

export function currentLocale(): Locale {
  const lng = (i18n.resolvedLanguage ?? i18n.language ?? 'de').slice(0, 2);
  return (LOCALES as readonly string[]).includes(lng) ? (lng as Locale) : 'de';
}

export function hasStoredLanguage(): boolean {
  try {
    return !!localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return false;
  }
}

export default i18n;
