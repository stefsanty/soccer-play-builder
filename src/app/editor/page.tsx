export default function EditorPage() {
  return (
    <div className="h-screen bg-slate-950 text-white flex">
      <aside className="w-80 border-r border-slate-800 p-4">
        <h2 className="text-lg font-semibold mb-4">Editor</h2>
        <p className="text-slate-400 text-sm">Pitch editor coming soon…</p>
      </aside>
      <main className="flex-1 flex items-center justify-center">
        <p className="text-slate-500">SVG pitch canvas goes here</p>
      </main>
    </div>
  )
}
