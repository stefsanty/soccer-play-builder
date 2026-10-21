interface PlayViewerPageProps {
  params: Promise<{ id: string }>
}

// Public play viewer — no auth required.
export default async function PlayViewerPage({ params }: PlayViewerPageProps) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-[var(--app-bg)] text-white flex items-center justify-center">
      <p className="text-slate-500">
        Play <span className="font-mono text-slate-300">{id}</span> — animated viewer coming soon…
      </p>
    </main>
  )
}
