import type { Play } from '@/lib/types/play'

/**
 * Who holds the ball. Convention shared with computeFrame: the ball starts with the first passer
 * anywhere in the play, then belongs to the last receiver of each step's passes.
 */
export function initialBallHolder(play: Play): string | null {
  for (const s of play.steps) {
    if (s.passes.length > 0) return s.passes[0].from
  }
  return null
}

/** Holder at the start of `stepIndex` (before that step's passes). */
export function ballHolderBefore(play: Play, stepIndex: number): string | null {
  let holder = initialBallHolder(play)
  const end = Math.min(stepIndex, play.steps.length)
  for (let i = 0; i < end; i++) {
    const last = play.steps[i].passes.at(-1)
    if (last) holder = last.to
  }
  return holder
}

/** Holder once `stepIndex`'s passes have completed (what the editor shows: end-of-step positions). */
export function ballHolderAfter(play: Play, stepIndex: number): string | null {
  return ballHolderBefore(play, stepIndex + 1)
}
