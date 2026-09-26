import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Chips } from '@/components/ui/chips';
import { Screen } from '@/components/ui/screen';
import { ErrorBox, Loading } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { useQuery } from '@/hooks/use-query';
import { getMachine, listLines, listModels } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import type { Line, Machine, MachineModel } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

const NONE = '__none__';

export default function MachineFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const options = useQuery(async () => {
    const [models, lines, machine] = await Promise.all([listModels(), listLines(), id ? getMachine(id) : null]);
    return { models, lines, machine };
  }, [id]);

  if (options.loading && !options.data) return <Loading />;
  if (options.error || !options.data) return <ErrorBox message={options.error ?? ''} onRetry={options.reload} />;
  // Keyed so the form starts from the loaded machine instead of copying it into state later.
  return <MachineForm key={options.data.machine?.id ?? 'new'} {...options.data} />;
}

function MachineForm({ models, lines, machine }: { models: MachineModel[]; lines: Line[]; machine: Machine | null }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [tag, setTag] = useState(machine?.tag ?? '');
  const [modelId, setModelId] = useState(machine?.model_id ?? NONE);
  const [lineId, setLineId] = useState(machine?.line_id ?? NONE);
  const [serial, setSerial] = useState(machine?.serial_number ?? '');
  const [installed, setInstalled] = useState(machine?.installed_on ?? '');
  const [notes, setNotes] = useState(machine?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const nextErrors: Record<string, string> = {};
    if (!tag.trim()) nextErrors.tag = t('common.required');
    if (installed && !/^\d{4}-\d{2}-\d{2}$/.test(installed)) nextErrors.installed = t('machines.invalidDate');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    setSaveError(null);
    const row = {
      company_id: profile!.company_id,
      tag: tag.trim(),
      model_id: modelId === NONE ? null : modelId,
      line_id: lineId === NONE ? null : lineId,
      serial_number: serial.trim(),
      installed_on: installed || null,
      notes: notes.trim(),
    };
    const { error } = machine
      ? await supabase!.from('machines').update(row).eq('id', machine.id)
      : await supabase!.from('machines').insert(row);
    setBusy(false);
    if (error) {
      setSaveError(error.code === '23505' ? t('machines.tagTaken') : error.message);
      return;
    }
    router.back();
  };

  return (
    <Screen withHeader>
      <Stack.Screen options={{ title: machine ? machine.tag : t('machines.add') }} />
      <TextField
        label={t('machines.tag')}
        hint={t('machines.tagHint')}
        value={tag}
        onChangeText={setTag}
        autoCapitalize="characters"
        error={errors.tag}
        ltr
      />
      <Chips
        label={t('machines.model')}
        value={modelId}
        onChange={setModelId}
        options={[{ value: NONE, label: t('machines.noModel') }, ...models.map((m) => ({ value: m.id, label: m.code }))]}
      />
      <Chips
        label={t('machines.line')}
        value={lineId}
        onChange={setLineId}
        options={[{ value: NONE, label: t('machines.noLine') }, ...lines.map((l) => ({ value: l.id, label: l.name }))]}
      />
      <TextField label={t('machines.serial')} value={serial} onChangeText={setSerial} ltr />
      <TextField
        label={t('machines.installed')}
        hint={t('machines.installedHint')}
        value={installed}
        onChangeText={setInstalled}
        placeholder="2024-05-14"
        error={errors.installed}
        ltr
      />
      <TextField label={t('machines.notes')} value={notes} onChangeText={setNotes} multiline />
      {saveError ? <ErrorBox message={saveError} /> : null}
      <Button label={t('common.save')} onPress={save} loading={busy} />
    </Screen>
  );
}
