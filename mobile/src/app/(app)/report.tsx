import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ErrorBox } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { runDiagnosis, uploadPhotos } from '@/lib/diagnosis';
import { getMachine } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

const MAX_PHOTOS = 3;
type Photo = ImagePicker.ImagePickerAsset;

/** Step 1b: describe or photograph the fault. */
export default function ReportScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { language } = useLanguage();
  const { profile } = useAuth();
  const { machine: machineId } = useLocalSearchParams<{ machine?: string }>();
  const machine = useQuery(() => (machineId ? getMachine(machineId) : Promise.resolve(null)), [machineId]);

  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addPhoto = async (source: 'camera' | 'library') => {
    setError(null);
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled) setPhotos((p) => [...p, ...result.assets].slice(0, MAX_PHOTOS));
  };

  const submit = async () => {
    if (!text.trim() && !code.trim() && !photos.length) {
      setError(t('diagnose.needInput'));
      return;
    }
    setError(null);
    try {
      let paths: string[] = [];
      if (photos.length) {
        setBusy(t('diagnose.uploadingPhotos'));
        paths = await uploadPhotos(profile!.company_id, photos);
      }
      setBusy(t('diagnose.working'));
      const { id } = await runDiagnosis({ machineId: machineId ?? null, text, errorCode: code, photoPaths: paths, language });
      router.replace({ pathname: '/diagnosis/[id]', params: { id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const m = machine.data;
  return (
    <Screen withHeader>
      <Stack.Screen options={{ title: t('diagnose.reportTitle') }} />

      <View style={[styles.machine, { backgroundColor: theme.navy }]}>
        <Ionicons name="construct" size={22} color={theme.orange} />
        <AppText variant="heading" style={styles.white}>
          {m ? [m.tag, m.model?.code, m.line?.name].filter(Boolean).join(' · ') : t('diagnose.machineUnknown')}
        </AppText>
      </View>

      <TextField
        label={t('diagnose.describe')}
        hint={t('diagnose.describeHint')}
        placeholder={t('diagnose.describePlaceholder')}
        value={text}
        onChangeText={setText}
        multiline
      />
      <TextField label={t('diagnose.errorCode')} value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="E101" ltr />

      <Card>
        <AppText variant="label">{t('diagnose.photos')}</AppText>
        <AppText variant="caption" color="textSecondary">
          {t('diagnose.photosHint')}
        </AppText>
        {photos.length ? (
          <View style={styles.thumbs}>
            {photos.map((p, i) => (
              <View key={p.uri} style={styles.thumbWrap}>
                <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('diagnose.removePhoto')}
                  onPress={() => setPhotos((all) => all.filter((_, j) => j !== i))}
                  style={[styles.remove, { backgroundColor: theme.danger }]}>
                  <Ionicons name="close" size={18} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {photos.length < MAX_PHOTOS ? (
          <View style={styles.row}>
            <Button label={t('diagnose.takePhoto')} variant="secondary" onPress={() => addPhoto('camera')} style={styles.flex} />
            <Button label={t('diagnose.choosePhoto')} variant="secondary" onPress={() => addPhoto('library')} style={styles.flex} />
          </View>
        ) : null}
      </Card>

      {error ? <ErrorBox message={error} /> : null}
      <Button label={busy ?? t('diagnose.submit')} onPress={submit} loading={Boolean(busy)} />
      {busy ? (
        <AppText variant="caption" color="textSecondary" style={styles.center}>
          {busy}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  machine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md },
  white: { color: '#FFFFFF', flex: 1 },
  thumbs: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 96, height: 96, borderRadius: Radius.sm },
  remove: { position: 'absolute', top: -8, end: -8, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
});
