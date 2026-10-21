import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-5xl font-bold">Soccer Play Builder</h1>
      <p className="text-slate-400 text-xl text-center max-w-md">
        Create, animate, and share tactical patterns of play for soccer.
      </p>
      <div className="flex gap-4">
        <Link href="/editor" className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-lg font-semibold transition-colors">
          Open Editor
        </Link>
        <Link href="/library" className="border border-slate-600 hover:border-slate-400 px-6 py-3 rounded-lg font-semibold transition-colors">
          Browse Plays
        </Link>
      </div>
    </main>
  )
}
