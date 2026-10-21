import { PlayGrid } from '@/components/library/PlayGrid'

export default function LibraryPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Play Library</h1>
      <PlayGrid plays={[]} />
    </main>
  )
}
