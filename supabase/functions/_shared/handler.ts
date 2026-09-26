import { withSupabase } from 'npm:@supabase/server@^1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { requireCaller, type Caller, type Role } from './auth.ts';
import { errorResponse, HttpError } from './http.ts';

export type Handler = (
  req: Request,
  ctx: { caller: Caller; admin: SupabaseClient; supabase: SupabaseClient },
) => Promise<Response>;

/**
 * Standard entry point for app-facing functions: verifies the user JWT,
 * loads the caller's company and role, enforces `roles`, handles CORS and
 * turns errors into JSON. `admin` bypasses RLS: always filter by caller.companyId.
 */
export function userHandler(roles: Role[], handler: Handler) {
  return {
    fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
      try {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
        const caller = await requireCaller(ctx.supabaseAdmin, ctx.userClaims?.id, roles);
        return await handler(req, { caller, admin: ctx.supabaseAdmin, supabase: ctx.supabase });
      } catch (err) {
        return errorResponse(err);
      }
    }),
  };
}
