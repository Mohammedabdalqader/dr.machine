import { useTranslation } from 'react-i18next';

import { LanguageSwitch } from '@/components/language-switch';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';

/** Shown only when mobile/.env.local is missing the Supabase settings. */
export default function SetupScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <AppText variant="display">{t('app.name')}</AppText>
      <LanguageSwitch />
      <Card>
        <AppText variant="heading">{t('setup.title')}</AppText>
        <AppText variant="body" color="textSecondary">
          {t('setup.hint')}
        </AppText>
      </Card>
    </Screen>
  );
}
