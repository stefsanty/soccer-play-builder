// Shows the current step's title and narrative bullets.

import type { PlayStep } from '@/lib/types/play'

interface StepNarrativeProps {
  step: PlayStep
}

export function StepNarrative({ step }: StepNarrativeProps) {
  return (
    <div className="p-4 space-y-3">
      <h3 className="font-semibold text-lg">{step.title}</h3>
      {step.narrativeOurs.length > 0 && (
        <ul className="list-disc list-inside text-sm text-blue-300 space-y-1">
          {step.narrativeOurs.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {step.narrativeOpp.length > 0 && (
        <ul className="list-disc list-inside text-sm text-red-300 space-y-1">
          {step.narrativeOpp.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
