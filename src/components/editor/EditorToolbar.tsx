'use client'

// Mode switcher: select / move / pass / run / preview.

import { useEditorStore, type EditorMode } from '@/lib/store/editorStore'
import { Button } from '@/components/ui/button'

const MODES: { mode: EditorMode; label: string }[] = [
  { mode: 'select', label: 'Select' },
  { mode: 'move', label: 'Move' },
  { mode: 'pass', label: 'Pass' },
  { mode: 'run', label: 'Run' },
  { mode: 'preview', label: 'Preview' },
]

export function EditorToolbar() {
  const mode = useEditorStore((s) => s.mode)
  const setMode = useEditorStore((s) => s.setMode)

  return (
    <div className="flex gap-1 p-2">
      {MODES.map((m) => (
        <Button
          key={m.mode}
          variant={mode === m.mode ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setMode(m.mode)}
        >
          {m.label}
        </Button>
      ))}
    </div>
  )
}
