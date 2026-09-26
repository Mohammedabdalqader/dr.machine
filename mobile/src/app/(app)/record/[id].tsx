import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chips } from '@/components/ui/chips';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { Empty, ErrorBox, Loading } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, callFunction } from '@/lib/api';
import { documentTitles, getRecord, listModels, recordCases } from '@/lib/queries';
import { REVIEWER_ROLES, type FaultCase, type FaultRecord, type MachineModel } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

type Form = {
  title: string;
  component: string;
  symptoms: string;
  error_codes: string;
  root_cause: string;
  fix_steps: string;
  parts: string;
  tools: string;
  safety_notes: string;
  estimated_minutes: string;
  requires_qualified: 'yes' | 'no';
  model_id: string;
};

const ALL_MODELS = '__all__';
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function toForm(r: FaultRecord): Form {
  return {
    title: r.title,
    component: r.component,
    symptoms: r.symptoms,
    error_codes: r.error_codes.join(', '),
    root_cause: r.root_cause,
    fix_steps: r.fix_steps.join('\n'),
    parts: r.parts.join('\n'),
    tools: r.tools.join('\n'),
    safety_notes: r.safety_notes.join('\n'),
    estimated_minutes: r.estimated_minutes?.toString() ?? '',
    requires_qualified: r.requires_qualified ? 'yes' : 'no',
    model_id: r.model_id ?? ALL_MODELS,
  };
}

function toFields(f: Form) {
  return {
    title: f.title,
    component: f.component,
    symptoms: f.symptoms,
    error_codes: f.error_codes.split(/[,\n،]/).map((c) => c.trim()).filter(Boolean),
    root_cause: f.root_cause,
    fix_steps: lines(f.fix_steps),
    parts: lines(f.parts),
    tools: lines(f.tools),
    safety_notes: lines(f.safety_notes),
    estimated_minutes: f.estimated_minutes ? Number(f.estimated_minutes) : null,
    requires_qualified: f.requires_qualified === 'yes',
    model_id: f.model_id === ALL_MODELS ? null : f.model_id,
  };
}

