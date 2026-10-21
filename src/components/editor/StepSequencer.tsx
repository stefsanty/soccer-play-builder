'use client'

// Timeline of steps: add / remove / reorder, select current step.

import { useEditorStore } from '@/lib/store/editorStore'
import { Button } from '@/components/ui/button'

export function StepSequencer() {
  const play = useEditorStore((s) => s.play)
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex)
  const setCurrentStep = useEditorStore((s) => s.setCurrentStep)
  const addStep = useEditorStore((s) => s.addStep)
  const removeStep = useEditorStore((s) => s.removeStep)

  return (
    <div className="flex items-center gap-2 overflow-x-auto p-2">
      {play?.steps.map((step, i) => (
        <Button
          key={step.id}
          variant={i === currentStepIndex ? 'default' : 'secondary'}
          size="sm"
          onClick={() => setCurrentStep(i)}
          onDoubleClick={() => removeStep(i)}
        >
          {step.title}
        </Button>
      ))}
      <Button variant="outline" size="sm" onClick={addStep}>
        + Step
      </Button>
    </div>
  )
}
