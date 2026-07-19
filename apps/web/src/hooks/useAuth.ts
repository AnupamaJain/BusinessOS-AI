import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AuthSession } from '../lib/types';

export interface UseAuthResult {
  session: AuthSession | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    void supabase.auth
      .getSession()
      .then(({ data }: { data: { session: AuthSession | null } }) => {
        if (mounted) {
          setSession(data.session);
          setLoading(false);
        }
      });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event: string, nextSession: AuthSession | null) => {
        setSession(nextSession);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? String(error.message ?? 'Sign in failed') : null;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  return { session, loading, signIn, signOut };
}
