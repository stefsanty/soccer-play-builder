'use client'

// Saves the editor's current play: POST on first save, PUT afterwards.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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

  if (!isSupabaseConfigured()) {
    // The banner is absolutely positioned under the (relative) top bar.
    return (
      <>
        <Button size="sm" data-testid="save-button" className="bg-[#14b8a6] text-[#0f172a] hover:bg-[#0d9488]"
          onClick={() => setShowDbNotice(true)}>
          Save
        </Button>
        {showDbNotice && (
          <div className="absolute inset-x-0 top-full p-2">
            <DbBanner />
          </div>
        )}
      </>
    )
  }

  async function onSave() {
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

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={status === 'error' ? 'destructive' : 'default'}
        disabled={!play || status === 'saving'}
        onClick={onSave}
        data-testid="save-button"
        className={status === 'error' ? '' : 'bg-[#14b8a6] text-[#0f172a] hover:bg-[#0d9488]'}
      >
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : status === 'error' ? 'Retry save' : 'Save'}
      </Button>
      {status === 'error' && (
        <span role="alert" data-testid="save-error" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </div>
  )
}
