import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { supabase } from '@/lib/supabase';
import type { Profile, Role } from '@/lib/types';

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** True when signed in but no company profile exists for the account. */
  missingProfile: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  hasRole: (roles: Role[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase!
    .from('profiles')
    .select('id, company_id, full_name, role, language, company:companies(name, is_sample)')
    .eq('id', userId)
    .maybeSingle();
  return (data as unknown as Profile) ?? null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const apply = async (next: Session | null) => {
      const nextProfile = next ? await loadProfile(next.user.id) : null;
      if (!active) return;
      setSession(next);
      setProfile(nextProfile);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Token refreshes don't change who is signed in; avoid reloading the profile.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: calling Supabase inside this callback can deadlock the auth lock.
        setTimeout(() => apply(next), 0);
      } else if (next) {
        setSession(next);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    loading,
    session,
    profile,
    missingProfile: Boolean(session && !profile),
    signIn: async (email, password) => {
      const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
      return error ? { error: error.message } : {};
    },
    signOut: async () => {
      await supabase!.auth.signOut();
    },
    hasRole: (roles) => Boolean(profile && roles.includes(profile.role)),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
