import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ErrorBox } from '@/components/ui/state-views';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { supabase } from '@/lib/supabase';
import { REVIEWER_ROLES } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

async function count(table: string, filter?: [string, string]): Promise<number> {
  let q = supabase!.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = q.eq(filter[0], filter[1]);
  const { count: n, error } = await q;
  if (error) throw error;
  return n ?? 0;
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const { profile, hasRole } = useAuth();
  const reviewer = hasRole(REVIEWER_ROLES);

  const stats = useQuery(async () => {
    const [machines, approved, drafts, cases] = await Promise.all([
      count('machines'),
      count('fault_records', ['status', 'approved']),
      reviewer ? count('fault_records', ['status', 'draft']) : Promise.resolve(0),
      count('fault_cases'),
    ]);
    return { machines, approved, drafts, cases };
  }, [reviewer]);

  const tiles = [
    { label: t('home.machines'), value: stats.data?.machines },
    { label: t('home.approved'), value: stats.data?.approved },
    ...(reviewer ? [{ label: t('home.drafts'), value: stats.data?.drafts }] : []),
    { label: t('home.cases'), value: stats.data?.cases },
  ];

  return (
    <Screen withHeader refreshing={stats.loading} onRefresh={stats.reload}>
      <View style={styles.greeting}>
        <AppText variant="title">{t('home.hello', { name: profile?.full_name })}</AppText>
        <View style={styles.badges}>
          <Badge label={t(`roles.${profile?.role ?? 'technician'}`)} tone="info" />
          {profile?.company?.is_sample ? <Badge label={t('app.sampleBadge')} tone="warning" /> : null}
        </View>
        <AppText variant="caption" color="textSecondary">
          {profile?.company?.name}
        </AppText>
      </View>

      {stats.error ? <ErrorBox message={stats.error} onRetry={stats.reload} /> : null}

      <View style={styles.tiles}>
        {tiles.map((tile) => (
          <Card key={tile.label} style={styles.tile}>
            <AppText variant="display">{tile.value ?? '–'}</AppText>
            <AppText variant="caption" color="textSecondary">
              {tile.label}
            </AppText>
          </Card>
        ))}
      </View>

      {reviewer && (stats.data?.drafts ?? 0) > 0 ? (
        <Button label={t('home.reviewNow')} onPress={() => router.navigate('/knowledge')} />
      ) : null}

      <Card>
        <AppText variant="body" color="textSecondary">
          {t('home.diagnoseSoon')}
        </AppText>
        <Button label={t('tabs.machines')} variant="secondary" onPress={() => router.navigate('/machines')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { gap: Spacing.xs },
  badges: { flexDirection: 'row', gap: Spacing.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { flexGrow: 1, flexBasis: '45%' },
});
