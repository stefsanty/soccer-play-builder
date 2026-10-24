// Turn-based builder engine (the /builder route).
//
// A game is a growing Play: steps[0] is the kick-off setup and every resolved turn appends one step.
// The step carries the turn's queued actions (runs/dribbles as moves, passes as passes) and switches
// the defensive AI on for the opponent, so resolution and animation are the ordinary step simulator —
// the same aggression / line-height / width / gravity engine the editor uses. The builder chains
// SimState + ball holder across turns itself (simulateStep is called with an explicit holder), because
// the ball must follow a designated holder even before the first pass exists.
//
// Actions CHAIN: a player may queue several, and they run one after another. Scheduling is implicit —
// a player's next action starts when their previous one ends, and an action queued after a pass to
// that player waits for the ball to arrive (the "wait, receive, then go" pattern needs no explicit
// wait action). Different players' chains run in parallel.
//
// Rewind is per ACTION: resolving a turn with N queued actions appends N snapshots, where snapshot i
// shows the movers of actions 1..i (queue order) landed, later movers still at the turn's start, and
// the AI-driven defenders i/N of the way to where the turn left them.

import type { PassAnimation, PlayerMove, PlayStep } from '@/lib/types/play'

type Pt = [number, number]

export type ActionKind = 'pass' | 'dribble' | 'run'

export type BuilderAction =
  | { kind: 'pass'; playerId: string; to: string; delay?: number }
  | { kind: 'dribble'; playerId: string; toX: number; toY: number; delay?: number }
  | { kind: 'run'; playerId: string; toX: number; toY: number; delay?: number }

/** One rewindable moment. `turn` 0 / `actionIndex` 0 is the kick-off snapshot. */
export interface TurnSnapshot {
  turn: number
  /** 1..N within the turn (0 only on the kick-off snapshot). */
  actionIndex: number
  actionCount: number
  label: string
  positions: Record<string, Pt>
  holder: string | null
}

// Paces measured from the reference viewer (pattern-of-play HTML): its passes cover their distance in
// ~15–19 m/s (RCB→RB 24m in 1.3s) and its runs in ~5–7 m/s (RB's 31m overlap takes 4.3s) — football
// speeds, not the editor's snappy 40/15 defaults.
export const PASS_MPS = 18
export const MOVE_MPS = 6
export const MIN_ACTION_S = 0.5
/** XCOM-style action budget: no single action may take longer than this. At the paces above that
 *  means a 21m run and a 63m pass. A tap beyond the run range is capped to it, not refused. */
export const ACTION_MAX_S = 3.5
export const RUN_RANGE_M = MOVE_MPS * ACTION_MAX_S
export const PASS_RANGE_M = PASS_MPS * ACTION_MAX_S
/** Extra seconds after the last action lands, so the defensive block visibly settles. */
export const TURN_TAIL_S = 0.8
export const MIN_TURN_S = 1.6

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** What the selected player may queue, given who will hold the ball once the queue so far has run:
 *  the (projected) carrier passes or dribbles, everyone else runs. */
export function allowedKinds(playerId: string, holder: string | null): ActionKind[] {
  return playerId === holder ? ['pass', 'dribble'] : ['run']
}

/** Append `action` to the chain. */
export function queueAction(queue: BuilderAction[], action: BuilderAction): BuilderAction[] {
  return [...queue, action]
}

/** Holder once the given actions resolve: the last pass's recipient, else unchanged. */
export function holderAfter(holder: string | null, actions: BuilderAction[]): string | null {
  const pass = actions.filter((a) => a.kind === 'pass').at(-1)
  return pass ? pass.to : holder
}

/** Drop ball actions whose owner would not hold the ball at that point in the chain — used after a
 *  chip is removed, so e.g. deleting the pass to RST also drops RST's now-impossible onward pass. */
export function sanitizeQueue(queue: BuilderAction[], startHolder: string | null): BuilderAction[] {
  let projected = startHolder
  const kept: BuilderAction[] = []
  for (const a of queue) {
    if (a.kind === 'run') {
      kept.push(a)
      continue
    }
    if (a.playerId !== projected) continue
    kept.push(a)
    if (a.kind === 'pass') projected = a.to
  }
  return kept
}

export function actionLabel(action: BuilderAction, labelOf: (id: string) => string): string {
  if (action.kind === 'pass') return `${labelOf(action.playerId)} → ${labelOf(action.to)}`
  return `${labelOf(action.playerId)} ${action.kind === 'dribble' ? 'dribbles' : 'runs'}`
}

/** Set an action's authored start time (timeline drag), tenth-of-a-second resolution, never negative. */
export function retimeAction(queue: BuilderAction[], index: number, delay: number): BuilderAction[] {
  const v = Math.max(0, Math.round(delay * 10) / 10)
  return queue.map((a, i) => (i === index ? { ...a, delay: v } : a))
}

/** How far this kind of action may reach within the action budget. */
export function actionRange(kind: ActionKind): number {
  return kind === 'pass' ? PASS_RANGE_M : RUN_RANGE_M
}

/** Whether the action's travel distance fits the budget (the UI caps moves / refuses passes otherwise). */
export function actionInRange(action: BuilderAction, positions: Record<string, Pt>): boolean {
  const from = positions[action.playerId]
  if (!from) return false
  const to: Pt = action.kind === 'pass' ? (positions[action.to] ?? from) : [action.toX, action.toY]
  return dist(from, to) <= actionRange(action.kind) + 1e-9
}

