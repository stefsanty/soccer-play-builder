import { LibraryClient } from '@/components/library/LibraryClient'
import { DbBanner } from '@/components/layout/DbBanner'

export default function LibraryPage() {
  return (
    <main className="min-h-screen bg-[var(--app-bg)] text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Play Library</h1>
      <div className="mb-6 empty:hidden">
        <DbBanner />
      </div>
      <LibraryClient />
    </main>
  )
}
