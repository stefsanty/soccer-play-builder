// Shooting: the chance a shot from `from` at `target` (a spot in the goal mouth) beats the keeper.
//
//   base    = 1 / (1 + (d / 12)^2)     distance d in metres to the target — 80% at 6 m, 54% at 11 m
//                                       (penalty spot), 26% at 20 m, 14% at 30 m
//   angle   = max(0.1, cos θ)^0.6       θ between the shot and the goal's normal: a tight angle shows
//                                       the keeper less goal to cover
//   bodies  = 0.6 per defender inside BLOCK_REACH of the shot line, between shooter and goal
//   chance  = clamp(base · angle · bodies, 0.03, 0.95)
//
// The keeper is modelled by the curve itself, not as a body. Pure functions; the UI rolls the dice.

type Pt = [number, number]

/** A shot may be queued from this far out (metres to the target). */
export const SHOT_RANGE_M = 35
/** A defender this close to the shot line (and between shooter and goal) counts as a body in the way. */
export const BLOCK_REACH_M = 1.5
const BLOCK_FACTOR = 0.6
const MIN_CHANCE = 0.03
const MAX_CHANCE = 0.95

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Perpendicular distance from `p` to segment a→b and where along it (0..1) the foot of the perpendicular lies. */
export function distToSegment(p: Pt, a: Pt, b: Pt): { d: number; u: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const u = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1)
  return { d: Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dy * u)), u }
}

/** Chance (0..1) that a shot from `from` at `target` scores, with `blockers` (defenders, not the keeper) in play. */
export function shotChance(from: Pt, target: Pt, blockers: Pt[]): number {
  const dx = target[0] - from[0]
  const dy = target[1] - from[1]
  const d = Math.hypot(dx, dy)
  const base = 1 / (1 + (d / 12) ** 2)
  // the goal's normal points up the pitch (+y); cos θ is the shot direction's share along it
  const cos = d > 0 ? dy / d : 1
  const angle = Math.max(0.1, cos) ** 0.6
  let bodies = 1
  for (const b of blockers) {
    const s = distToSegment(b, from, target)
    if (s.d <= BLOCK_REACH_M && s.u > 0 && s.u < 1) bodies *= BLOCK_FACTOR
  }
  return clamp(base * angle * bodies, MIN_CHANCE, MAX_CHANCE)
}

export type ShotResult = 'goal' | 'saved'

/** Roll the dice on a shot: scores when the roll lands under `chance`. */
export function rollShot(chance: number, rng: () => number = Math.random): ShotResult {
  return rng() < chance ? 'goal' : 'saved'
}
