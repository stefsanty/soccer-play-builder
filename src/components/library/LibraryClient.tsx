'use client'

import { useEffect } from 'react'
import { PlayGrid } from '@/components/library/PlayGrid'
import { listPlays } from '@/lib/api/plays'
import { usePlayStore } from '@/lib/store/playStore'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export function LibraryClient() {
  const plays = usePlayStore((s) => s.plays)
  const isLoading = usePlayStore((s) => s.isLoading)
  const error = usePlayStore((s) => s.error)
  const { setPlays, setLoading, setError } = usePlayStore.getState()

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

  if (isLoading) return <p className="text-slate-500">Loading plays…</p>
  return (
    <>
      {error && (
        <p role="alert" data-testid="library-error" className="mb-4 text-sm text-red-400">
          Couldn&apos;t load plays: {error}
        </p>
      )}
      <PlayGrid plays={plays} />
    </>
  )
}
