// Step simulator — port of the pattern-of-play reference engine.
//
// A step is simulated at a fixed 60 Hz (H) from the state the previous step ended in, and recorded as
// frames, so playback can scrub/seek freely and the end state chains into the next step.
//   • our moves        : trapezoid tween along a line or a quadratic bezier (`via`)      (evalTw)
//   • ball             : stays on the holder (offset along their facing), flies on passes (bp/flight/ballAt)
//   • defenders        : zone / mark rules, speed VMAX and acceleration AMAX limited, pairwise separation
//   • facing           : smooth turn towards a scheduled target (`faceTargets`), else movement / ball
// Rules and facing persist across steps until a new rule / face target takes effect.
//
// Pitch units are metres (x 0..68, y 0..105; the opponent goal is at y = 105). A facing angle `a` uses
// screen orientation: 0 = +x, -PI/2 = up the pitch (increasing y), so a point `d` ahead is (cos a, -sin a)*d.

import type { DefenderRule, FaceTarget, PassAnimation, Play, PlayStep, PlayerMove } from '@/lib/types/play'
import { trapezoid } from '@/lib/engine/physics'
import { baseStepIndex, ballHolderBefore } from '@/lib/engine/ballHolder'

type Pt = [number, number]

export const H = 1 / 60
export const VMAX = 6.8 // m/s, defender top speed
export const AMAX = 5.5 // m/s^2, defender acceleration limit
export const BALL_OFFSET = 1.35 // m, ball sits this far from the holder along their facing
const FACE_RATE = 7 // rad/s
const SEPARATION = 1.8 // m, defenders closer than this are pushed apart
const MOVING = 0.8 // m/s, our players face their run direction above this speed

const UP = -Math.PI / 2
const DOWN = Math.PI / 2

export interface PlayerState {
  x: number
  y: number
  vx: number
  vy: number
  face: number
  /** Persisting face target (player id or point); null = none yet. */
  faceTo: string | Pt | null
  /** Persisting defender rule. */
  rule: DefenderRule | null
  team: 'ours' | 'opp'
}
export type SimState = Record<string, PlayerState>

export interface BallFrame {
  x: number
  y: number
  flying: boolean
  /** 0..1 arc height for lobs. */
  lift: number
  holder: string | null
}

export interface SimFrame {
  t: number
  players: Record<string, { x: number; y: number; face: number }>
  ball: BallFrame
  /** Defenders currently on a mark rule: defender -> attacker. */
  marks: { from: string; to: string }[]
}

export interface StepTimeline {
  stepIndex: number
  /** Simulated seconds (0 for a static step). */
  duration: number
  frames: SimFrame[]
  start: SimState
  end: SimState
  /** Where each pass leaves from (ball position at its start time), indexed like step.passes. */
  passOrigins: Pt[]
  holderStart: string | null
}

// ---- tweens (reference: trap / evalTw) ----
export interface Tween {
  fx: number
  fy: number
  tx: number
  ty: number
  t0: number
  t1: number
  a: number
  via?: Pt
}

/** Position of tween `tw` at time `t`. */
export function evalTw(tw: Tween, t: number): { x: number; y: number } {
  const span = tw.t1 - tw.t0
  const s = trapezoid(span > 0 ? (t - tw.t0) / span : t >= tw.t1 ? 1 : 0, tw.a)
  if (!tw.via) return { x: tw.fx + (tw.tx - tw.fx) * s, y: tw.fy + (tw.ty - tw.fy) * s }
  const q = 1 - s
  return {
    x: q * q * tw.fx + 2 * q * s * tw.via[0] + s * s * tw.tx,
    y: q * q * tw.fy + 2 * q * s * tw.via[1] + s * s * tw.ty,
  }
}

// ---- state ----
export function initialState(play: Play): SimState {
  const s: SimState = {}
  for (const p of play.players) {
    s[p.id] = { x: p.x, y: p.y, vx: 0, vy: 0, face: p.team === 'ours' ? UP : DOWN, faceTo: null, rule: null, team: p.team }
  }
  return s
}

const cloneState = (s: SimState): SimState => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v }]))

const angleTo = (fx: number, fy: number, tx: number, ty: number) => Math.atan2(-(ty - fy), tx - fx)

function turn(from: number, to: number, maxStep: number): number {
  let d = to - from
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return from + Math.max(-maxStep, Math.min(maxStep, d))
}

