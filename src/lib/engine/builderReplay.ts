// Reopening a saved Turn Builder game: the play's steps are re-simulated in order, and the builder
// bookkeeping on each step (what was queued, what the dice decided, who ended up with the ball)
// rebuilds the per-action rewind history exactly as it was when the game was saved.

import type { Play } from '@/lib/types/play'
import { H, initialState, simulateStep, type SimState } from '@/lib/engine/simulator'
import { buildSnapshots, holderAfter, scheduleTurn, type TurnSnapshot } from '@/lib/engine/turnBuilder'
import { PITCH_H, PITCH_W } from '@/lib/engine/pitch'
import { detectGoal } from '@/lib/engine/goal'
import type { ResolvedTurn } from '@/lib/engine/gameTimeline'

type Pt = [number, number]

export interface ReplayedGame {
  /** The play, cut back to the turns that could be rebuilt. */
  play: Play
  chain: { state: SimState; ball: Pt; holder: string } | null
  history: TurnSnapshot[]
  /** Each rebuilt turn with its simulation: the one game timeline (engine/gameTimeline.ts). */
  turns: ResolvedTurn[]
  holder: string
  /** Next turn to plan. */
  turn: number
  score: number
  /** Turns the saved play had that could not be rebuilt (no builder bookkeeping on the step). */
  skipped: number
}

/** A play saved from /builder: its setup step knows who kicked off. */
export function isBuilderGame(play: Pick<Play, 'steps'>): boolean {
  return !!play.steps[0]?.builder?.kickoffHolder
}

const positionsOf = (state: SimState): Record<string, Pt> =>
  Object.fromEntries(Object.entries(state).map(([id, p]) => [id, [p.x, p.y] as Pt]))

/** Rebuild the game from a saved play, or null when the play did not come from the builder. */
export function replayGame(play: Play, labelOf: (id: string) => string): ReplayedGame | null {
  const kickoff = play.steps[0]?.builder?.kickoffHolder
  if (!kickoff) return null
  let state = initialState(play)
  let holder: string = kickoff
  let ball: Pt = state[holder] ? [state[holder].x, state[holder].y] : [PITCH_W / 2, PITCH_H / 2]
  const history: TurnSnapshot[] = [
    { turn: 0, actionIndex: 0, actionCount: 0, label: 'Kick-off', positions: positionsOf(state), holder },
  ]
  let chain: ReplayedGame['chain'] = null
  const turns: ResolvedTurn[] = []
  let score = 0
  let rebuilt = 0
  for (let i = 1; i < play.steps.length; i++) {
    const meta = play.steps[i].builder
    if (!meta?.actions) break
    const startPositions = positionsOf(state)
    const tl = simulateStep(play, i, state, holder, ball)
    const startHolder = holder
    const plans = scheduleTurn(meta.actions, startPositions, meta.outcomes ?? {}).plans
    const endPositions = positionsOf(tl.end)
    const planned = holderAfter(holder, meta.actions)
    const next = meta.endHolder ?? planned ?? holder
    const returned = next !== planned
    const snaps = buildSnapshots(i, plans, startPositions, endPositions, holder, labelOf)
    const last = snaps.at(-1)
    if (last && returned) snaps[snaps.length - 1] = { ...last, holder: next }
    history.push(...snaps)
    const lastBall = tl.frames.at(-1)?.ball
    ball = lastBall && !returned ? [lastBall.x, lastBall.y] : (endPositions[next] ?? [PITCH_W / 2, PITCH_H / 2])
    state = tl.end
    holder = next
    chain = { state, ball, holder }
    const goal = detectGoal(tl.frames)
    turns.push({ tl, plans, actions: meta.actions, startHolder, after: chain, goalAt: goal ? goal.frameIndex * H : null })
    if (meta.goal) score++
    rebuilt = i
  }
  const skipped = play.steps.length - 1 - rebuilt
  return {
    play: skipped > 0 ? { ...play, steps: play.steps.slice(0, rebuilt + 1) } : play,
    chain,
    history,
    turns,
    holder,
    turn: rebuilt + 1,
    score,
    skipped,
  }
}
