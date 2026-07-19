import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surface a clear message during development instead of a cryptic runtime crash.
  // eslint-disable-next-line no-console
  console.error(
    'Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY. Check your .env files.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
