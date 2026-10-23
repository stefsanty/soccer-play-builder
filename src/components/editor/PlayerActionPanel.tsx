'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowDownLeft, MoveUpRight, Square, Wrench, X, Zap, Plus } from 'lucide-react'
import type { ActionItem } from '@/lib/engine/actions'
import { autoFixConflicts, detectConflicts } from '@/lib/engine/actions'

// ─── Chip styles per action type ─────────────────────────────────────────────

const CHIP_STYLE: Record<ActionItem['type'], string> = {
  pass:    'border-[#f59e0b]/50 bg-[#78350f]/70 text-[#fde68a]',
  receive: 'border-[#3b82f6]/50 bg-[#1e3a8a]/70 text-[#93c5fd]',
  run:     'border-[#22c55e]/50 bg-[#14532d]/70 text-[#86efac]',
  hold:    'border-[#475569]/50 bg-[#1e293b]/70 text-[#94a3b8]',
}

const CHIP_ICON: Record<ActionItem['type'], typeof MoveUpRight> = {
  pass:    MoveUpRight,
  receive: ArrowDownLeft,
  run:     Zap,
  hold:    Square,
}

function actionLabel(action: ActionItem, labelOf: (id: string) => string): string {
  switch (action.type) {
    case 'pass':    return `Pass → ${labelOf(action.to)}`
    case 'receive': return `From ${labelOf(action.from)}`
    case 'run':     return 'Run ↗'
    case 'hold':    return 'Hold'
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PlayerActionPanelProps {
  playerLabel: string
  actions: ActionItem[]
  labelOf: (id: string) => string
  onAddPass: () => void
  onAddRun: () => void
  onAddHold: () => void
  onRemoveAction: (actionId: string) => void
  onAutoFix: (fixed: ActionItem[]) => void
  onClose: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export const PANEL_HEIGHT = 152 // px — same role as STEP_PANEL_HEIGHT

export function PlayerActionPanel({
  playerLabel,
  actions,
  labelOf,
  onAddPass,
  onAddRun,
  onAddHold,
  onRemoveAction,
  onAutoFix,
  onClose,
}: PlayerActionPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const conflicts = detectConflicts(actions)

  const PICKER = [
    { label: 'Pass to player', Icon: MoveUpRight, color: 'text-[#fde68a]', onSelect: onAddPass },
    { label: 'Run to area',    Icon: Zap,          color: 'text-[#86efac]', onSelect: onAddRun  },
    { label: 'Hold position',  Icon: Square,       color: 'text-[#94a3b8]', onSelect: onAddHold },
  ]

  return (
    <section
      data-testid="player-action-panel"
      aria-label={`${playerLabel} actions`}
      className="flex shrink-0 flex-col border-t border-[var(--app-line)] bg-[var(--bg-base)]"
      style={{ height: PANEL_HEIGHT }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
        <span className="min-w-0 flex-1 text-[15px] font-bold leading-tight text-[#e8edf2]">
          {playerLabel}
        </span>
        <button
          type="button"
          aria-label="Close player panel"
          data-testid="panel-close"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 touch-manipulation items-center justify-center rounded-full text-[var(--app-muted)] hover:bg-white/10 active:scale-95"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* Action chips + Add button */}
      <div className="flex min-h-0 flex-1 items-center gap-2 overflow-x-auto px-3 pb-2">
        {actions.map((action) => {
          const Icon = CHIP_ICON[action.type]
          return (
            <div
              key={action.id}
              data-testid={`action-chip-${action.id}`}
              className={`flex shrink-0 select-none items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${CHIP_STYLE[action.type]}`}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{actionLabel(action, labelOf)}</span>
              <button
                type="button"
                aria-label={`Remove ${action.type}`}
                data-testid={`remove-${action.id}`}
                onClick={() => onRemoveAction(action.id)}
                className="ml-1 flex h-4 w-4 shrink-0 touch-manipulation items-center justify-center rounded-full opacity-60 hover:opacity-100 active:scale-95"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          )
        })}

        {/* Add action button */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Add action"
            aria-expanded={pickerOpen}
            data-testid="add-action-btn"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex h-9 touch-manipulation items-center gap-1.5 rounded-lg border border-[var(--app-line)] bg-white/5 px-3 text-[12px] font-semibold text-[var(--app-muted)] hover:bg-white/10 active:scale-95"
          >
            <Plus className="size-3.5" aria-hidden />
            Add
          </button>

          {pickerOpen && (
            <>
              {/* Dismiss layer */}
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
              {/* Picker popover */}
              <div
                data-testid="action-picker"
                className="absolute bottom-full left-0 z-20 mb-2 w-52 overflow-hidden rounded-xl border border-[var(--app-line)] bg-[var(--app-card)] shadow-2xl"
              >
                {PICKER.map(({ label, Icon, color, onSelect }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { onSelect(); setPickerOpen(false) }}
                    className="flex w-full touch-manipulation items-center gap-3 px-4 py-3 text-[13px] font-medium text-[#e8edf2] hover:bg-white/10 active:bg-white/15"
                  >
                    <Icon className={`size-4 shrink-0 ${color}`} aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {/* Conflict strip */}
      {conflicts.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[#7f1d1d]/60 bg-[#450a0a]/60 px-3 py-1.5">
          <AlertTriangle className="size-3.5 shrink-0 text-[#f87171]" aria-hidden />
          <span className="min-w-0 flex-1 text-[11px] text-[#fca5a5]">
            {conflicts[0].description}
            {conflicts.length > 1 && ` (+${conflicts.length - 1} more)`}
          </span>
          <button
            type="button"
            data-testid="auto-fix-btn"
            onClick={() => onAutoFix(autoFixConflicts(actions))}
            className="flex shrink-0 touch-manipulation items-center gap-1 rounded-full bg-[#7f1d1d]/80 px-2.5 py-1 text-[11px] font-semibold text-[#fca5a5] hover:bg-[#991b1b] active:scale-95"
          >
            <Wrench className="size-3 shrink-0" aria-hidden />
            Auto-fix
          </button>
        </div>
      )}
    </section>
  )
}
