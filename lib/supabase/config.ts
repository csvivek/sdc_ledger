// Supabase is switched on only when both environment variables are set.
// Without them the app runs as the prototype, on fake data with a mock login.
// Both values are public by design (they ship to the browser); the database is
// protected by the row level security rules in supabase/migrations.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
