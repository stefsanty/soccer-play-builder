import { createClient } from '@/lib/supabase/server'
import { rowToPlay, type PlayRow } from '@/lib/api/playMapping'
import { EditorShell } from '@/components/editor/EditorShell'

interface EditPlayPageProps {
  params: Promise<{ id: string }>
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-[var(--app-bg)] p-6 text-center text-[var(--app-muted)]">
      <p data-testid="editor-message">{children}</p>
    </main>
  )
}

// Loads the play on the server, then hands it to the client editor.
export default async function EditPlayPage({ params }: EditPlayPageProps) {
  const { id } = await params
  const supabase = await createClient()
  if (!supabase) return <Message>Database not configured.</Message>

  const { data } = await supabase.from('plays').select('*').eq('id', id).maybeSingle()
  if (!data) return <Message>Play not found.</Message>

  return <EditorShell play={rowToPlay(data as PlayRow)} />
}
