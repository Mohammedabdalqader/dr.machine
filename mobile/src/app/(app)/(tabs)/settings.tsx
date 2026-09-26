import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { LanguageSwitch } from '@/components/language-switch';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/providers/auth-provider';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { profile, session, signOut } = useAuth();

  return (
    <Screen withHeader>
      <Card>
        <AppText variant="label" color="textSecondary">
          {t('settings.profile')}
        </AppText>
        <AppText variant="heading">{profile?.full_name}</AppText>
        <AppText variant="body" color="textSecondary">
          {session?.user.email} · {t(`roles.${profile?.role ?? 'technician'}`)}
        </AppText>
        <AppText variant="label" color="textSecondary">
          {t('settings.company')}
        </AppText>
        <AppText variant="body">{profile?.company?.name}</AppText>
      </Card>

      <AppText variant="label">{t('language.label')}</AppText>
      <LanguageSwitch />

      <Button label={t('auth.signOut')} variant="secondary" onPress={signOut} />

      <AppText variant="caption" color="textSecondary">
        {t('app.name')} {Constants.expoConfig?.version}
      </AppText>
    </Screen>
  );
}
