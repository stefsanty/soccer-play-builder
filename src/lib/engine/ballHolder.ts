import type { Play } from '@/lib/types/play'

/**
 * Step graph. Main steps run in order; an alternative-branch step (`isAltBranch`) does not follow the
 * step before it in the list: it starts from the state at the END of main step `altFrom`.
 */

const isAlt = (play: Play, i: number) => !!play.steps[i]?.isAltBranch

/** The step whose end state `stepIndex` starts from, or -1 for the first step. */
export function baseStepIndex(play: Play, stepIndex: number): number {
  const step = play.steps[stepIndex]
  if (!step) return -1
  if (step.isAltBranch && step.altFrom !== undefined && step.altFrom >= 0 && step.altFrom < stepIndex) return step.altFrom
  let j = stepIndex - 1
  while (j >= 0 && isAlt(play, j)) j--
  return j
}

/** Step indices from the start of the play to `stepIndex`, following the base chain. */
export function stepChain(play: Play, stepIndex: number): number[] {
  const chain: number[] = []
  for (let i = stepIndex; i >= 0; i = baseStepIndex(play, i)) chain.unshift(i)
  return chain
}

/** Step to go to from `stepIndex` with Next (+1) or Prev (-1); branches are only entered directly. */
export function neighbourStep(play: Play, stepIndex: number, dir: 1 | -1): number | null {
  const step = play.steps[stepIndex]
  if (!step) return null
  let j: number
  if (dir === 1) {
    j = (step.isAltBranch ? (step.altAfter ?? step.altFrom ?? stepIndex) : stepIndex) + 1
    while (j < play.steps.length && isAlt(play, j)) j++
    return j < play.steps.length ? j : null
  }
  j = step.isAltBranch ? (step.altFrom ?? stepIndex - 1) : stepIndex - 1
  while (j >= 0 && isAlt(play, j)) j--
  return j >= 0 && j !== stepIndex ? j : null
}

/**
 * Who holds the ball. Convention shared with the engine: the ball starts with the first passer
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
  const base = baseStepIndex(play, Math.min(stepIndex, play.steps.length))
  return base < 0 ? initialBallHolder(play) : ballHolderAfter(play, base)
}

/** Holder once `stepIndex`'s passes have completed (what the editor shows: end-of-step positions). */
export function ballHolderAfter(play: Play, stepIndex: number): string | null {
  const last = play.steps[stepIndex]?.passes.at(-1)
  return last ? last.to : ballHolderBefore(play, stepIndex)
}
