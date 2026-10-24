// Turn-based builder engine (the /builder route).
//
// A game is a growing Play: steps[0] is the kick-off setup and every resolved turn appends one step.
// The step carries the turn's queued actions (runs/dribbles as moves, the pass as a pass) and switches
// the defensive AI on for the opponent, so resolution and animation are the ordinary step simulator —
// the same aggression / line-height / width / gravity engine the editor uses. The builder chains
// SimState + ball holder across turns itself (simulateStep is called with an explicit holder), because
// the ball must follow a designated holder even before the first pass exists.
//
// Rewind is per ACTION, not per turn: resolving a turn with N queued actions appends N snapshots, where
// snapshot i shows actions 1..i (queue order) landed at their end-of-turn spots, everyone else still at
// the turn's start, and the AI-driven defenders i/N of the way to where the turn left them.

import type { PassAnimation, PlayerMove, PlayStep } from '@/lib/types/play'

type Pt = [number, number]

export type ActionKind = 'pass' | 'dribble' | 'run'

export type BuilderAction =
  | { kind: 'pass'; playerId: string; to: string }
  | { kind: 'dribble'; playerId: string; toX: number; toY: number }
  | { kind: 'run'; playerId: string; toX: number; toY: number }

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
/** XCOM-style action budget: no action may take longer than this, so a turn never exceeds
 *  ACTION_MAX_S + TURN_TAIL_S. At the paces above that means a 21m run and a 63m pass. */
export const ACTION_MAX_S = 3.5
export const RUN_RANGE_M = MOVE_MPS * ACTION_MAX_S
export const PASS_RANGE_M = PASS_MPS * ACTION_MAX_S
/** Extra seconds after the last action lands, so the defensive block visibly settles. */
export const TURN_TAIL_S = 0.8
export const MIN_TURN_S = 1.6

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** What the selected player may queue: the ball carrier passes or dribbles, everyone else runs. */
export function allowedKinds(playerId: string, holder: string | null): ActionKind[] {
  return playerId === holder ? ['pass', 'dribble'] : ['run']
}

/** Which of a player's queued actions a new one displaces: a pass conflicts with the ball actions
 *  (pass/dribble), a run with the movement actions (run/dribble), and a dribble is both — so a passer
 *  can also carry a support run (the attacking AI suggests exactly that), but never two of a kind. */
const conflicts = (a: ActionKind, b: ActionKind) =>
  a === 'dribble' || b === 'dribble' || a === b

/** Add `action` to the queue, displacing whatever it conflicts with for that player. */
export function queueAction(queue: BuilderAction[], action: BuilderAction): BuilderAction[] {
  return [...queue.filter((a) => a.playerId !== action.playerId || !conflicts(a.kind, action.kind)), action]
}

/** Holder once the turn resolves: the pass recipient, else unchanged (dribbles and runs keep it). */
export function holderAfter(holder: string | null, actions: BuilderAction[]): string | null {
  const pass = actions.filter((a) => a.kind === 'pass').at(-1)
  return pass ? pass.to : holder
}

export function actionLabel(action: BuilderAction, labelOf: (id: string) => string): string {
  if (action.kind === 'pass') return `${labelOf(action.playerId)} → ${labelOf(action.to)}`
  return `${labelOf(action.playerId)} ${action.kind === 'dribble' ? 'dribbles' : 'runs'}`
}

/** How far this kind of action may reach within the turn's time budget. */
export function actionRange(kind: ActionKind): number {
  return kind === 'pass' ? PASS_RANGE_M : RUN_RANGE_M
}

/** Whether the action's travel distance fits the turn's time budget (the UI refuses it otherwise). */
export function actionInRange(action: BuilderAction, positions: Record<string, Pt>): boolean {
  const from = positions[action.playerId]
  if (!from) return false
  const to: Pt = action.kind === 'pass' ? (positions[action.to] ?? from) : [action.toX, action.toY]
  return dist(from, to) <= actionRange(action.kind) + 1e-9
}

/** Seconds an action takes from its player's current spot (distance over the kind's pace),
 *  clamped to the action budget so an out-of-range action can never stretch the turn. */
function actionSeconds(action: BuilderAction, positions: Record<string, Pt>): number {
  const from = positions[action.playerId]
  if (!from) return MIN_ACTION_S
  const to: Pt = action.kind === 'pass' ? (positions[action.to] ?? from) : [action.toX, action.toY]
  const mps = action.kind === 'pass' ? PASS_MPS : MOVE_MPS
  return Math.min(ACTION_MAX_S, Math.max(MIN_ACTION_S, dist(from, to) / mps))
}

/**
 * The queued turn as a simulator step: every action starts at t=0 (simultaneous queue-and-play),
 * runs/dribbles become moves, the pass a pass, and the opponent's defensive AI is on.
 */
export function turnStep(actions: BuilderAction[], positions: Record<string, Pt>, index: number): PlayStep {
  const moves: PlayerMove[] = []
  const passes: PassAnimation[] = []
  let latest = 0
  for (const a of actions) {
    const endTime = actionSeconds(a, positions)
    latest = Math.max(latest, endTime)
    if (a.kind === 'pass') {
      passes.push({ from: a.playerId, to: a.to, startTime: 0, endTime, passingSpeed: 'medium' })
    } else {
      moves.push({ playerId: a.playerId, toX: a.toX, toY: a.toY, startTime: 0, endTime, runningSpeed: 'jog' })
    }
  }
  return {
    id: `turn-${index}`,
    index,
    title: `Turn ${index}`,
    duration: Math.max(MIN_TURN_S, latest + TURN_TAIL_S),
    moves,
    passes,
    defenderRules: {},
    faceTargets: [],
    // Near-immediate engagement, pressing readily — the reference's defenders start closing within
    // half a second of the ball moving; the default 0.4s reaction + mid aggression read as sluggish.
    ai: { opp: { on: true, aggressiveness: 70, reaction: 0.1 } },
  }
}

/**
 * Per-action rewind snapshots for a resolved turn. Snapshot i (1-based) places the movers of actions
 * 1..i at their end-of-turn positions, leaves later movers at the turn's start, and interpolates every
 * other player who moved (the AI-driven defenders) i/N of the way from start to end. The last snapshot
 * is exactly the turn's end state. The ball holder flips on the snapshot whose action is the pass.
 */
export function buildSnapshots(
  turn: number,
  actions: BuilderAction[],
  startPositions: Record<string, Pt>,
  endPositions: Record<string, Pt>,
  startHolder: string | null,
  labelOf: (id: string) => string,
): TurnSnapshot[] {
  const n = actions.length
  if (n === 0) return []
  const movers = new Set(actions.map((a) => a.playerId))
  return actions.map((_, k) => {
    const i = k + 1
    const landed = new Set(actions.slice(0, i).map((a) => a.playerId))
    const positions: Record<string, Pt> = {}
    for (const [id, start] of Object.entries(startPositions)) {
      const end = endPositions[id] ?? start
      if (landed.has(id)) positions[id] = end
      else if (movers.has(id)) positions[id] = start
      else positions[id] = [start[0] + ((end[0] - start[0]) * i) / n, start[1] + ((end[1] - start[1]) * i) / n]
    }
    return {
      turn,
      actionIndex: i,
      actionCount: n,
      label: actionLabel(actions[k], labelOf),
      positions,
      holder: holderAfter(startHolder, actions.slice(0, i)),
    }
  })
}
