import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { rowToPlay, type PlayRow } from '@/lib/api/playMapping'
import { BuilderClient } from '@/components/builder/BuilderClient'

interface BuilderPlayPageProps {
  params: Promise<{ id: string }>
}

export const metadata: Metadata = {
  title: 'Turn Builder — Soccer Play Builder',
  description: 'Reopen a saved Turn Builder game: rewind its turns, replan from any action, play on.',
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] p-6 text-center text-[var(--app-muted)]">
      <p data-testid="builder-message">{children}</p>
    </main>
  )
}

// Loads a saved game on the server and hands it to the Turn Builder, which rebuilds its history.
export default async function BuilderPlayPage({ params }: BuilderPlayPageProps) {
  const { id } = await params
  const supabase = await createClient()
  if (!supabase) return <Message>Database not configured.</Message>

  const { data } = await supabase.from('plays').select('*').eq('id', id).maybeSingle()
  if (!data) return <Message>Play not found.</Message>

  return <BuilderClient initialPlay={rowToPlay(data as PlayRow)} />
}
