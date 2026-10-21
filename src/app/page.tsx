import Link from 'next/link'
import { Plus } from 'lucide-react'
import { LibraryClient } from '@/components/library/LibraryClient'

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col bg-[var(--bg-base)] text-white">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center bg-[#0d9488] px-4 shadow-md">
        <h1 className="text-lg font-bold tracking-tight">Plays</h1>
      </header>

      <div className="flex-1 p-3 pb-24">
        <LibraryClient />
      </div>

      <div className="pointer-events-none fixed bottom-0 left-1/2 z-20 flex w-full max-w-[390px] -translate-x-1/2 justify-end p-4">
        <Link
          href="/new"
          aria-label="+ New Play"
          className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-[var(--app-accent)] px-5 py-3 text-sm font-semibold text-[#0f172a] shadow-lg transition-colors hover:bg-[var(--accent-hover)]"
        >
          <Plus className="size-4" aria-hidden /> New Play
        </Link>
      </div>
    </main>
  )
}
