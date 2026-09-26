import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Loading() {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.primary} size="large" />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceMuted, borderColor: theme.danger }]}>
      <AppText variant="label" color="danger">
        {t('common.error')}
      </AppText>
      <AppText variant="caption" color="textSecondary">
        {message}
      </AppText>
      {onRetry ? <Button label={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <View style={styles.center}>
      <AppText variant="body" color="textSecondary" style={styles.centerText}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { padding: Spacing.xl, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  box: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
});
