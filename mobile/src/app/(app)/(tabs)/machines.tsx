import * as Print from 'expo-print';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { Empty, ErrorBox, Loading } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { stickerSheetHtml } from '@/lib/qr';
import { listMachines } from '@/lib/queries';
import { REVIEWER_ROLES, type Machine } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

export default function MachinesScreen() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const canEdit = hasRole(REVIEWER_ROLES);
  const machines = useQuery(listMachines);
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const filtered = (machines.data ?? []).filter(
    (m) =>
      !term ||
      [m.tag, m.serial_number, m.model?.code, m.model?.name, m.line?.name].some((v) => v?.toLowerCase().includes(term)),
  );

  // Group by line so the list mirrors the plant floor.
  const groups = new Map<string, Machine[]>();
  for (const m of filtered) {
    const key = m.line ? `${m.line.site?.name ? `${m.line.site.name} · ` : ''}${m.line.name}` : t('machines.noLine');
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  const printStickers = () => Print.printAsync({ html: stickerSheetHtml(filtered, t('machines.scanWith')) });

  return (
    <Screen withHeader refreshing={machines.loading} onRefresh={machines.reload}>
      <TextField label={t('common.search')} value={search} onChangeText={setSearch} placeholder="C-02, RS-55…" />
      <View style={styles.actions}>
        {canEdit ? <Button label={t('machines.add')} onPress={() => router.push('/machine-form')} style={styles.flex} /> : null}
        <Button
          label={t('machines.printQr')}
          variant="secondary"
          onPress={printStickers}
          disabled={!filtered.length}
          style={styles.flex}
        />
      </View>

      {machines.error ? <ErrorBox message={machines.error} onRetry={machines.reload} /> : null}
      {machines.loading && !machines.data ? <Loading /> : null}
      {machines.data && !filtered.length ? <Empty message={t('common.noResults')} /> : null}

      {[...groups.entries()].map(([line, items]) => (
        <View key={line} style={styles.group}>
          <AppText variant="label" color="textSecondary">
            {line}
          </AppText>
          {items.map((m) => (
            <ListRow
              key={m.id}
              title={m.tag}
              subtitle={[m.model?.name, m.serial_number].filter(Boolean).join(' · ')}
              onPress={() => router.push({ pathname: '/machine/[id]', params: { id: m.id } })}
            />
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
  group: { gap: Spacing.sm },
});
