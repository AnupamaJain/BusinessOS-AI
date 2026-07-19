import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client with the anon key (browser/RLS-scoped).
 * For server-side operations that need elevated access, use createServiceClient.
 */
export function createSupabaseClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
  });
}

/**
 * Creates a Supabase client with the service role key.
 * This client bypasses RLS — use only for server-side operations
 * where tenant scope is enforced programmatically.
 */
export function createServiceClient(
  supabaseUrl: string,
  serviceRoleKey: string,
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export type { SupabaseClient };
