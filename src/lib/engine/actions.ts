// Per-player action queue: types, derivation from step data, and conflict helpers.
// Pure functions — no store or React dependencies.

import type { PlayStep } from '@/lib/types/play'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PassAction {
  id: string; type: 'pass'
  to: string
  startTime: number; endTime: number
  passingSpeed?: 'slow' | 'medium' | 'fast'
}

export interface ReceiveAction {
  id: string; type: 'receive'
  from: string
  startTime: number; endTime: number
}

export interface RunAction {
  id: string; type: 'run'
  toX: number; toY: number
  startTime: number; endTime: number
  runningSpeed?: 'jog' | 'sprint'
}

export interface HoldAction {
  id: string; type: 'hold'
  startTime: number; endTime: number
}

export type ActionItem = PassAction | ReceiveAction | RunAction | HoldAction

export interface PlayerActionQueue {
  playerId: string
  actions: ActionItem[]  // sorted ascending by startTime
}

export interface ActionConflict {
  actionIds: [string, string]
  description: string
}

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * Build a per-player action queue from the step's passes and moves. The queues
 * are derived, not stored — the canonical data lives in step.passes / step.moves.
 */
export function derivePlayerActions(step: PlayStep): PlayerActionQueue[] {
  const map = new Map<string, ActionItem[]>()
  const get = (id: string): ActionItem[] => {
    if (!map.has(id)) map.set(id, [])
    return map.get(id)!
  }

  step.passes.forEach((p, i) => {
    get(p.from).push({
      id: `pass:${i}:${p.from}`,
      type: 'pass',
      to: p.to,
      startTime: p.startTime,
      endTime: p.endTime,
      passingSpeed: p.passingSpeed,
    })
    get(p.to).push({
      id: `recv:${i}:${p.to}`,
      type: 'receive',
      from: p.from,
      startTime: p.startTime,
      endTime: p.endTime,
    })
  })

  for (const m of step.moves) {
    get(m.playerId).push({
      id: `run:${m.playerId}`,
      type: 'run',
      toX: m.toX,
      toY: m.toY,
      startTime: m.startTime,
      endTime: m.endTime,
      runningSpeed: m.runningSpeed,
    })
  }

  const queues: PlayerActionQueue[] = []
  for (const [playerId, actions] of map) {
    queues.push({
      playerId,
      actions: [...actions].sort((a, b) => a.startTime - b.startTime),
    })
  }
  return queues
}

// ─── Conflict detection ───────────────────────────────────────────────────────

/**
 * Moving is never a conflict: a receiver runs onto a pass in flight, a passer makes a support
 * run while his ball travels. The only impossibility is one player with two overlapping
 * BALL-BOUND actions (pass/receive) — he can't play two balls at once.
 */
const ballBound = (a: ActionItem) => a.type === 'pass' || a.type === 'receive'

export function detectConflicts(actions: ActionItem[]): ActionConflict[] {
  const conflicts: ActionConflict[] = []
  const ball = actions.filter(ballBound)
  for (let i = 0; i < ball.length; i++) {
    for (let j = i + 1; j < ball.length; j++) {
      const a = ball[i]
      const b = ball[j]
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        conflicts.push({
          actionIds: [a.id, b.id],
          description: `${cap(a.type)} and ${cap(b.type)} overlap`,
        })
      }
    }
  }
  return conflicts
}

/**
 * Re-time passes so ball-bound actions no longer overlap: a pass is pushed to start once the
 * previous pass/receive has finished (its flight duration is kept). Receives are never moved —
 * their timing belongs to the other player's pass — and runs are never touched (overlapping a
 * run is legal).
 */
export function autoFixConflicts(actions: ActionItem[]): ActionItem[] {
  const sorted = [...actions].sort((a, b) => a.startTime - b.startTime)
  let cursor = 0
  return sorted.map((action) => {
    if (!ballBound(action)) return action
    if (action.type === 'receive') {
      cursor = Math.max(cursor, action.endTime)
      return action
    }
    const start = Math.max(cursor, action.startTime)
    const dur = Math.max(0.1, action.endTime - action.startTime)
    cursor = start + dur
    return start === action.startTime ? action : { ...action, startTime: start, endTime: start + dur }
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

/** Parse the pass index out of a 'pass:i:…' or 'recv:i:…' action id. */
export function passIndexFromId(id: string): number {
  return parseInt(id.split(':')[1], 10)
}

/** Parse the playerId out of a 'run:playerId' action id. */
export function playerIdFromRunId(id: string): string {
  return id.slice(4)
}