/** A scheduled action: where its actor departs from, where it goes, and when. */
export interface ActionPlan {
  action: BuilderAction
  from: Pt
  to: Pt
  start: number
  end: number
}

export interface TurnSchedule {
  plans: ActionPlan[]
  moves: PlayerMove[]
  passes: PassAnimation[]
  /** Seconds until the last action ends (before the settle tail). */
  length: number
  /** Each player's position once their queued moves have run. */
  planned: Record<string, Pt>
}

/**
 * Lay the chain out in time. Per player, action k starts when action k-1 ends; a pass also holds its
 * receiver's LATER actions until the ball arrives (actions queued before the pass run beforehand —
 * that's how a player gets open first). Travel times come from distance over pace, clamped to the
 * action budget.
 */
export function scheduleTurn(actions: BuilderAction[], startPositions: Record<string, Pt>): TurnSchedule {
  const planned: Record<string, Pt> = Object.fromEntries(
    Object.entries(startPositions).map(([id, p]) => [id, [p[0], p[1]] as Pt]),
  )
  const avail: Record<string, number> = {}
  const plans: ActionPlan[] = []
  const moves: PlayerMove[] = []
  const passes: PassAnimation[] = []
  let length = 0

  for (const a of actions) {
    const from = planned[a.playerId]
    if (!from) continue
    // `delay` is an authored start time (the timeline's drag-to-retime); dependencies still win,
    // so an action can be pushed later but never ahead of its chain or an incoming ball.
    const start = Math.max(avail[a.playerId] ?? 0, a.delay ?? 0)
    if (a.kind === 'pass') {
      const to = planned[a.to] ?? from
      const end = start + Math.min(ACTION_MAX_S, Math.max(MIN_ACTION_S, dist(from, to) / PASS_MPS))
      passes.push({ from: a.playerId, to: a.to, startTime: start, endTime: end, passingSpeed: 'medium' })
      plans.push({ action: a, from: [...from], to: [...to], start, end })
      avail[a.playerId] = end
      avail[a.to] = Math.max(avail[a.to] ?? 0, end) // the receiver's later actions wait for the ball
      length = Math.max(length, end)
    } else {
      const to: Pt = [a.toX, a.toY]
      const end = start + Math.min(ACTION_MAX_S, Math.max(MIN_ACTION_S, dist(from, to) / MOVE_MPS))
      moves.push({ playerId: a.playerId, toX: to[0], toY: to[1], startTime: start, endTime: end, runningSpeed: 'jog' })
      plans.push({ action: a, from: [...from], to, start, end })
      planned[a.playerId] = to
      avail[a.playerId] = end
      length = Math.max(length, end)
    }
  }
  return { plans, moves, passes, length, planned }
}

/** The queued turn as a simulator step, with the opponent's defensive AI on. */
export function turnStep(actions: BuilderAction[], positions: Record<string, Pt>, index: number): PlayStep {
  const sched = scheduleTurn(actions, positions)
  return {
    id: `turn-${index}`,
    index,
    title: `Turn ${index}`,
    duration: Math.max(MIN_TURN_S, sched.length + TURN_TAIL_S),
    moves: sched.moves,
    passes: sched.passes,
    defenderRules: {},
    faceTargets: [],
    // Near-immediate engagement, pressing readily — the reference's defenders start closing within
    // half a second of the ball moving; the default 0.4s reaction + mid aggression read as sluggish.
    ai: { opp: { on: true, aggressiveness: 70, reaction: 0.1 } },
  }
}

/**
 * Per-action rewind snapshots for a resolved turn. Snapshot i (1-based) places each mover at the
 * target of their last landed move among actions 1..i, leaves players whose moves come later at the
 * turn's start, and interpolates everyone else (the AI-driven defenders) i/N of the way from start to
 * end. The final snapshot is exactly the turn's end state. The holder flips on pass snapshots.
 */
export function buildSnapshots(
  turn: number,
  plans: ActionPlan[],
  startPositions: Record<string, Pt>,
  endPositions: Record<string, Pt>,
  startHolder: string | null,
  labelOf: (id: string) => string,
): TurnSnapshot[] {
  const n = plans.length
  if (n === 0) return []
  const moverIds = new Set(plans.filter((p) => p.action.kind !== 'pass').map((p) => p.action.playerId))
  return plans.map((plan, k) => {
    const i = k + 1
    const positions: Record<string, Pt> = {}
    if (i === n) {
      for (const [id, p] of Object.entries(endPositions)) positions[id] = [p[0], p[1]]
    } else {
      for (const [id, start] of Object.entries(startPositions)) {
        const end = endPositions[id] ?? start
        const landed = plans
          .slice(0, i)
          .filter((p) => p.action.kind !== 'pass' && p.action.playerId === id)
          .at(-1)
        if (landed) positions[id] = [...landed.to]
        else if (moverIds.has(id)) positions[id] = [start[0], start[1]]
        else positions[id] = [start[0] + ((end[0] - start[0]) * i) / n, start[1] + ((end[1] - start[1]) * i) / n]
      }
    }
    return {
      turn,
      actionIndex: i,
      actionCount: n,
      label: actionLabel(plan.action, labelOf),
      positions,
      holder: holderAfter(startHolder, plans.slice(0, i).map((p) => p.action)),
    }
  })
}
