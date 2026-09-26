import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { readSetting } from '@/lib/storage';

import ar from './ar.json';
import en from './en.json';

export type Language = 'en' | 'ar';
export const LANGUAGE_KEY = 'muallim.language';

export function isRTL(language: Language): boolean {
  return language === 'ar';
}

function initialLanguage(): Language {
  const saved = readSetting(LANGUAGE_KEY);
  if (saved === 'en' || saved === 'ar') return saved;
  return getLocales()[0]?.languageCode === 'ar' ? 'ar' : 'en';
}

const i18n = createInstance();
i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
