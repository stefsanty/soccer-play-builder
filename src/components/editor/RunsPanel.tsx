'use client'

// Edit-mode list of the current step's runs. Each row has an eye toggle that hides/shows that run's
// arrow on the pitch (stored as `hidden: true` on the move); the move itself is unaffected.

import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, Route } from 'lucide-react'
import type { PlayerMove } from '@/lib/types/play'

interface RunsPanelProps {
  /** Pills shown on the same row as the Runs button (e.g. the ball chip). */
  lead?: ReactNode
  moves: PlayerMove[]
  labelOf: (playerId: string) => string
  onToggle: (playerId: string) => void
  onSetAll: (hidden: boolean) => void
}

const pill =
  'pointer-events-auto touch-manipulation select-none rounded-full border border-white/10 bg-[rgba(11,16,21,0.88)] text-xs font-semibold text-[#e8edf2] shadow-lg backdrop-blur-md transition-transform duration-100 active:scale-95'

export function RunsPanel({ lead, moves, labelOf, onToggle, onSetAll }: RunsPanelProps) {
  const [open, setOpen] = useState(false)
  const hidden = moves.filter((m) => m.hidden).length
  const allHidden = hidden === moves.length

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex items-center gap-2">
      {lead}
      {moves.length > 0 && (
      <button
        type="button"
        data-testid="runs-toggle"
        aria-expanded={open}
        aria-controls="runs-panel"
        onClick={() => setOpen((o) => !o)}
        className={`${pill} inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1`}
      >
        <Route className="size-3.5 text-[#ffd43b]" aria-hidden />
        Runs · {moves.length}
        {hidden > 0 && <span className="text-[var(--app-muted)]">({hidden} hidden)</span>}
      </button>
      )}
      </div>

      {open && moves.length > 0 && (
        <div
          id="runs-panel"
          data-testid="runs-panel"
          className="pointer-events-auto w-full max-h-[40vh] overflow-y-auto rounded-2xl border border-white/10 bg-[rgba(11,16,21,0.94)] p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="flex items-center justify-between px-2 pb-1 text-xs font-semibold text-[var(--app-muted)]">
            <span>Run arrows</span>
            <button
              type="button"
              data-testid="runs-toggle-all"
              onClick={() => onSetAll(!allHidden)}
              className="touch-manipulation rounded-md px-2 py-0.5 text-[var(--app-accent)] transition-transform duration-100 hover:bg-white/10 active:scale-95"
            >
              {allHidden ? 'Show all' : 'Hide all'}
            </button>
          </div>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {moves.map((m) => (
              <li key={m.playerId}>
                <button
                  type="button"
                  data-testid={`run-toggle-${m.playerId}`}
                  aria-pressed={!m.hidden}
                  aria-label={`${m.hidden ? 'Show' : 'Hide'} run arrow for ${labelOf(m.playerId)}`}
                  onClick={() => onToggle(m.playerId)}
                  className="flex h-10 w-full touch-manipulation select-none items-center gap-3 rounded-xl px-2.5 text-left text-sm transition-all duration-100 hover:bg-white/5 active:scale-[0.98] active:bg-white/10"
                >
                  {m.hidden ? <EyeOff className="size-[18px] text-[var(--app-muted)]" aria-hidden /> : <Eye className="size-[18px] text-[#ffd43b]" aria-hidden />}
                  <span className={`font-semibold ${m.hidden ? 'text-[var(--app-muted)] line-through' : 'text-[#e8edf2]'}`}>{labelOf(m.playerId)}</span>
                  <span className="ml-auto text-xs tabular-nums text-[var(--app-muted)]">
                    to {m.toX.toFixed(0)}, {m.toY.toFixed(0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
