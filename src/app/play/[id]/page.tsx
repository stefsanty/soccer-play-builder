import { createClient } from '@/lib/supabase/server'
import { rowToPlay, type PlayRow } from '@/lib/api/playMapping'
import { PlayViewer } from '@/components/viewer/PlayViewer'

interface PlayViewerPageProps {
  params: Promise<{ id: string }>
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] p-6 text-center text-slate-400">
      <p>{children}</p>
    </main>
  )
}

// Public play viewer — no auth required.
export default async function PlayViewerPage({ params }: PlayViewerPageProps) {
  const { id } = await params
  const supabase = await createClient()
  if (!supabase) return <Message>Database not configured.</Message>

  const { data } = await supabase.from('plays').select('*').eq('id', id).maybeSingle()
  if (!data) return <Message>Play not found.</Message>

  return <PlayViewer play={rowToPlay(data as PlayRow)} />
}
