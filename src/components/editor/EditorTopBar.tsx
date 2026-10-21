'use client'

// Edit-mode top bar: back arrow, play title, Save.

import Link from 'next/link'
import { useEditorStore } from '@/lib/store/editorStore'
import { SaveButton } from '@/components/editor/SaveButton'

export function EditorTopBar() {
  const title = useEditorStore((s) => s.play?.title)
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-800 bg-[var(--app-bg)] px-3 py-3">
      <Link href="/" aria-label="Back to plays" className="px-1 text-xl leading-none text-slate-300 hover:text-white">
        ←
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold" data-testid="play-title">
        {title || 'New play'}
      </h1>
      <SaveButton />
    </header>
  )
}
