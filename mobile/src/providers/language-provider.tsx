import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { LocaleProvider } from 'expo-router';

import i18n, { isRTL, LANGUAGE_KEY, type Language } from '@/i18n';
import { writeSetting } from '@/lib/storage';

type LanguageContextValue = {
  language: Language;
  rtl: boolean;
  setLanguage: (language: Language) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Switches language and layout direction at runtime, without an app reload
 * (I18nManager.forceRTL needs a reload and does not work in Expo Go).
 * Layout flips through the Yoga `direction` style on the root view; navigation
 * direction flips through expo-router's LocaleProvider.
 */
export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<Language>(i18n.language === 'ar' ? 'ar' : 'en');
  const rtl = isRTL(language);

  const setLanguage = (next: Language) => {
    i18n.changeLanguage(next);
    writeSetting(LANGUAGE_KEY, next);
    setLanguageState(next);
  };

  return (
    <LanguageContext.Provider value={{ language, rtl, setLanguage }}>
      <LocaleProvider direction={rtl ? 'rtl' : 'ltr'}>
        <View style={[styles.root, { direction: rtl ? 'rtl' : 'ltr' }]}>{children}</View>
      </LocaleProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
