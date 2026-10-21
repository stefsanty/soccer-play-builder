import { PitchEditor } from '@/components/editor/PitchEditor'
import { StepSequencer } from '@/components/editor/StepSequencer'
import { NarrativePanel } from '@/components/editor/NarrativePanel'
import { EditorTopBar } from '@/components/editor/EditorTopBar'
import { DbBanner } from '@/components/layout/DbBanner'

export default function EditorPage() {
  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-white">
      <EditorTopBar />
      <main className="flex flex-col gap-3 p-3">
        <DbBanner />
        <PitchEditor />
        <StepSequencer />
        <section className="rounded-lg bg-[#1e293b] p-2">
          <h2 className="px-2 pt-1 text-sm font-semibold text-slate-300">Step narrative</h2>
          <NarrativePanel />
        </section>
      </main>
    </div>
  )
}
