// The Turn Builder's game as ONE timeline: every resolved turn keeps its simulated timeline, and the
// turn being planned (the draft) sits at the end. Step markers are the moments an action ends; going
// back puts the pitch at the exact simulated frame of a marker, and planning from there branches the
// game (later turns, and later actions of that turn, are dropped).

import type { SimState, StepTimeline } from '@/lib/engine/simulator'
import { actionLabel, type ActionPlan, type BuilderAction } from '@/lib/engine/turnBuilder'

type Pt = [number, number]

/** A turn that has been played: its simulation and how the game stood after it. */
export interface ResolvedTurn {
  tl: StepTimeline
  /** As scheduled with the dice outcomes; `plans[i].action` are the same objects as in `actions`. */
  plans: ActionPlan[]
  actions: BuilderAction[]
  startHolder: string | null
  after: { state: SimState; ball: Pt; holder: string }
  /** Seconds into the turn the ball crossed the goal line, or null. */
  goalAt: number | null
}

/** A point in the game: `turn` is 1-based; turn = resolved turns + 1 is the draft. */
export interface TimelinePoint {
  turn: number
  t: number
}

export interface TimelineMarker extends TimelinePoint {
  label: string
}

const EPS = 0.02

/** Action ends within a turn, merged when they land together, the turn's end included. */
function turnMarkers(turn: number, plans: ActionPlan[], duration: number, labelOf: (id: string) => string): TimelineMarker[] {
  const out: TimelineMarker[] = []
  const ends = [...plans].sort((a, b) => a.end - b.end)
  for (const p of ends) {
    const t = Math.min(p.end, duration)
    const prev = out.at(-1)
    if (prev && Math.abs(prev.t - t) < EPS) prev.label += ` · ${actionLabel(p.action, labelOf)}`
    else out.push({ turn, t, label: actionLabel(p.action, labelOf) })
  }
  const last = out.at(-1)
  if (last) last.t = duration
  else out.push({ turn, t: duration, label: `End of turn ${turn}` })
  return out
}

/**
 * Every step marker of the game in order: kick-off, each action end of each resolved turn, then the
 * draft's action ends. The last marker is "now" (the planned end of the draft, or the last turn's end).
 */
export function buildMarkers(
  turns: ResolvedTurn[],
  draft: { plans: ActionPlan[]; duration: number } | null,
  labelOf: (id: string) => string,
): TimelineMarker[] {
  const out: TimelineMarker[] = [{ turn: 1, t: 0, label: 'Kick-off' }]
  turns.forEach((tr, i) => out.push(...turnMarkers(i + 1, tr.plans, tr.tl.duration, labelOf)))
  if (draft && draft.plans.length > 0) out.push(...turnMarkers(turns.length + 1, draft.plans, draft.duration, labelOf))
  return out
}

/** Index of the marker closest to `p` within its turn (the turn's start counts as the previous turn's end). */
export function nearestMarker(markers: TimelineMarker[], p: TimelinePoint): number {
  let best = 0
  let bestD = Infinity
  markers.forEach((m, i) => {
    // turn k's t=0 is the same moment as the end of turn k-1
    const sameTurn = m.turn === p.turn
    const prevEnd = m.turn === p.turn - 1 && (markers[i + 1]?.turn ?? Infinity) > m.turn
    const d = sameTurn ? Math.abs(m.t - p.t) : prevEnd ? p.t : Infinity
    if (d < bestD - 1e-9) {
      bestD = d
      best = i
    }
  })
  return best
}

/** The actions (queue order) that have finished by `t` — what is kept when the game branches mid-turn. */
export function actionsDoneBy(actions: BuilderAction[], plans: ActionPlan[], t: number): BuilderAction[] {
  return actions.filter((a) => {
    const plan = plans.find((p) => p.action === a)
    return !!plan && plan.end <= t + EPS
  })
}

/** Whether `p` is at the end of resolved turn `p.turn` (so branching keeps that whole turn). */
export function atTurnEnd(turns: ResolvedTurn[], p: TimelinePoint): boolean {
  const tr = turns[p.turn - 1]
  return !!tr && p.t >= tr.tl.duration - EPS
}
