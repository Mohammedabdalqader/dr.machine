import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Chips } from '@/components/ui/chips';
import { Screen } from '@/components/ui/screen';
import { ErrorBox } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { callFunction } from '@/lib/api';
import type { Role } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

export default function NewMemberScreen() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('technician');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles: Role[] = profile?.role === 'admin' ? ['technician', 'engineer', 'manager', 'admin'] : ['technician', 'engineer', 'manager'];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await callFunction('admin-users', { action: 'create', full_name: fullName, email, password, role });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen withHeader>
      <Stack.Screen options={{ title: t('team.add') }} />
      <TextField label={t('team.fullName')} value={fullName} onChangeText={setFullName} />
      <TextField
        label={t('team.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        ltr
      />
      <TextField
        label={t('team.password')}
        hint={t('team.passwordHint')}
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        ltr
      />
      <Chips label={t('team.role')} value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: t(`roles.${r}`) }))} />
      {error ? <ErrorBox message={error} /> : null}
      <Button
        label={t('common.save')}
        onPress={save}
        loading={busy}
        disabled={!fullName.trim() || !email.trim() || password.length < 8}
      />
    </Screen>
  );
}
