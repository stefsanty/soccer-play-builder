// Shared Supabase env handling. NEXT_PUBLIC_* vars are inlined at build time,
// so this works identically in the browser and on the server.
export const SUPABASE_NOT_CONFIGURED = 'Database not configured'

export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey || url.startsWith('your-') || anonKey.startsWith('your-')) return null
  return { url, anonKey }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null
}

let warned = false
export function warnNotConfigured() {
  if (warned) return
  warned = true
  console.warn(
    '[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set — database features disabled.',
  )
}
