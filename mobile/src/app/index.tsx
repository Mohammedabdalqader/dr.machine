import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LanguageSwitch } from '@/components/language-switch';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { checkBackend, type BackendStatus } from '@/lib/supabase';

const LOOP = ['report', 'diagnose', 'fix', 'confirm', 'learn'] as const;

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [backend, setBackend] = useState<BackendStatus | 'checking'>('checking');

  useEffect(() => {
    checkBackend().then(setBackend);
  }, []);

  const backendLabel = {
    checking: '…',
    missing: t('home.backendMissing'),
    connected: t('home.backendConnected'),
    error: t('home.backendError'),
  }[backend];
  const backendColor = backend === 'connected' ? theme.success : backend === 'error' ? theme.danger : theme.warning;

  return (
    <Screen>
      <View style={[styles.hero, { backgroundColor: theme.navy }]}>
        <AppText variant="display" style={{ color: '#FFFFFF' }}>
          {t('app.name')}
        </AppText>
        <AppText variant="body" style={{ color: '#C9D1DB' }}>
          {t('app.tagline')}
        </AppText>
        <View style={styles.loop}>
          {LOOP.map((step, i) => (
            <View key={step} style={[styles.step, i === LOOP.length - 1 && { backgroundColor: theme.orange }]}>
              <AppText variant="caption" style={styles.stepText}>
                {i + 1}. {t(`home.loop.${step}`)}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      <LanguageSwitch />

      <Card>
        <AppText variant="heading">{t('home.statusTitle')}</AppText>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: backendColor }]} />
          <AppText variant="label">{t('home.backend')}:</AppText>
          <AppText variant="body" color="textSecondary">
            {backendLabel}
          </AppText>
        </View>
        {backend === 'missing' && (
          <AppText variant="caption" color="textSecondary">
            {t('home.backendHint')}
          </AppText>
        )}
      </Card>

      <AppText variant="caption" color="textSecondary">
        {t('home.version', { version: Constants.expoConfig?.version ?? '0.0.0' })}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  loop: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.sm },
  step: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Radius.sm, paddingVertical: 6, paddingHorizontal: 10 },
  stepText: { color: '#FFFFFF', textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
