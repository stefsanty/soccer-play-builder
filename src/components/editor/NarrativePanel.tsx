'use client'

// Per-step title + narrative bullet text for both teams.

import { useEditorStore } from '@/lib/store/editorStore'

export function NarrativePanel() {
  const play = useEditorStore((s) => s.play)
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex)
  const updateStep = useEditorStore((s) => s.updateStep)

  const step = play?.steps[currentStepIndex]
  if (!step) return null

  return (
    <div className="space-y-3 p-2">
      <input
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
        value={step.title}
        onChange={(e) => updateStep(currentStepIndex, { title: e.target.value })}
        aria-label="Step title"
      />
      <textarea
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm h-24"
        value={step.narrativeOurs.join('\n')}
        onChange={(e) => updateStep(currentStepIndex, { narrativeOurs: e.target.value.split('\n') })}
        placeholder="Our team — one bullet per line"
        aria-label="Our team narrative"
      />
      <textarea
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm h-24"
        value={step.narrativeOpp.join('\n')}
        onChange={(e) => updateStep(currentStepIndex, { narrativeOpp: e.target.value.split('\n') })}
        placeholder="Opponent — one bullet per line"
        aria-label="Opponent narrative"
      />
    </div>
  )
}
