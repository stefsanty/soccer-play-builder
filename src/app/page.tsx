import Link from 'next/link'
import { LibraryClient } from '@/components/library/LibraryClient'
import { DbBanner } from '@/components/layout/DbBanner'

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-[var(--app-bg)] text-white">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-[var(--app-bg)] px-4 py-4">
        <h1 className="text-xl font-bold">Soccer Play Builder</h1>
        <p className="text-xs text-slate-400">Your plays</p>
      </header>

      <div className="flex-1 space-y-3 p-4 pb-28">
        <DbBanner />
        <LibraryClient />
      </div>

      <div className="pointer-events-none fixed bottom-0 left-1/2 z-20 flex w-full max-w-[390px] -translate-x-1/2 justify-end p-4">
        <Link
          href="/new"
          className="pointer-events-auto rounded-full bg-[#14b8a6] px-5 py-3 text-sm font-semibold text-[#0f172a] shadow-lg transition-colors hover:bg-[#2dd4bf]"
        >
          + New Play
        </Link>
      </div>
    </main>
  )
}
