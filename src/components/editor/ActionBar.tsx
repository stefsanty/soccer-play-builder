'use client'

import { Move, MoveUpRight, Zap } from 'lucide-react'
import type { EditorMode } from '@/lib/store/editorStore'
import { STRIP_HEIGHT } from './StepTextPanel'

const MODES: { mode: EditorMode; label: string; Icon: typeof Move }[] = [
  { mode: 'select', label: 'Move', Icon: Move },
  { mode: 'pass', label: 'Pass', Icon: MoveUpRight },
  { mode: 'run', label: 'Run', Icon: Zap },
]

interface ActionBarProps {
  mode: EditorMode
  isSetupStep: boolean
  onChangeMode: (mode: EditorMode) => void
}

export function ActionBar({ mode, isSetupStep, onChangeMode }: ActionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Action toolbar"
      data-testid="action-bar"
      className="flex shrink-0 items-center justify-end gap-1 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3"
      style={{ height: STRIP_HEIGHT }}
    >
      {MODES.map(({ mode: m, label, Icon }) => {
        const disabled = isSetupStep && (m === 'pass' || m === 'run')
        return (
          <button
            key={m}
            type="button"
            aria-label={label}
            aria-pressed={mode === m}
            data-testid={`mode-${m}`}
            disabled={disabled}
            onClick={() => { if (!disabled) onChangeMode(m) }}
            className={`flex h-10 touch-manipulation select-none flex-col items-center justify-center gap-0.5 rounded-[10px] px-5 text-[10px] font-medium transition-all duration-100 active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
              mode === m
                ? 'bg-[#14b8a6] text-[#0f172a]'
                : 'text-[#cbd5e1] hover:bg-white/5 active:bg-white/15'
            }`}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        )
      })}
    </div>
  )
}
