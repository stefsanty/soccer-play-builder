interface EditPlayPageProps {
  params: Promise<{ id: string }>
}

export default async function EditPlayPage({ params }: EditPlayPageProps) {
  const { id } = await params
  return (
    <div className="h-screen bg-slate-950 text-white flex items-center justify-center">
      <p className="text-slate-500">
        Editing play <span className="font-mono text-slate-300">{id}</span> — editor coming soon…
      </p>
    </div>
  )
}