/** Where a defender wants to be under `rule`, given the attackers' positions this tick. */
function ruleTarget(rule: DefenderRule, pos: (id: string) => Pt | null): Pt {
  if (rule.type === 'zone') return rule.target
  const att = pos(rule.attacker)
  if (!att) return rule.zone
  // Stand `gap` m goal-side of the attacker (+y, towards the opponent goal; negative = trailing him),
  // `dx` m across, then blend from the zone towards that point by `weight`.
  const mark: Pt = [att[0] + (rule.dx ?? 0), att[1] + rule.gap]
  return [rule.zone[0] + (mark[0] - rule.zone[0]) * rule.weight, rule.zone[1] + (mark[1] - rule.zone[1]) * rule.weight]
}

/** Simulate `play.steps[stepIndex]` from `start`. */
export function simulateStep(play: Play, stepIndex: number, start: SimState, holderStart: string | null): StepTimeline {
  const step: PlayStep = play.steps[stepIndex]
  const duration = step.duration > 0 ? step.duration : 0
  const n = Math.round(duration / H)
  const st = cloneState(start)
  const ids = Object.keys(st)

  const tweens = new Map<string, Tween>()
  for (const m of step.moves as PlayerMove[]) {
    const from = st[m.playerId]
    if (!from) continue
    tweens.set(m.playerId, { fx: from.x, fy: from.y, tx: m.toX, ty: m.toY, t0: m.startTime, t1: m.endTime, a: m.easeFraction ?? 0.25, via: m.via })
  }

  const faceQueue: FaceTarget[] = [...step.faceTargets].sort((a, b) => a.at - b.at)
  let faceIdx = 0
  const ruleQueues = Object.entries(step.defenderRules).map(([id, rules]) => ({
    id,
    rules: [...rules].sort((a, b) => (a.delay ?? 0) - (b.delay ?? 0)),
    next: 0,
  }))
  const passes: PassAnimation[] = [...step.passes].sort((a, b) => a.startTime - b.startTime)
  const passOrigins: Pt[] = step.passes.map(() => [0, 0])

  const frames: SimFrame[] = []
  const posAt = (id: string, t: number) => {
    const idx = Math.max(0, Math.round(t / H))
    return idx < frames.length ? frames[idx].players[id] : { x: st[id].x, y: st[id].y, face: st[id].face }
  }
  /** Ball position when carried by `id` at time `t` (reference: bp). */
  const bp = (id: string, t: number): Pt => {
    const q = posAt(id, t)
    return [q.x + Math.cos(q.face) * BALL_OFFSET, q.y - Math.sin(q.face) * BALL_OFFSET]
  }
  /** Ball in flight on pass `p` (reference: flight). */
  const flight = (p: PassAnimation, t: number, origin: Pt) => {
    const u = Math.min(1, Math.max(0, (t - p.startTime) / (p.endTime - p.startTime)))
    const k = p.isLob ? u : 1 - Math.pow(1 - u, 1.5)
    const e = bp(p.to, t)
    return { x: origin[0] + (e[0] - origin[0]) * k, y: origin[1] + (e[1] - origin[1]) * k, lift: p.isLob ? Math.sin(Math.PI * u) : 0 }
  }
  /** Ball at time `t` (reference: ballAt). */
  const ballAt = (t: number): BallFrame => {
    let h = holderStart
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i]
      if (t < p.startTime) break
      const origin = passOriginOf(p)
      if (t < p.endTime) {
        const f = flight(p, t, origin)
        return { x: f.x, y: f.y, flying: true, lift: f.lift, holder: null }
      }
      h = p.to
    }
    if (!h || !st[h]) return { x: 0, y: 0, flying: false, lift: 0, holder: null }
    const q = bp(h, t)
    return { x: q[0], y: q[1], flying: false, lift: 0, holder: h }
  }
  const origins = new Map<PassAnimation, Pt>()
  const passOriginOf = (p: PassAnimation): Pt => {
    let o = origins.get(p)
    if (!o) {
      o = bp(p.from, p.startTime)
      origins.set(p, o)
    }
    return o
  }

  let lastBall: BallFrame | null = null

  for (let k = 0; k <= n; k++) {
    const t = k * H

    // 1. our authored moves (any player with a move follows its tween)
    const moved = new Set<string>()
    for (const [id, tw] of tweens) {
      const p = st[id]
      const q = evalTw(tw, t)
      p.vx = (q.x - p.x) / H
      p.vy = (q.y - p.y) / H
      p.x = q.x
      p.y = q.y
      moved.add(id)
    }

    // 2. defenders: activate due rule changes, steer toward the target within VMAX / AMAX
    for (const q of ruleQueues) {
      while (q.next < q.rules.length && (q.rules[q.next].delay ?? 0) <= t + 1e-9) {
        if (st[q.id]) st[q.id].rule = q.rules[q.next]
        q.next++
      }
    }
    const posOf = (id: string): Pt | null => (st[id] ? [st[id].x, st[id].y] : null)
    for (const id of ids) {
      const p = st[id]
      if (moved.has(id) || !p.rule) {
        if (!moved.has(id) && k > 0) {
          // no rule: bleed off any leftover velocity
          const damp = Math.max(0, 1 - 4 * H)
          p.vx *= damp
          p.vy *= damp
          p.x += p.vx * H
          p.y += p.vy * H
        }
        continue
      }
      const [tx, ty] = ruleTarget(p.rule, posOf)
      const dx = tx - p.x
      const dy = ty - p.y
      const d = Math.hypot(dx, dy)
      const speed = Math.min(VMAX, d * 2.5)
      const wx = d > 1e-6 ? (dx / d) * speed : 0
      const wy = d > 1e-6 ? (dy / d) * speed : 0
      let ax = wx - p.vx
      let ay = wy - p.vy
      const am = Math.hypot(ax, ay)
      const lim = AMAX * H
      if (am > lim) {
        ax = (ax / am) * lim
        ay = (ay / am) * lim
      }
      p.vx += ax
      p.vy += ay
      p.x += p.vx * H
      p.y += p.vy * H
    }

    // 3. separation between defenders (they never stack on one spot)
    const defenders = ids.filter((id) => !moved.has(id) && st[id].team === 'opp')
    for (let i = 0; i < defenders.length; i++) {
      for (let j = i + 1; j < defenders.length; j++) {
        const a = st[defenders[i]]
        const b = st[defenders[j]]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d < SEPARATION && d > 1e-6) {
          const push = (SEPARATION - d) / 2
          a.x -= (dx / d) * push
          a.y -= (dy / d) * push
          b.x += (dx / d) * push
          b.y += (dy / d) * push
        }
      }
    }

    // 4. facing: scheduled targets persist; otherwise our runners face their run, defenders face the ball
    while (faceIdx < faceQueue.length && faceQueue[faceIdx].at <= t + 1e-9) {
      const f = faceQueue[faceIdx++]
      if (st[f.playerId]) st[f.playerId].faceTo = f.to
    }
    for (const id of ids) {
      const p = st[id]
      let want: number | null = null
      if (p.faceTo) {
        const target: Pt | null = typeof p.faceTo === 'string' ? posOf(p.faceTo) : p.faceTo
        if (target) want = angleTo(p.x, p.y, target[0], target[1])
      } else if (p.team === 'ours') {
        if (Math.hypot(p.vx, p.vy) > MOVING) want = angleTo(0, 0, p.vx, p.vy)
      } else if (lastBall) {
        want = angleTo(p.x, p.y, lastBall.x, lastBall.y)
      }
      if (want !== null) p.face = turn(p.face, want, FACE_RATE * H)
    }

    // 5. record
    const players: SimFrame['players'] = {}
    for (const id of ids) players[id] = { x: st[id].x, y: st[id].y, face: st[id].face }
    const frame: SimFrame = { t, players, ball: { x: 0, y: 0, flying: false, lift: 0, holder: null }, marks: [] }
    // (ball needs this frame's positions, so it is computed against `frame` before it is pushed)
    frames.push(frame)
    frame.ball = ballAt(t)
    lastBall = frame.ball
    for (const id of ids) {
      const r = st[id].rule
      if (r && r.type === 'mark' && !moved.has(id)) frame.marks.push({ from: id, to: r.attacker })
    }
  }

  passes.forEach((p) => {
    const i = step.passes.indexOf(p)
    if (i >= 0) passOrigins[i] = passOriginOf(p)
  })

  return { stepIndex, duration, frames, start, end: cloneState(st), passOrigins, holderStart }
}

// ---- timelines across steps (memoised per play object) ----
const cache = new WeakMap<Play, Map<number, StepTimeline>>()

export function getTimeline(play: Play, stepIndex: number): StepTimeline {
  const i = Math.min(Math.max(Math.trunc(stepIndex) || 0, 0), play.steps.length - 1)
  let perPlay = cache.get(play)
  if (!perPlay) cache.set(play, (perPlay = new Map()))
  const hit = perPlay.get(i)
  if (hit) return hit
  const base = baseStepIndex(play, i)
  const start = base < 0 ? initialState(play) : getTimeline(play, base).end
  const tl = simulateStep(play, i, start, ballHolderBefore(play, i))
  perPlay.set(i, tl)
  return tl
}

/** The recorded frame nearest to `t` seconds into the step (clamped). */
export function sampleTimeline(tl: StepTimeline, t: number): SimFrame {
  const idx = Math.min(tl.frames.length - 1, Math.max(0, Math.round(t / H)))
  return tl.frames[idx]
}
