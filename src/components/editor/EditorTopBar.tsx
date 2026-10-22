'use client'

// Edit-mode top bar: back, editable play title, undo/redo (placeholders), share, done (save).

import Link from 'next/link'
import { ChevronLeft, Share } from 'lucide-react'
import { useEditorStore } from '@/lib/store/editorStore'
import { SaveButton } from '@/components/editor/SaveButton'

const iconBtn = 'flex h-11 w-10 touch-manipulation items-center justify-center border-0 bg-transparent transition-transform duration-100 active:scale-90 disabled:active:scale-100'

export function EditorTopBar() {
  const play = useEditorStore((s) => s.play)
  const setPlay = useEditorStore((s) => s.setPlay)
  const canShare = !!play && play.id !== 'draft'

  async function share() {
    if (!play) return
    const url = `${window.location.origin}/play/${play.id}`
    try {
      if (navigator.share) await navigator.share({ title: play.title, url })
      else await navigator.clipboard.writeText(url)
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <header className="relative z-10 flex h-11 shrink-0 items-center gap-0.5 border-b border-[var(--app-line)] bg-[var(--bg-base)] px-2 text-[#e8edf2]">
      <Link href="/" aria-label="Back" className="flex size-11 touch-manipulation items-center justify-center text-[var(--app-accent)] transition-transform duration-100 active:scale-90">
        <ChevronLeft className="size-[26px]" strokeWidth={2.4} aria-hidden />
      </Link>
      <input
        data-testid="play-title"
        aria-label="Play title"
        value={play?.title ?? ''}
        placeholder="New play"
        disabled={!play}
        onChange={(e) => play && setPlay({ ...play, title: e.target.value })}
        className="min-w-0 flex-1 truncate rounded-md bg-transparent px-0.5 text-base font-semibold leading-tight text-[#e8edf2] outline-none placeholder:text-slate-500 focus:bg-white/5"
      />
      <button
        type="button"
        aria-label="Share"
        disabled={!canShare}
        onClick={share}
        className={`${iconBtn} ${canShare ? 'text-[#e8edf2]' : 'text-[#5d6b7a]'}`}
      >
        <Share className="size-[22px]" aria-hidden />
      </button>
      <SaveButton />
    </header>
  )
}
