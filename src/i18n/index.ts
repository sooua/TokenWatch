import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { zh } from './zh';

export type SupportedLanguage = 'auto' | 'en' | 'zh';

// Map a user preference (including 'auto') to the actual i18n language code
// i18next should use. `auto` consults the OS locale — we only care about
// whether it starts with `zh`, anything else is English.
export function resolveLanguage(pref: SupportedLanguage | undefined): 'en' | 'zh' {
  if (pref === 'en' || pref === 'zh') return pref;
  try {
    const sys = (navigator?.language || Intl.DateTimeFormat().resolvedOptions().locale || 'en')
      .toLowerCase();
    return sys.startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: resolveLanguage('auto'),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes
  },
  // Keep string returns strict — we never embed arrays/objects in the UI.
  returnNull: false,
});

export default i18n;
