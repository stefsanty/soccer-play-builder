import { PitchEditor } from '@/components/editor/PitchEditor'
import { StepSequencer } from '@/components/editor/StepSequencer'
import { NarrativePanel } from '@/components/editor/NarrativePanel'
import { SaveButton } from '@/components/editor/SaveButton'
import { DbBanner } from '@/components/layout/DbBanner'

export default function EditorPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-4 lg:flex-row">
        <main className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 empty:hidden">
            <DbBanner />
            <div className="ml-auto">
              <SaveButton />
            </div>
          </div>
          <PitchEditor />
          <div className="mt-2">
            <StepSequencer />
          </div>
        </main>
        <aside className="w-full shrink-0 rounded-lg border border-slate-800 p-2 lg:w-80">
          <h2 className="px-2 pt-1 text-sm font-semibold text-slate-300">Step narrative</h2>
          <NarrativePanel />
        </aside>
      </div>
    </div>
  )
}
