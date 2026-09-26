import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LanguageSwitch } from '@/components/language-switch';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/providers/auth-provider';

const LOOP = ['report', 'diagnose', 'fix', 'confirm', 'learn'] as const;

export default function SignInScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { signIn, signOut, missingProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.error) setError(t('auth.invalid'));
  };

  return (
    <Screen>
      <View style={[styles.hero, { backgroundColor: theme.navy }]}>
        <AppText variant="display" style={styles.white}>
          {t('app.name')}
        </AppText>
        <AppText variant="body" style={styles.muted}>
          {t('app.tagline')}
        </AppText>
        <View style={styles.loop}>
          {LOOP.map((step, i) => (
            <View key={step} style={[styles.step, i === LOOP.length - 1 && { backgroundColor: theme.orange }]}>
              <AppText variant="caption" style={styles.white}>
                {i + 1}. {t(`home.loop.${step}`)}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      <LanguageSwitch />

      {missingProfile ? (
        <View style={styles.form}>
          <AppText variant="body" color="danger">
            {t('auth.noProfile')}
          </AppText>
          <Button label={t('auth.signOut')} variant="secondary" onPress={signOut} />
        </View>
      ) : (
        <View style={styles.form}>
          <AppText variant="title">{t('auth.title')}</AppText>
          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            ltr
          />
          <TextField
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            onSubmitEditing={submit}
            error={error}
            ltr
          />
          <Button label={t('auth.signIn')} onPress={submit} loading={busy} disabled={!email || !password} />
          <AppText variant="caption" color="textSecondary">
            {t('auth.noSignup')}
          </AppText>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  white: { color: '#FFFFFF' },
  muted: { color: '#C9D1DB' },
  loop: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.sm },
  step: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Radius.sm, paddingVertical: 6, paddingHorizontal: 10 },
  form: { gap: Spacing.md },
});
