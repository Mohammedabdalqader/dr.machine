import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { ErrorBox, Loading } from '@/components/ui/state-views';
import { useQuery } from '@/hooks/use-query';
import { callFunction } from '@/lib/api';
import type { Role } from '@/lib/types';

type Member = { id: string; full_name: string; role: Role; email: string; last_sign_in_at: string | null };

export default function TeamScreen() {
  const { t } = useTranslation();
  const team = useQuery(async () => (await callFunction<{ users: Member[] }>('admin-users', { action: 'list' })).users);

  return (
    <Screen withHeader refreshing={team.loading} onRefresh={team.reload}>
      <Button label={t('team.add')} onPress={() => router.push('/team-new')} />
      {team.error ? <ErrorBox message={team.error} onRetry={team.reload} /> : null}
      {team.loading && !team.data ? <Loading /> : null}
      {team.data?.map((m) => (
        <ListRow
          key={m.id}
          title={m.full_name}
          subtitle={`${m.email} · ${
            m.last_sign_in_at
              ? t('team.lastSignIn', { date: m.last_sign_in_at.slice(0, 10) })
              : t('team.neverSignedIn')
          }`}
          right={<Badge label={t(`roles.${m.role}`)} tone="info" />}
        />
      ))}
    </Screen>
  );
}
