import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Chips } from '@/components/ui/chips';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { Empty, ErrorBox, Loading } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { listRecords } from '@/lib/queries';
import { REVIEWER_ROLES, type RecordStatus } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

export default function KnowledgeScreen() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const reviewer = hasRole(REVIEWER_ROLES);
  // Reviewers start on the review queue; technicians only ever see approved knowledge.
  const [status, setStatus] = useState<RecordStatus>(reviewer ? 'draft' : 'approved');
  const [search, setSearch] = useState('');
  const records = useQuery(() => listRecords(status), [status]);

  const term = search.trim().toLowerCase();
  const filtered = (records.data ?? []).filter(
    (r) =>
      !term ||
      [r.title, r.component, r.symptoms, r.root_cause, r.error_codes.join(' ')].some((v) => v.toLowerCase().includes(term)),
  );

  return (
    <Screen withHeader refreshing={records.loading} onRefresh={records.reload}>
      {reviewer ? (
        <Chips
          value={status}
          onChange={setStatus}
          options={(['draft', 'approved', 'rejected'] as const).map((s) => ({ value: s, label: t(`knowledge.${s}`) }))}
        />
      ) : null}
      <TextField label={t('common.search')} value={search} onChangeText={setSearch} placeholder="E101, cooler…" />

      {records.error ? <ErrorBox message={records.error} onRetry={records.reload} /> : null}
      {records.loading && !records.data ? <Loading /> : null}
      {records.data && !filtered.length ? <Empty message={t('knowledge.empty')} /> : null}

      {filtered.map((r) => (
        <ListRow
          key={r.id}
          title={r.title || r.root_cause}
          subtitle={r.symptoms}
          footer={
            <View style={styles.badges}>
              {r.error_codes.map((c) => (
                <Badge key={c} label={c} tone="info" />
              ))}
              {r.case_count ? <Badge label={t('knowledge.cases', { count: r.case_count })} /> : null}
            </View>
          }
          onPress={() => router.push({ pathname: '/record/[id]', params: { id: r.id } })}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
});
