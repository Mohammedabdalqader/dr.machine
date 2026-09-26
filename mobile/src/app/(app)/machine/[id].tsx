import * as Print from 'expo-print';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { Empty, ErrorBox, Loading } from '@/components/ui/state-views';
import { Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { machineLink, qrSvg, stickerSheetHtml } from '@/lib/qr';
import { getMachine, machineHistory } from '@/lib/queries';
import { REVIEWER_ROLES } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

export default function MachineScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hasRole } = useAuth();
  const machine = useQuery(() => getMachine(id), [id]);
  const history = useQuery(() => machineHistory(id), [id]);

  if (machine.loading && !machine.data) return <Loading />;
  if (machine.error) return <ErrorBox message={machine.error} onRetry={machine.reload} />;
  const m = machine.data;
  if (!m) return <Empty message={t('machines.notFound')} />;

  const details: [string, string | null | undefined][] = [
    [t('machines.model'), m.model ? `${m.model.code} · ${m.model.name}` : null],
    [t('machines.line'), m.line ? [m.line.site?.name, m.line.name].filter(Boolean).join(' · ') : null],
    [t('machines.serial'), m.serial_number],
    [t('machines.installed'), m.installed_on],
    [t('machines.notes'), m.notes],
  ];

  return (
    <Screen withHeader refreshing={history.loading} onRefresh={history.reload}>
      <Stack.Screen options={{ title: m.tag }} />

      <Card>
        {details
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <View key={label} style={styles.detail}>
              <AppText variant="caption" color="textSecondary">
                {label}
              </AppText>
              <AppText variant="body">{value}</AppText>
            </View>
          ))}
        {hasRole(REVIEWER_ROLES) ? (
          <Button
            label={t('common.edit')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/machine-form', params: { id: m.id } })}
          />
        ) : null}
      </Card>

      <Card style={styles.qrCard}>
        <AppText variant="heading">{t('machines.qr')}</AppText>
        <View style={styles.qr}>
          <SvgXml xml={qrSvg(machineLink(m.id))} width="100%" height="100%" />
        </View>
        <AppText variant="caption" color="textSecondary" style={styles.center}>
          {t('machines.qrHint')}
        </AppText>
        <Button
          label={t('machines.shareQr')}
          variant="secondary"
          onPress={() => Print.printAsync({ html: stickerSheetHtml([m], t('machines.scanWith')) })}
        />
      </Card>

      <AppText variant="heading">{t('machines.history')}</AppText>
      {history.error ? <ErrorBox message={history.error} onRetry={history.reload} /> : null}
      {history.data && !history.data.length ? <Empty message={t('machines.noHistory')} /> : null}
      {history.data?.map((c) => (
        <ListRow
          key={c.id}
          title={c.problem}
          subtitle={[c.occurred_on, c.action_taken, c.technician_name].filter(Boolean).join(' · ')}
          onPress={
            c.fault_record_id
              ? () => router.push({ pathname: '/record/[id]', params: { id: c.fault_record_id! } })
              : undefined
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  detail: { gap: 2 },
  qrCard: { alignItems: 'center' },
  qr: { width: 200, height: 200, backgroundColor: '#FFFFFF', padding: Spacing.sm, borderRadius: 8 },
  center: { textAlign: 'center' },
});
