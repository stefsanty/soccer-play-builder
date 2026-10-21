'use client'

import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Plus, WifiOff } from 'lucide-react'
import { PlayGrid } from '@/components/library/PlayGrid'
import { listPlays } from '@/lib/api/plays'
import { usePlayStore } from '@/lib/store/playStore'
import { isSupabaseConfigured } from '@/lib/supabase/config'

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)

export function LibraryClient() {
  const plays = usePlayStore((s) => s.plays)
  const isLoading = usePlayStore((s) => s.isLoading)
  const error = usePlayStore((s) => s.error)
  const { setPlays, setLoading, setError } = usePlayStore.getState()
  const online = useOnline()

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listPlays()
      .then((p) => !cancelled && setPlays(p))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load plays'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {!online && (
        <div role="status" className="flex items-center gap-2 rounded-[10px] bg-[#1c242d] px-3 py-2 text-[13px] text-[var(--app-muted)]">
          <WifiOff className="size-4" aria-hidden />
          <span>Offline. Sync waits for a connection.</span>
        </div>
      )}

      <Link
        href="/new"
        className="flex h-[52px] touch-manipulation items-center justify-center gap-2 rounded-[14px] bg-[var(--app-accent)] text-[17px] font-bold text-[var(--app-accent-ink)] no-underline transition-all duration-100 hover:brightness-110 active:scale-[0.97] active:brightness-125"
      >
        <Plus className="size-5" strokeWidth={2.5} aria-hidden /> New play
      </Link>

      {isLoading ? (
        <p className="text-[var(--app-muted)]">Loading plays…</p>
      ) : (
        <>
          {error && (
            <p role="alert" data-testid="library-error" className="text-sm text-red-400">
              Couldn&apos;t load plays: {error}
            </p>
          )}
          <PlayGrid plays={plays} />
        </>
      )}
    </>
  )
}
