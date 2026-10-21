'use client'

// Saves the editor's current play: POST on first save, PUT afterwards.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/lib/store/editorStore'
import { createPlay, updatePlay } from '@/lib/api/plays'
import type { PlayInsert } from '@/lib/types/play'
import { isSupabaseConfigured } from '@/lib/supabase/config'

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function SaveButton() {
  const play = useEditorStore((s) => s.play)
  const markSaved = useEditorStore((s) => s.markSaved)
  const [status, setStatus] = useState<Status>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!isSupabaseConfigured()) {
    return (
      <Button size="sm" variant="outline" disabled data-testid="save-button">
        Save (no DB)
      </Button>
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
