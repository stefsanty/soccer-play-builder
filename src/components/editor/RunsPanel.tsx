'use client'

// Edit-mode runs: the bar under the step strip (toggle + hide/show all) and the list that opens in the step text
// panel. Each row has an eye toggle that hides/shows that run's arrow on the pitch (stored as `hidden: true` on the
// move); the move itself is unaffected.

import { Eye, EyeOff, Play, Route, SlidersHorizontal } from 'lucide-react'
import type { PlayerMove } from '@/lib/types/play'

export const BAR_HEIGHT = 84 // px: Edit's runs bar and Play's playback bar are the same height, so the pitch never resizes

const btn =
  'flex h-11 touch-manipulation select-none items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium transition-all duration-100 active:scale-95 disabled:opacity-40 disabled:active:scale-100'

interface RunsBarProps {
  moves: PlayerMove[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSetAll: (hidden: boolean) => void
  onBehavior: () => void
  onSwitchToPlay?: () => void
  /** When true, this is step 0 (setup): no runs or passes — show setup hint instead. */
  isSetupStep?: boolean
}

export function RunsBar({ moves, open, onOpenChange, onSetAll, onBehavior, onSwitchToPlay, isSetupStep }: RunsBarProps) {
  const hidden = moves.filter((m) => m.hidden).length
  const allHidden = moves.length > 0 && hidden === moves.length
  const playButton = onSwitchToPlay ? (
    <button
      type="button"
      data-testid="switch-to-play"
      aria-label="Switch to Play mode"
      onClick={onSwitchToPlay}
      className={`${btn} shrink-0 bg-[var(--app-accent)] px-3 text-[var(--app-accent-ink)]`}
    >
      <Play className="size-[18px]" aria-hidden />
      <span>Play</span>
    </button>
  ) : null
  const behaviorButton = (
    <button
      type="button"
      data-testid="behavior-open"
      aria-label="Behavior"
      onClick={onBehavior}
      className={`${btn} shrink-0 bg-[var(--app-card)] px-3 text-[#e8edf2] hover:bg-white/5`}
    >
      <SlidersHorizontal className="size-[18px]" aria-hidden />
      {/* icon-only on narrow phones: the full row (runs, hide, behavior, play) does not fit 390px with labels */}
      <span className="hidden min-[430px]:inline">Behavior</span>
    </button>
  )
  return (
    <div
      data-testid="edit-bar"
      role="group"
      aria-label="Run arrows"
      className="flex shrink-0 flex-col justify-center gap-1 border-t border-[var(--app-line)] bg-[var(--bg-toolbar)] px-3"
      style={{ height: BAR_HEIGHT }}
    >
      {isSetupStep ? (
        <div className="flex items-center gap-2">
          <p className="m-0 min-w-0 flex-1 text-xs leading-snug text-[var(--app-muted)]">
            Setup step — drag players to set starting positions.
          </p>
          {playButton}
        </div>
      ) : moves.length === 0 ? (
        <div className="flex items-center gap-2">
          <p className="m-0 min-w-0 flex-1 text-xs leading-snug text-[var(--app-muted)]">
            No runs in this step. Tap a player, choose Run, then tap the pitch.
          </p>
          {playButton}
          {behaviorButton}
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            data-testid="runs-toggle"
            aria-expanded={open}
            aria-controls="runs-panel"
            onClick={() => onOpenChange(!open)}
            className={`${btn} min-w-0 flex-1 ${open ? 'bg-[#14b8a6] text-[#0f172a]' : 'bg-[var(--app-card)] text-[#e8edf2] hover:bg-white/5'}`}
          >
            <Route className="size-[18px] shrink-0" aria-hidden />
            <span className="truncate">
              Runs · {moves.length}
              {hidden > 0 && <span className="ml-1 opacity-70">({hidden} hidden)</span>}
            </span>
          </button>
          <button
            type="button"
            data-testid="runs-toggle-all"
            aria-label={allHidden ? 'Show all run arrows' : 'Hide all run arrows'}
            onClick={() => onSetAll(!allHidden)}
            className={`${btn} shrink-0 bg-[var(--app-card)] px-3 text-[var(--app-accent)] hover:bg-white/5`}
          >
            {allHidden ? <Eye className="size-[18px]" aria-hidden /> : <EyeOff className="size-[18px]" aria-hidden />}
            <span className="hidden min-[430px]:inline">{allHidden ? 'Show all' : 'Hide all'}</span>
          </button>
          {behaviorButton}
          {playButton}
        </div>
      )}
    </div>
  )
}

interface RunsListProps {
  moves: PlayerMove[]
  labelOf: (playerId: string) => string
  onToggle: (playerId: string) => void
}

/** The run list, shown inside the step text panel while the Runs toggle is open. */
export function RunsList({ moves, labelOf, onToggle }: RunsListProps) {
  return (
    <ul id="runs-panel" data-testid="runs-panel" className="m-0 grid list-none grid-cols-2 gap-x-1 gap-y-0.5 p-0">
      {moves.map((m) => (
        <li key={m.playerId}>
          <button
            type="button"
            data-testid={`run-toggle-${m.playerId}`}
            aria-pressed={!m.hidden}
            aria-label={`${m.hidden ? 'Show' : 'Hide'} run arrow for ${labelOf(m.playerId)}`}
            onClick={() => onToggle(m.playerId)}
            className="flex h-9 w-full touch-manipulation select-none items-center gap-2 rounded-lg px-2 text-left text-sm transition-all duration-100 hover:bg-white/5 active:scale-[0.97] active:bg-white/10"
          >
            {m.hidden ? <EyeOff className="size-4 shrink-0 text-[var(--app-muted)]" aria-hidden /> : <Eye className="size-4 shrink-0 text-[#ffd43b]" aria-hidden />}
            <span className={`font-semibold ${m.hidden ? 'text-[var(--app-muted)] line-through' : 'text-[#e8edf2]'}`}>{labelOf(m.playerId)}</span>
            <span className="ml-auto text-[11px] tabular-nums text-[var(--app-muted)]">
              {m.toX.toFixed(0)}, {m.toY.toFixed(0)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
