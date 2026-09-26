import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Empty, ErrorBox, Loading } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { getDiagnosis, photoUrls, sendFeedback } from '@/lib/diagnosis';
import type { Confidence, DiagnosisCause, DiagnosisRow } from '@/lib/types';

/** Steps 2-3 of the loop: likely causes with evidence, safety first (product brief, Appendix B). */
export default function DiagnosisScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useQuery(async () => {
    const d = await getDiagnosis(id);
    return { diagnosis: d, photos: d ? await photoUrls(d.photo_paths) : [] };
  }, [id]);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!data.data?.diagnosis) return <Empty message={t('common.noResults')} />;
  return <DiagnosisView diagnosis={data.data.diagnosis} photos={data.data.photos} reload={data.reload} />;
}

function DiagnosisView({ diagnosis: d, photos, reload }: { diagnosis: DiagnosisRow; photos: string[]; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState<number | null>(d.causes.length ? 0 : null);
  const [escalating, setEscalating] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (key: string, action: 'start_fix' | 'not_this' | 'escalate', recordId?: string) => {
    setBusy(key);
    setError(null);
    try {
      await sendFeedback(d.id, action, recordId, note);
      if (action === 'escalate') setEscalating(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const machineLine = d.machine
    ? [d.machine.tag, d.machine.model?.code, d.machine.line?.name].filter(Boolean).join(' · ')
    : t('diagnose.machineUnknown');
  const weakLeads = d.evidence.weak_leads ?? [];
  const followUp = d.understanding.follow_up_question;
  const escalated = d.status === 'escalated';

  return (
    <Screen withHeader>
      <Stack.Screen options={{ title: t('diagnose.resultTitle') }} />

      {/* What was reported */}
      <View style={[styles.header, { backgroundColor: theme.navy }]}>
        <AppText variant="caption" style={styles.muted}>
          {machineLine.toUpperCase()}
        </AppText>
        {d.input_text ? (
          <AppText variant="heading" style={styles.white}>
            “{d.input_text}”
          </AppText>
        ) : null}
        <View style={styles.row}>
          {d.input_error_code ? <Badge label={d.input_error_code} tone="warning" /> : null}
          {d.latency_ms ? <Badge label={t('diagnose.seconds', { seconds: (d.latency_ms / 1000).toFixed(1) })} /> : null}
        </View>
        {photos.length ? (
          <View style={styles.row}>
            {photos.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.photo} contentFit="cover" />
            ))}
          </View>
        ) : null}
      </View>

      {/* Safety always comes before any cause or step */}
      <View style={[styles.safety, { backgroundColor: theme.safetyBackground }]}>
        <AppText variant="label" style={{ color: theme.safetyText }}>
          ⚠ {t('diagnose.safetyFirst')}
        </AppText>
        {d.safety_notes.map((s) => (
          <AppText key={s} variant="body" style={{ color: theme.safetyText }}>
            • {s}
          </AppText>
        ))}
      </View>

      {escalated ? (
        <Card style={{ borderColor: theme.steel }}>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={22} color={theme.steel} />
            <AppText variant="label">{t('diagnose.escalated')}</AppText>
          </View>
          {d.escalation_note ? (
            <AppText variant="body" color="textSecondary">
              {d.escalation_note}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {d.causes.length === 0 ? (
        <Card style={{ borderColor: theme.warning }}>
          <AppText variant="heading">{t('diagnose.notEnoughTitle')}</AppText>
          <AppText variant="body" color="textSecondary">
            {t('diagnose.notEnoughBody')}
          </AppText>
        </Card>
      ) : (
        d.causes.map((c, i) => (
          <CauseCard
            key={c.record_id}
            index={i}
            cause={c}
            open={open === i}
            onToggle={() => setOpen(open === i ? null : i)}
            rejected={d.rejected_record_ids.includes(c.record_id)}
            selected={d.selected_record_id === c.record_id}
            busy={busy}
            onStart={() => act(`start-${i}`, 'start_fix', c.record_id)}
            onReject={() => act(`not-${i}`, 'not_this', c.record_id)}
          />
        ))
      )}

      {followUp ? (
        <Card>
          <View style={styles.row}>
            <Ionicons name="help-circle-outline" size={20} color={theme.steel} />
            <AppText variant="label">{t('diagnose.followUp')}</AppText>
          </View>
          <AppText variant="body">{followUp}</AppText>
        </Card>
      ) : null}

      {weakLeads.length ? (
        <Card>
          <AppText variant="label" color="textSecondary">
            {t('diagnose.weakLeads')}
          </AppText>
          {weakLeads.map((c) => (
            <AppText key={c.record_id} variant="body" color="textSecondary">
              • {c.title}
            </AppText>
          ))}
        </Card>
      ) : null}

      {error ? <ErrorBox message={error} /> : null}

      {!escalated ? (
        escalating ? (
          <Card>
            <TextField label={t('diagnose.escalateNote')} value={note} onChangeText={setNote} multiline />
            <Button label={t('diagnose.escalateSend')} onPress={() => act('escalate', 'escalate')} loading={busy === 'escalate'} />
            <Button label={t('common.cancel')} variant="ghost" onPress={() => setEscalating(false)} />
          </Card>
        ) : (
          <Button
            label={t('diagnose.escalate')}
            variant={d.causes.length ? 'secondary' : 'primary'}
            onPress={() => setEscalating(true)}
          />
        )
      ) : null}
    </Screen>
  );
}

function CauseCard({
  index,
  cause: c,
  open,
  onToggle,
  rejected,
  selected,
  busy,
  onStart,
  onReject,
}: {
  index: number;
  cause: DiagnosisCause;
  open: boolean;
  onToggle: () => void;
  rejected: boolean;
  selected: boolean;
  busy: string | null;
  onStart: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone: Record<Confidence, string> = { high: theme.success, medium: theme.warning, low: theme.textSecondary };

  const evidence = [
    c.past_cases ? t('diagnose.pastCases', { count: c.past_cases }) : t('diagnose.noPastCases'),
    c.past_cases_total > c.past_cases ? t('diagnose.pastCasesTotal', { count: c.past_cases_total - c.past_cases }) : null,
    ...c.manual_pages.map((m) => t('diagnose.manualPage', { page: m.page })),
  ].filter(Boolean);

  return (
    <Card style={[selected && { borderColor: theme.primary, borderWidth: 2 }, rejected && styles.rejected]}>
      <Pressable onPress={onToggle} accessibilityRole="button" style={styles.causeHead}>
        <View style={[styles.number, { backgroundColor: index === 0 ? theme.primary : theme.surfaceMuted }]}>
          <AppText variant="label" style={{ color: index === 0 ? '#FFFFFF' : theme.text }}>
            {index + 1}
          </AppText>
        </View>
        <View style={styles.flex}>
          <AppText variant="heading">{c.title}</AppText>
          <AppText variant="caption">
            <AppText variant="caption" style={{ color: tone[c.confidence], fontWeight: '700' }}>
              {t(`diagnose.confidence.${c.confidence}`)}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {' · '}
              {evidence.join(' · ')}
            </AppText>
          </AppText>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.textSecondary} />
      </Pressable>

      {selected ? <Badge label={t('diagnose.selected')} tone="warning" /> : null}
      {rejected ? <Badge label={t('diagnose.markedNotThis')} /> : null}

      {open ? (
        <View style={styles.details}>
          {c.reason ? (
            <Section label={t('diagnose.whyThis')}>
              <AppText variant="body">{c.reason}</AppText>
            </Section>
          ) : null}
          {index > 0 && c.safety_notes?.length ? (
            <View style={[styles.qualified, { backgroundColor: theme.safetyBackground }]}>
              <AppText variant="label" style={{ color: theme.safetyText }}>
                ⚠ {t('diagnose.safetyFirst')}
              </AppText>
              {c.safety_notes.map((s) => (
                <AppText key={s} variant="body" style={{ color: theme.safetyText }}>
                  • {s}
                </AppText>
              ))}
            </View>
          ) : null}
          <Section label={t('diagnose.rootCause')}>
            <AppText variant="body">{c.root_cause}</AppText>
          </Section>
          {c.requires_qualified ? (
            <View style={[styles.qualified, { backgroundColor: theme.safetyBackground }]}>
              <AppText variant="label" style={{ color: theme.safetyText }}>
                ⚡ {t('diagnose.qualified')}
              </AppText>
            </View>
          ) : null}
          <Section label={t('diagnose.fixSteps')}>
            {c.fix_steps.map((s, i) => (
              <AppText key={`${i}-${s}`} variant="body">
                {i + 1}. {s}
              </AppText>
            ))}
          </Section>
          {c.parts.length ? (
            <Section label={t('diagnose.parts')}>
              <AppText variant="body">{c.parts.join(' · ')}</AppText>
            </Section>
          ) : null}
          {c.tools.length ? (
            <Section label={t('diagnose.tools')}>
              <AppText variant="body">{c.tools.join(' · ')}</AppText>
            </Section>
          ) : null}
          {c.estimated_minutes ? (
            <AppText variant="caption" color="textSecondary">
              {t('diagnose.time', { minutes: c.estimated_minutes })}
            </AppText>
          ) : null}
          {c.manual_pages.length ? (
            <AppText variant="caption" color="textSecondary">
              {c.manual_pages.map((m) => `${m.title} · ${t('diagnose.manualPage', { page: m.page })}`).join('\n')}
            </AppText>
          ) : null}
          {selected ? (
            <AppText variant="caption" color="textSecondary">
              {t('diagnose.outcomeSoon')}
            </AppText>
          ) : null}
          <View style={styles.row}>
            {!selected ? (
              <Button label={t('diagnose.startFix')} onPress={onStart} loading={busy === `start-${index}`} style={styles.flex} />
            ) : null}
            {!rejected ? (
              <Button
                label={t('diagnose.notThis')}
                variant="secondary"
                onPress={onReject}
                loading={busy === `not-${index}`}
                style={styles.flex}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  white: { color: '#FFFFFF' },
  muted: { color: '#C9D1DB', letterSpacing: 0.5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  photo: { width: 72, height: 72, borderRadius: Radius.sm },
  safety: { borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs },
  causeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  number: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  details: { gap: Spacing.md, marginTop: Spacing.sm },
  section: { gap: Spacing.xs },
  qualified: { borderRadius: Radius.sm, padding: Spacing.sm },
  rejected: { opacity: 0.55 },
});
