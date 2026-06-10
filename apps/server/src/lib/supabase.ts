import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Optional: when env vars are missing (local dev), persistence is skipped.
export const supabase: SupabaseClient | null =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

if (!supabase) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_ANON_KEY not set — results will not be saved');
}
