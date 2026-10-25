// Derived step facts. A step's duration is no longer authored: the step lasts exactly as long
// as its actions do ("time only advances when someone acts"). Legacy steps that authored an
// explicit duration keep it, so existing plays simulate unchanged.

import type { PlayStep } from '@/lib/types/play'

/** Breathing room after the last action, so the animation doesn't cut on the landing frame. */
export const SETTLE_MARGIN = 0.5 // s

/**
 * How long a step runs, in seconds.
 *   - authored `duration > 0` (legacy steps): wins unchanged
 *   - otherwise: until the last pass or move ends, plus a settle margin
 *   - a step with no actions is instantaneous (0) — the setup step, or an empty new step
 */
export function stepDuration(step: PlayStep): number {
  if (step.duration > 0) return step.duration
  const last = Math.max(
    0,
    ...step.passes.map((p) => p.endTime),
    ...step.moves.map((m) => m.endTime),
  )
  return last > 0 ? last + SETTLE_MARGIN : 0
}

/**
 * What the step IS, as a marker label: the ball's path for a pass step ("GK → RCB"; a legacy
 * multi-pass step summarises first passer to last receiver), "Reposition" for pure movement,
 * "Hold" when every move is a hidden stay-put, and '' when there is nothing to say (empty
 * steps, and the setup step, which callers label themselves).
 */
export function narrate(step: PlayStep, labelOf: (id: string) => string): string {
  if (step.passes.length > 0) {
    const first = step.passes[0]
    const last = step.passes[step.passes.length - 1]
    return `${labelOf(first.from)} → ${labelOf(last.to)}`
  }
  if (step.moves.length === 0) return ''
  return step.moves.some((m) => !m.hidden) ? 'Reposition' : 'Hold'
}
