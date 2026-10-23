// Shows the current step's title.

import type { PlayStep } from '@/lib/types/play'

interface StepNarrativeProps {
  step: PlayStep
}

export function StepNarrative({ step }: StepNarrativeProps) {
  return (
    <div className="p-4">
      <h3 className="font-semibold text-lg">{step.title}</h3>
    </div>
  )
}
