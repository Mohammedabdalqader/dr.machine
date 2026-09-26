import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Language } from '@/i18n';
import { useLanguage } from '@/providers/language-provider';

const OPTIONS: Language[] = ['ar', 'en'];

export function LanguageSwitch() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { language, setLanguage } = useLanguage();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('language.label')}
      style={[styles.row, { backgroundColor: theme.surfaceMuted }]}>
      {OPTIONS.map((option) => {
        const selected = option === language;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setLanguage(option)}
            style={[styles.option, selected && { backgroundColor: theme.surface }]}>
            <AppText variant="label" color={selected ? 'text' : 'textSecondary'} style={styles.center}>
              {t(`language.${option}`)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: Radius.md, padding: Spacing.xs, gap: Spacing.xs },
  option: {
    flex: 1,
    minHeight: TouchTarget - 8,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});
