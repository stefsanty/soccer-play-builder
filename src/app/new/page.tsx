'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
    <main className="flex min-h-screen flex-col bg-[var(--app-bg)] text-white">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-4">
        <Link href="/" aria-label="Back to plays" className="text-slate-400 hover:text-white">
          ←
        </Link>
        <h1 className="text-xl font-bold">New Play</h1>
      </header>

      <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 p-4">
        <label htmlFor="play-title" className="text-sm font-medium text-slate-300">
          Play title
        </label>
        <input
          id="play-title"
          data-testid="play-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="rounded-xl border border-slate-700 bg-[var(--app-card)] px-4 py-3 text-white outline-none focus:border-[#14b8a6] focus:ring-2 focus:ring-[#14b8a6]/40"
        />
        {error && (
          <p role="alert" data-testid="new-play-error" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-xl bg-[#14b8a6] px-5 py-3 text-sm font-semibold text-[#0f172a] transition-colors hover:bg-[#2dd4bf] disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create Play'}
        </button>
      </form>
    </main>
  )
}
