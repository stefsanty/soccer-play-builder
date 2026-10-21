'use client'

// "Done" check in the top bar: saves the editor's current play (POST first, PUT afterwards).
// Without a database it shows the DB warning instead.

import { useState } from 'react'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { useEditorStore } from '@/lib/store/editorStore'
import { createPlay, updatePlay } from '@/lib/api/plays'
import type { PlayInsert } from '@/lib/types/play'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { DbBanner } from '@/components/layout/DbBanner'

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function SaveButton() {
  const play = useEditorStore((s) => s.play)
  const markSaved = useEditorStore((s) => s.markSaved)
  const [status, setStatus] = useState<Status>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDbNotice, setShowDbNotice] = useState(false)

  async function onSave() {
    if (!isSupabaseConfigured()) {
      setShowDbNotice(true)
      return
    }
    if (!play) return
    setStatus('saving')
    setError(null)
    try {
      const input: PlayInsert = {
        title: play.title,
        description: play.description,
        authorId: play.authorId,
        authorName: play.authorName,
        meta: play.meta,
        players: play.players,
        steps: play.steps,
      }
      const saved = savedId ? await updatePlay(savedId, input) : await createPlay(input)
      setSavedId(saved.id)
      markSaved()
      setStatus('saved')
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setStatus('error')
    }
  }

  const label = status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : status === 'error' ? 'Retry save' : 'Save'
  const Icon = status === 'saving' ? Loader2 : status === 'error' ? RotateCcw : Check

  return (
    <>
      <button
        type="button"
        data-testid="save-button"
        data-status={status}
        aria-label={label}
        disabled={status === 'saving'}
        onClick={onSave}
        className={`flex h-11 w-10 touch-manipulation items-center justify-center transition-transform duration-100 active:scale-90 ${status === 'error' ? 'text-[#ff6b6b]' : 'text-[#14b8a6]'}`}
      >
        <Icon className={`size-[22px] ${status === 'saving' ? 'animate-spin' : ''}`} strokeWidth={2.6} aria-hidden />
      </button>
      {(showDbNotice || status === 'error') && (
        <div className="absolute inset-x-0 top-full p-2">
          {status === 'error' ? (
            <p role="alert" data-testid="save-error" className="rounded-md border border-red-500/40 bg-[var(--app-card)] px-3 py-2 text-sm text-red-300 shadow-lg">
              {error}
            </p>
          ) : (
            <DbBanner />
          )}
        </div>
      )}
    </>
  )
}
