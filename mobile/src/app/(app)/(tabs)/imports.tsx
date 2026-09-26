import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { ErrorBox } from '@/components/ui/state-views';
import { Radius, Spacing } from '@/constants/theme';
import { useQuery } from '@/hooks/use-query';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, callFunction } from '@/lib/api';
import { readPickedFile } from '@/lib/files';
import { listDocuments } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import type { DocumentKind, DocumentRow } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

type StepResult = Pick<DocumentRow, 'stage' | 'status' | 'progress' | 'stats'> & { done: boolean; busy?: boolean };

const KIND_BY_EXT: Record<string, { kind: DocumentKind; mime: string }> = {
  xlsx: { kind: 'fault_log', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  xls: { kind: 'fault_log', mime: 'application/vnd.ms-excel' },
  csv: { kind: 'fault_log', mime: 'text/csv' },
  pdf: { kind: 'manual', mime: 'application/pdf' },
};

export default function ImportsScreen() {
  const { t } = useTranslation();
  const { profile, session } = useAuth();
  const documents = useQuery(listDocuments);
  const [active, setActive] = useState<{ id: string; label: string; progress?: StepResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  /** Calls ingest-step until the document is done. Safe to call again after an interruption. */
  const processDocument = async (id: string, label: string) => {
    if (running.current) return;
    running.current = true;
    setActive({ id, label });
    setError(null);
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        let result: StepResult;
        try {
          result = await callFunction<StepResult>('ingest-step', { document_id: id });
        } catch (err) {
          // Temporary AI problems (rate limit, timeout): wait and continue.
          if (err instanceof ApiError && err.body.retryable) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
          throw err;
        }
        setActive({ id, label, progress: result });
        if (result.done || result.status === 'failed') break;
        if (result.busy) await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      running.current = false;
      setActive(null);
      documents.reload();
    }
  };

  const pickAndUpload = async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    const ext = asset.name.split('.').pop()?.toLowerCase() ?? '';
    const type = KIND_BY_EXT[ext];
    if (!type) {
      setError(t('imports.unsupported'));
      return;
    }

    setActive({ id: '', label: asset.name });
    try {
      const bytes = await readPickedFile(asset);
      const safeName = asset.name.replace(/[^\w.\-]+/g, '_');
      const path = `${profile!.company_id}/${Date.now()}-${safeName}`;
      const upload = await supabase!.storage.from('documents').upload(path, bytes, { contentType: type.mime });
      if (upload.error) throw upload.error;
      const { data: doc, error: insertError } = await supabase!
        .from('documents')
        .insert({
          company_id: profile!.company_id,
          kind: type.kind,
          title: asset.name.replace(/\.[^.]+$/, ''),
          file_name: asset.name,
          storage_path: path,
          mime_type: type.mime,
          uploaded_by: session!.user.id,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      setActive(null);
      await processDocument(doc.id, asset.name);
    } catch (err) {
      setActive(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen withHeader refreshing={documents.loading && !active} onRefresh={documents.reload}>
      <AppText variant="body" color="textSecondary">
        {t('imports.hint')}
      </AppText>
      <Button label={t('imports.pick')} onPress={pickAndUpload} disabled={Boolean(active)} />

      {active ? <ProgressCard label={active.label} progress={active.progress} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      {documents.error ? <ErrorBox message={documents.error} onRetry={documents.reload} /> : null}

      {documents.data?.map((d) => (
        <DocumentItem
          key={d.id}
          doc={d}
          disabled={Boolean(active)}
          onResume={() => processDocument(d.id, d.file_name)}
        />
      ))}
    </Screen>
  );
}

function ProgressCard({ label, progress }: { label: string; progress?: StepResult }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const p = progress?.progress ?? {};
  const stage = progress?.stage;
  const total = Number(p.total ?? 0);
  const current = Number({ grouping: p.grouped, structuring: p.structured, embedding: p.embedded }[stage ?? ''] ?? 0);
  const ratio = total ? Math.min(1, current / total) : 0;

  return (
    <Card>
      <AppText variant="label">{label}</AppText>
      <AppText variant="body" color="textSecondary">
        {progress ? t(`imports.stage.${stage}`) : t('imports.uploading')}
        {total ? `  ${current}/${total}` : ''}
      </AppText>
      <View style={[styles.track, { backgroundColor: theme.surfaceMuted }]}>
        <View style={[styles.fill, { backgroundColor: theme.primary, width: `${Math.max(5, ratio * 100)}%` }]} />
      </View>
    </Card>
  );
}

function DocumentItem({ doc, disabled, onResume }: { doc: DocumentRow; disabled: boolean; onResume: () => void }) {
  const { t } = useTranslation();
  const s = doc.stats as Record<string, number>;
  const tone = doc.status === 'ready' ? 'success' : doc.status === 'failed' ? 'danger' : 'warning';
  const summary =
    doc.status === 'ready'
      ? doc.kind === 'manual'
        ? t('imports.statsManual', { pages: s.pages ?? 0 })
        : t('imports.statsLog', { rows: s.rows ?? 0, drafts: s.new_drafts ?? 0, linked: s.linked_to_existing ?? 0 })
      : doc.status === 'failed'
        ? doc.error ?? ''
        : t(`imports.stage.${doc.stage}`);

  return (
    <ListRow
      title={doc.title}
      subtitle={summary}
      footer={
        <View style={styles.footer}>
          <View style={styles.badges}>
            <Badge label={t(`imports.kind.${doc.kind}`)} tone="info" />
            <Badge label={t(`imports.status.${doc.status}`)} tone={tone} />
          </View>
          {doc.status === 'processing' || doc.status === 'uploaded' ? (
            <Button label={t('imports.resume')} variant="secondary" onPress={onResume} disabled={disabled} />
          ) : null}
          {doc.status === 'ready' && doc.kind === 'fault_log' && s.new_drafts ? (
            <Button label={t('imports.goReview')} variant="secondary" onPress={() => router.navigate('/knowledge')} />
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: Radius.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.sm },
  footer: { gap: Spacing.sm, marginTop: Spacing.xs },
  badges: { flexDirection: 'row', gap: Spacing.xs },
});
