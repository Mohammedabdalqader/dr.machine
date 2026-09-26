import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { ErrorBox } from '@/components/ui/state-views';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { machineIdFromQr } from '@/lib/diagnosis';
import { listMachines } from '@/lib/queries';

/** Step 1 of the loop: identify the machine by its QR sticker (or pick it from the list). */
export default function ScanScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const machines = useQuery(listMachines);
  const [message, setMessage] = useState<string | null>(null);
  const handled = useRef(false);

  const open = (machineId: string) => {
    if (handled.current) return;
    handled.current = true;
    router.replace({ pathname: '/report', params: { machine: machineId } });
  };

  const onScanned = ({ data }: { data: string }) => {
    const id = machineIdFromQr(data);
    if (!id) {
      setMessage(t('diagnose.notMuallimQr'));
      return;
    }
    if (machines.data && !machines.data.some((m) => m.id === id)) {
      setMessage(t('machines.notFound'));
      return;
    }
    open(id);
  };

  return (
    <Screen withHeader>
      <Stack.Screen options={{ title: t('diagnose.scanTitle') }} />
      {permission?.granted ? (
        <View style={[styles.camera, { borderColor: theme.primary }]}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
          />
        </View>
      ) : (
        <View style={[styles.camera, styles.placeholder, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
          <AppText variant="body" color="textSecondary" style={styles.center}>
            {t('diagnose.cameraPermission')}
          </AppText>
          <Button label={t('diagnose.allowCamera')} onPress={requestPermission} />
        </View>
      )}
      <AppText variant="caption" color="textSecondary" style={styles.center}>
        {t('diagnose.scanHint')}
      </AppText>
      {message ? <ErrorBox message={message} /> : null}

      <AppText variant="heading">{t('diagnose.orPick')}</AppText>
      {machines.error ? <ErrorBox message={machines.error} onRetry={machines.reload} /> : null}
      {machines.data?.map((m) => (
        <ListRow
          key={m.id}
          title={m.tag}
          subtitle={[m.model?.name, m.line?.name].filter(Boolean).join(' · ')}
          onPress={() => open(m.id)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: { height: 300, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 3 },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  center: { textAlign: 'center' },
});
