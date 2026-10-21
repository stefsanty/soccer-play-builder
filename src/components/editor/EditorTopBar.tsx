'use client'

// Edit-mode top bar: back chevron, editable play title (centered), Save.

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useEditorStore } from '@/lib/store/editorStore'
import { SaveButton } from '@/components/editor/SaveButton'

export function EditorTopBar() {
  const play = useEditorStore((s) => s.play)
  const setPlay = useEditorStore((s) => s.setPlay)
  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center gap-2 bg-[var(--bg-card)] px-2 text-white">
      <Link href="/" aria-label="Back to plays" className="flex size-10 items-center justify-center rounded-full text-slate-300 hover:text-white">
        <ChevronLeft className="size-6" aria-hidden />
      </Link>
      <input
        data-testid="play-title"
        aria-label="Play title"
        value={play?.title ?? ''}
        placeholder="New play"
        disabled={!play}
        onChange={(e) => play && setPlay({ ...play, title: e.target.value })}
        className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-center text-base font-semibold text-white outline-none placeholder:text-slate-500 focus:bg-slate-700/50"
      />
      <SaveButton />
    </header>
  )
}
