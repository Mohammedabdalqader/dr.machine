import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { HttpError } from './http.ts';

export type Role = 'technician' | 'engineer' | 'manager' | 'admin';

export const REVIEWERS: Role[] = ['engineer', 'manager', 'admin'];
export const MANAGERS: Role[] = ['manager', 'admin'];

export type Caller = {
  userId: string;
  companyId: string;
  role: Role;
  fullName: string;
};

/**
 * Loads the caller's profile with the admin client (the JWT was already
 * verified by withSupabase) and enforces the allowed roles.
 */
export async function requireCaller(
  admin: SupabaseClient,
  userId: string | undefined,
  allowed: Role[],
): Promise<Caller> {
  if (!userId) throw new HttpError(401, 'Not signed in');
  const { data, error } = await admin
    .from('profiles')
    .select('company_id, role, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(403, 'No profile for this user');
  if (!allowed.includes(data.role)) throw new HttpError(403, 'Your role cannot do this');
  return { userId, companyId: data.company_id, role: data.role, fullName: data.full_name };
}

export async function audit(
  admin: SupabaseClient,
  caller: Caller,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    company_id: caller.companyId,
    actor_id: caller.userId,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
  });
  if (error) console.error('audit log write failed', error);
}