function confirm(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert('', message, [
      { text: '✕', style: 'cancel', onPress: () => resolve(false) },
      { text: '✓', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function RecordScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hasRole } = useAuth();
  const reviewer = hasRole(REVIEWER_ROLES);

  const data = useQuery(async () => {
    const [record, cases, models] = await Promise.all([getRecord(id), recordCases(id), listModels()]);
    const titles = await documentTitles([...new Set(record?.manual_refs.map((m) => m.document_id) ?? [])]);
    return { record, cases, models, titles };
  }, [id]);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!data.data?.record) return <Empty message={t('common.noResults')} />;

  // Keyed by version: after every save the editor restarts from the saved record.
  return (
    <RecordDetail
      key={`${data.data.record.id}-${data.data.record.version}`}
      record={data.data.record}
      cases={data.data.cases}
      models={data.data.models}
      titles={data.data.titles}
      reviewer={reviewer}
      reload={data.reload}
    />
  );
}

function RecordDetail({
  record,
  cases,
  models,
  titles,
  reviewer,
  reload,
}: {
  record: FaultRecord;
  cases: FaultCase[];
  models: MachineModel[];
  titles: Record<string, string>;
  reviewer: boolean;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [form, setForm] = useState<Form>(() => toForm(record));
  const [editing, setEditing] = useState(reviewer && record.status === 'draft');
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof Form) => (value: string) => setForm({ ...form, [key]: value });

  const act = async (action: 'save' | 'approve' | 'reject') => {
    if (action === 'reject' && !(await confirm(t('knowledge.rejectConfirm')))) return;
    setBusy(action);
    setProblems([]);
    setMessage(null);
    try {
      await callFunction('records', { action, id: record.id, fields: action === 'reject' ? undefined : toFields(form) });
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setProblems((err.body.problems as string[]) ?? [err.message]);
      else if (err instanceof ApiError && err.status === 409) {
        setMessage(t('knowledge.conflict'));
        await reload();
      } else setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const statusTone = record.status === 'approved' ? 'success' : record.status === 'rejected' ? 'danger' : 'warning';
  const modelName = models.find((m) => m.id === record.model_id)?.code ?? t('knowledge.allModels');

  return (
    <Screen withHeader>
      <Stack.Screen options={{ title: record.title || t('knowledge.title') }} />

      <View style={styles.row}>
        <Badge label={t(`knowledge.${record.status}`)} tone={statusTone} />
        <Badge label={t('knowledge.version', { version: record.version })} />
        <Badge label={modelName} tone="info" />
        {record.estimated_minutes ? <Badge label={t('common.minutes', { count: record.estimated_minutes })} /> : null}
      </View>

      {editing ? (
        <EditForm form={form} set={set} models={models} setQualified={(v) => setForm({ ...form, requires_qualified: v })} setModel={(v) => setForm({ ...form, model_id: v })} />
      ) : (
        <ReadView record={record} />
      )}

      {problems.length ? (
        <Card style={{ borderColor: theme.danger }}>
          <AppText variant="label" color="danger">
            {t('knowledge.incomplete')}
          </AppText>
          {problems.map((p) => (
            <AppText key={p} variant="caption" color="textSecondary">
              • {p}
            </AppText>
          ))}
        </Card>
      ) : null}
      {message ? <ErrorBox message={message} /> : null}

      {reviewer ? (
        <View style={styles.actions}>
          {editing ? (
            <>
              {record.status !== 'approved' ? (
                <Button label={t('knowledge.approve')} onPress={() => act('approve')} loading={busy === 'approve'} />
              ) : null}
              <Button label={t('knowledge.saveDraft')} variant="secondary" onPress={() => act('save')} loading={busy === 'save'} />
              {record.status !== 'rejected' ? (
                <Button label={t('knowledge.reject')} variant="ghost" onPress={() => act('reject')} loading={busy === 'reject'} />
              ) : null}
            </>
          ) : (
            <Button label={t('common.edit')} variant="secondary" onPress={() => setEditing(true)} />
          )}
        </View>
      ) : null}

      <AppText variant="heading">{t('knowledge.evidence')}</AppText>
      {record.manual_refs.length ? (
        <Card>
          <AppText variant="label">{t('knowledge.manualPages')}</AppText>
          {record.manual_refs.map((m) => (
            <View key={`${m.document_id}-${m.page}`} style={styles.row}>
              <Ionicons name="book-outline" size={16} color={theme.textSecondary} />
              <AppText variant="body">
                {t('knowledge.manualPage', { title: titles[m.document_id] ?? '—', page: m.page })}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}
      <AppText variant="label">
        {t('knowledge.pastCases')} ({cases.length})
      </AppText>
      {cases.map((c) => (
        <ListRow
          key={c.id}
          title={c.problem}
          subtitle={[c.source_ref, c.occurred_on, c.machine_label, c.action_taken].filter(Boolean).join(' · ')}
        />
      ))}
    </Screen>
  );
}

function ReadView({ record }: { record: FaultRecord }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <>
      {/* Safety always comes before the fix. */}
      <View style={[styles.safety, { backgroundColor: theme.safetyBackground }]}>
        <AppText variant="label" style={{ color: theme.safetyText }}>
          ⚠ {t('knowledge.safety')}
        </AppText>
        {record.safety_notes.map((s) => (
          <AppText key={s} variant="body" style={{ color: theme.safetyText }}>
            • {s}
          </AppText>
        ))}
        {record.requires_qualified ? (
          <AppText variant="label" style={{ color: theme.safetyText }}>
            {t('knowledge.qualified')}
          </AppText>
        ) : null}
      </View>
      <Section label={t('knowledge.symptoms')} value={record.symptoms} />
      {record.error_codes.length ? <Section label={t('knowledge.errorCodes')} value={record.error_codes.join(', ')} /> : null}
      <Section label={t('knowledge.rootCause')} value={record.root_cause} />
      {record.component ? <Section label={t('knowledge.component')} value={record.component} /> : null}
      <Card>
        <AppText variant="label">{t('knowledge.fixSteps')}</AppText>
        {record.fix_steps.map((s, i) => (
          <AppText key={`${i}-${s}`} variant="body">
            {i + 1}. {s}
          </AppText>
        ))}
      </Card>
      {record.parts.length ? <Section label={t('knowledge.parts')} value={record.parts.join('\n')} /> : null}
      {record.tools.length ? <Section label={t('knowledge.tools')} value={record.tools.join('\n')} /> : null}
    </>
  );
}

function Section({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <AppText variant="label">{label}</AppText>
      <AppText variant="body">{value}</AppText>
    </Card>
  );
}

function EditForm({
  form,
  set,
  models,
  setQualified,
  setModel,
}: {
  form: Form;
  set: (key: keyof Form) => (value: string) => void;
  models: { id: string; code: string }[];
  setQualified: (v: 'yes' | 'no') => void;
  setModel: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.form}>
      <TextField label={t('knowledge.titleField')} value={form.title} onChangeText={set('title')} />
      <TextField label={t('knowledge.safety')} hint={t('knowledge.listHint')} value={form.safety_notes} onChangeText={set('safety_notes')} multiline />
      <Chips
        label={t('knowledge.qualified')}
        value={form.requires_qualified}
        onChange={setQualified}
        options={[
          { value: 'no', label: '✕' },
          { value: 'yes', label: '✓' },
        ]}
      />
      <TextField label={t('knowledge.symptoms')} value={form.symptoms} onChangeText={set('symptoms')} multiline />
      <TextField label={t('knowledge.errorCodes')} hint={t('knowledge.codesHint')} value={form.error_codes} onChangeText={set('error_codes')} autoCapitalize="characters" ltr />
      <TextField label={t('knowledge.rootCause')} value={form.root_cause} onChangeText={set('root_cause')} multiline />
      <TextField label={t('knowledge.component')} value={form.component} onChangeText={set('component')} />
      <TextField label={t('knowledge.fixSteps')} hint={t('knowledge.listHint')} value={form.fix_steps} onChangeText={set('fix_steps')} multiline />
      <TextField label={t('knowledge.parts')} hint={t('knowledge.listHint')} value={form.parts} onChangeText={set('parts')} multiline />
      <TextField label={t('knowledge.tools')} hint={t('knowledge.listHint')} value={form.tools} onChangeText={set('tools')} multiline />
      <TextField label={t('knowledge.estimatedTime')} value={form.estimated_minutes} onChangeText={set('estimated_minutes')} keyboardType="number-pad" ltr />
      <Chips
        label={t('machines.model')}
        value={form.model_id}
        onChange={setModel}
        options={[{ value: ALL_MODELS, label: t('knowledge.allModels') }, ...models.map((m) => ({ value: m.id, label: m.code }))]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  actions: { gap: Spacing.sm },
  form: { gap: Spacing.md },
  safety: { borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs },
});
