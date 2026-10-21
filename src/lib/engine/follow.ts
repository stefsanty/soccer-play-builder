// Follow rule helpers: bounds geometry, the follow target, and the exit -> handoff logic.
// A follower shadows an attacker inside `bounds` (while the attacker is still outside, the follower waits at
// the nearest edge). Only an attacker who has ENTERED the bounds can leave them: once he has been outside the
// bounds (plus a 2 m exit margin) for 0.3 s the follower reverts to its zone, a nearby defender may take the
// attacker over, and the original follower may not take anyone over for 1 s.

import type { Bounds, FollowRule } from '@/lib/types/play'

export type XY = [number, number]

export const EXIT_MARGIN = 2 // m the attacker must be beyond the bounds
export const EXIT_TIME = 0.3 // s the attacker must stay out
export const HANDOFF_COOLDOWN = 1 // s the original follower is locked out afterwards

export interface FollowTrack {
  /** Has the attacker been inside the bounds since tracking began? An exit only counts after an entry. */
  entered: boolean
  outsideSince: number | null
  cooldownUntil: number
}
export const newFollowTrack = (): FollowTrack => ({ entered: false, outsideSince: null, cooldownUntil: -Infinity })

/** Is `p` inside `b`, grown by `margin` metres? */
export function contains(b: Bounds, p: XY, margin = 0): boolean {
  if (b.kind === 'rect') {
    return p[0] >= Math.min(b.x0, b.x1) - margin && p[0] <= Math.max(b.x0, b.x1) + margin
      && p[1] >= Math.min(b.y0, b.y1) - margin && p[1] <= Math.max(b.y0, b.y1) + margin
  }
  return Math.hypot(p[0] - b.c[0], p[1] - b.c[1]) <= b.r + margin
}

/** Nearest point to `p` that lies inside `b`. */
export function clampIntoBounds(p: XY, b: Bounds): XY {
  if (b.kind === 'rect') {
    return [
      Math.min(Math.max(p[0], Math.min(b.x0, b.x1)), Math.max(b.x0, b.x1)),
      Math.min(Math.max(p[1], Math.min(b.y0, b.y1)), Math.max(b.y0, b.y1)),
    ]
  }
  const d = Math.hypot(p[0] - b.c[0], p[1] - b.c[1])
  if (d <= b.r || d === 0) return p
  return [b.c[0] + ((p[0] - b.c[0]) / d) * b.r, b.c[1] + ((p[1] - b.c[1]) / d) * b.r]
}

/**
 * Where a follower stands: the attacker plus the offset (`gap` goal-side, `dx` across), held inside
 * the bounds, blended from the zone by `w`. `goalDir` is +1 when the defending goal is at +y.
 */
export function followTarget(rule: FollowRule, att: XY, goalDir: 1 | -1): XY {
  const raw: XY = [att[0] + (rule.dx ?? 0), att[1] + goalDir * (rule.gap ?? 2.5)]
  const inside = clampIntoBounds(raw, rule.bounds)
  const w = rule.w ?? 0.85
  return [rule.zone[0] + (inside[0] - rule.zone[0]) * w, rule.zone[1] + (inside[1] - rule.zone[1]) * w]
}

/**
 * Advance the exit tracker. Returns true exactly once per exit: when the attacker has been outside
 * the bounds (+ margin) for EXIT_TIME. Firing starts the follower's cooldown.
 */
export function trackExit(track: FollowTrack, rule: FollowRule, att: XY, t: number): boolean {
  if (t < track.cooldownUntil) {
    track.outsideSince = null
    return false
  }
  if (contains(rule.bounds, att)) track.entered = true
  if (!track.entered) {
    // not in the area yet (e.g. a striker dropping in from the box): nothing to hand over
    track.outsideSince = null
    return false
  }
  if (contains(rule.bounds, att, EXIT_MARGIN)) {
    track.outsideSince = null
    return false
  }
  if (track.outsideSince === null) track.outsideSince = t
  if (t - track.outsideSince >= EXIT_TIME - 1e-6) {
    track.outsideSince = null
    track.entered = false
    track.cooldownUntil = t + HANDOFF_COOLDOWN
    return true
  }
  return false
}

export interface HandoffCandidate {
  id: string
  pos: XY
  /** The candidate's own working area, if it has one. */
  bounds?: Bounds
}

/** Lower is better: distance, -8 if the attacker is already in the candidate's area, +5 if not goal-side. */
export function handoffCost(c: HandoffCandidate, att: XY, goalDir: 1 | -1): number {
  const dist = Math.hypot(c.pos[0] - att[0], c.pos[1] - att[1])
  const inArea = c.bounds && contains(c.bounds, att) ? -8 : 0
  const goalSide = (c.pos[1] - att[1]) * goalDir >= 0 ? 0 : 5
  return dist + inArea + goalSide
}

/** The cheapest candidate, or null if there is none. */
export function pickHandoff(candidates: HandoffCandidate[], att: XY, goalDir: 1 | -1): string | null {
  let best: { id: string; cost: number } | null = null
  for (const c of candidates) {
    const cost = handoffCost(c, att, goalDir)
    if (!best || cost < best.cost) best = { id: c.id, cost }
  }
  return best ? best.id : null
}
