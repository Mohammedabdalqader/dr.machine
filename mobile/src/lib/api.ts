import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Calls an Edge Function and surfaces its JSON error message. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new ApiError('Backend not configured');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const payload = await res.json().catch(() => ({}));
      throw new ApiError(String(payload.error ?? error.message), res.status, payload);
    }
    throw new ApiError(error.message);
  }
  return data as T;
}

/** Throws the Supabase error, returns data otherwise. */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new ApiError(result.error.message);
  return result.data as T;
}
