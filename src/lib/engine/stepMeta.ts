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
