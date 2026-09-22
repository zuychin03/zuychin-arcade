import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseSecretKey = (
  process.env.SUPABASE_SECRET_KEY
  ?? process.env.SUPABASE_SERVICE_ROLE_KEY
)?.trim();

// Persistence is optional in local development, but writes always use a
// backend-only key. A publishable or anon key must never be able to submit scores.
export const supabase: SupabaseClient | null = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

if (!supabase) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SECRET_KEY not set - results will not be saved');
}
