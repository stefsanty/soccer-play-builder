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

export function detectConflicts(actions: ActionItem[]): ActionConflict[] {
  const conflicts: ActionConflict[] = []
  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const a = actions[i]
      const b = actions[j]
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
 * Re-time run actions so they no longer overlap with anything. Pass/receive
 * timings are left unchanged (they depend on ball physics and the passer's
 * authored speed). Runs are pushed to start after any overlapping action ends.
 */
export function autoFixConflicts(actions: ActionItem[]): ActionItem[] {
  const sorted = [...actions].sort((a, b) => a.startTime - b.startTime)
  let cursor = 0
  return sorted.map((action) => {
    if (action.type !== 'run') {
      cursor = Math.max(cursor, action.endTime)
      return action
    }
    const start = Math.max(cursor, action.startTime)
    const dur = Math.max(0.1, action.endTime - action.startTime)
    cursor = start + dur
    return { ...action, startTime: start, endTime: start + dur }
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
