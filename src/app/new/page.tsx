'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createPlay } from '@/lib/api/plays'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'

export default function NewPlayPage() {
  const router = useRouter()
  const [title, setTitle] = useState('Untitled Play')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { id: _id, createdAt: _c, updatedAt: _u, ...draft } = createDefaultPlay()
      const play = await createPlay({ ...draft, title: title.trim() || 'Untitled Play' })
      router.push(`/editor/${play.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create play')
      setSubmitting(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col bg-[var(--bg-base)] text-[#e8edf2]">
      <header className="flex h-11 items-center gap-0.5 border-b border-[var(--app-line)] px-2">
        <Link href="/" aria-label="Back to plays" className="flex size-11 items-center justify-center text-[var(--app-accent)]">
          <ChevronLeft className="size-[26px]" strokeWidth={2.4} aria-hidden />
        </Link>
        <h1 className="m-0 text-base font-semibold">New play</h1>
      </header>

      <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 px-5 pt-6">
        <label htmlFor="play-title" className="text-sm font-medium text-[var(--app-muted)]">
          Play title
        </label>
        <input
          id="play-title"
          data-testid="play-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-card)] px-4 py-3 text-[#e8edf2] outline-none focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent)]/40"
        />
        {error && (
          <p role="alert" data-testid="new-play-error" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-2 h-[52px] rounded-[14px] bg-[var(--app-accent)] text-[17px] font-bold text-[var(--app-accent-ink)] transition-colors disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create play'}
        </button>
      </form>
    </main>
  )
}
