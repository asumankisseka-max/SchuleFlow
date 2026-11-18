import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const metaEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;

const browserSupabaseUrl = metaEnv?.VITE_SUPABASE_URL?.trim() || '';
const browserSupabaseAnonKey = metaEnv?.VITE_SUPABASE_ANON_KEY?.trim() || '';

export let isSupabaseConfigured = Boolean(browserSupabaseUrl && browserSupabaseAnonKey);

export let supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(browserSupabaseUrl, browserSupabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export function setRuntimeSupabaseConfig(
  url: string | null | undefined,
  anonKey: string | null | undefined
): SupabaseClient | null {
  const cleanUrl = url?.trim() || '';
  const cleanKey = anonKey?.trim() || '';
  if (!cleanUrl || !cleanKey) {
    return supabase;
  }
  if (!supabase) {
    supabase = createClient(cleanUrl, cleanKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    isSupabaseConfigured = true;
  }
  return supabase;
}

export function getSupabaseClient(): SupabaseClient | null {
  return supabase;
}

export function createSupabaseServerClient(accessToken?: string): SupabaseClient {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    '';

  if (!url || !key) {
    throw new Error(
      'Supabase server environment variables are not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY).'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    ...(accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : {}),
  });
}
