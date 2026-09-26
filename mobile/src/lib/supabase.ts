import '@/lib/storage';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

/**
 * Null until mobile/.env.local has the project URL and publishable key.
 * Only the publishable (anon) key belongs in the app; secrets such as the
 * DeepInfra key live in Supabase Edge Function secrets, never here.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export type BackendStatus = 'missing' | 'connected' | 'error';

/** Lightweight reachability check against the Auth health endpoint. */
export async function checkBackend(): Promise<BackendStatus> {
  if (!isSupabaseConfigured) return 'missing';
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: publishableKey! } });
    return res.ok ? 'connected' : 'error';
  } catch {
    return 'error';
  }
}
