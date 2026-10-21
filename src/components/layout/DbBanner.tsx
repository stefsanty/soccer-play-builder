import { isSupabaseConfigured } from '@/lib/supabase/config'

// Shown when Supabase env vars are missing. NEXT_PUBLIC_* values are inlined
// at build time, so this is safe in server and client components alike.
export function DbBanner() {
  if (isSupabaseConfigured()) return null
  return (
    <div
      role="status"
      data-testid="db-banner"
      className="rounded-md border border-amber-500/40 bg-[#1e293b] px-3 shadow-lg py-2 text-sm text-amber-200"
    >
      Database not configured — plays won&apos;t be saved.
    </div>
  )
}
