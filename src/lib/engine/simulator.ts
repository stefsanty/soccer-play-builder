// Step simulator — port of the pattern-of-play reference engine, plus the defensive AI.
//
// A step is simulated at a fixed 60 Hz (H) from the state the previous step ended in, and recorded as
// frames, so playback can scrub/seek freely and the end state chains into the next step.
//   • our moves        : trapezoid tween along a line or a quadratic bezier (`via`)      (evalTw)
//   • ball             : stays on the holder (offset along their facing), flies on passes (bp/flight/ballAt)
//   • defenders        : rules — zone / mark / press / follow / ai — chased with speed VMAX and
//                        acceleration AMAX limits (gain per rule), then pairwise separation
//   • defensive AI     : engine/ai.ts picks targets for a team's free players; re-evaluated every
//                        AI_REFRESH seconds so the block keeps tracking the ball as it moves
//   • follow           : engine/follow.ts — a follower hands its attacker over when he leaves its bounds
//   • facing           : smooth turn towards a scheduled target (`faceTargets`), else movement / ball
// Rules and facing persist across steps until a new rule / face target takes effect.
//
// Pitch units are metres (x 0..68, y 0..105; the opponent goal is at y = 105). A facing angle `a` uses
// screen orientation: 0 = +x, -PI/2 = up the pitch (increasing y), so a point `d` ahead is (cos a, -sin a)*d.

import type { AiConfig, AiRole, DefenderRule, FaceTarget, PassAnimation, Play, PlayStep, PlayerMove } from '@/lib/types/play'
import { trapezoid } from '@/lib/engine/physics'
import { baseStepIndex, ballHolderBefore } from '@/lib/engine/ballHolder'
import { computeAiTargets, type AiWorld, type Duty, type Team } from '@/lib/engine/ai'
import { followTarget, newFollowTrack, pickHandoff, trackExit, type FollowTrack, type HandoffCandidate } from '@/lib/engine/follow'

type Pt = [number, number]

export const H = 1 / 60
export const VMAX = 6.8 // m/s, defender top speed
export const AMAX = 5.5 // m/s^2, defender acceleration limit
export const BALL_OFFSET = 1.35 // m, ball sits this far from the holder along their facing
export const AI_REFRESH = 0.25 // s between AI re-evaluations
export const AI_REACTION = 0.4 // s before the AI first engages in a step
/** Chase brakes with this share of the acceleration limit, so a defender stops on his target instead of running past it. */
const BRAKE = 0.85
/** Chase gain per rule type: desired speed = min(VMAX, distance * gain). */
export const GAINS = { zone: 2.5, mark: 2.2, follow: 2.2, press: 4.0, ai: 2.2 } as const
const FACE_RATE = 7 // rad/s
const SEPARATION = 1.8 // m, defenders closer than this are pushed apart outright — bodies cannot overlap
/**
 * Team-mates inside this ease apart. Targets are kept apart by the AI, but a player only ever STEERS towards
 * his target, so two who are both lagging can drift together even while their targets stay a dozen metres
 * apart — which is how two centre-backs end up standing on the same blade of grass. There is no situation
 * where a defender wants a team-mate's exact position, so the easing is on the positions themselves.
 */
const PERSONAL = 5
/** ...at a walking pace, so it nudges players apart over a moment instead of snapping them. */
const PERSONAL_V = 5.0 // m/s
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
  /** Follow-rule exit / cooldown tracking (reset every step). */
  fol: FollowTrack
  team: Team
}
export type SimState = Record<string, PlayerState>

export interface BallFrame {
  x: number
  y: number
  flying: boolean
  /** 0..1 arc height for lobs. */
  lift: number
  holder: string | null
  /** The holder, or the receiver of the pass in flight (null when there is no ball). */
  target: string | null
}

export interface SimFrame {
  t: number
  players: Record<string, { x: number; y: number; face: number }>
  ball: BallFrame
  /** Defenders currently marking / pressing / following an attacker: defender -> attacker. */
  marks: { from: string; to: string }[]
}

export type SimEvent =
  | {
      t: number
      type: 'handoff'
      /** The follower that gave the attacker up. */
      from: string
      /** Who took over (null = nobody). */
      to: string | null
      attacker: string
    }
  | {
      t: number
      type: 'presser'
      team: Team
      /** The AI presser before / after (null = nobody pressing). */
      from: string | null
      to: string | null
    }

export interface StepTimeline {
  stepIndex: number
  /** Simulated seconds (0 for a static step). */
  duration: number
  frames: SimFrame[]
  events: SimEvent[]
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
    s[p.id] = {
      x: p.x, y: p.y, vx: 0, vy: 0, face: p.team === 'ours' ? UP : DOWN,
      faceTo: null, rule: null, fol: newFollowTrack(), team: p.team,
    }
  }
  return s
}

const cloneState = (s: SimState): SimState =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, fol: { ...v.fol } }]))

const angleTo = (fx: number, fy: number, tx: number, ty: number) => Math.atan2(-(ty - fy), tx - fx)

function turn(from: number, to: number, maxStep: number): number {
  let d = to - from
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return from + Math.max(-maxStep, Math.min(maxStep, d))
}

/** +1 when the defending team's goal is at +y ('opp'), -1 for 'ours'. */
const goalDirOf = (team: Team): 1 | -1 => (team === 'opp' ? 1 : -1)

/** Where a defender under `rule` wants to be, and how hard it chases. */
function ruleTarget(rule: DefenderRule, self: PlayerState, pos: (id: string) => Pt | null): { target: Pt; gain: number } {
  const dir = goalDirOf(self.team)
  switch (rule.type) {
    case 'zone':
      return { target: rule.target, gain: GAINS.zone }
    case 'mark': {
      const att = pos(rule.attacker)
      if (!att) return { target: rule.zone, gain: GAINS.mark }
      // Stand `gap` m goal-side of the attacker (negative = trailing him), `dx` m across, then blend from
      // the zone towards that point by `weight` (1 = full attention on the attacker).
      const mark: Pt = [att[0] + (rule.dx ?? 0), att[1] + dir * rule.gap]
      return {
        target: [rule.zone[0] + (mark[0] - rule.zone[0]) * rule.weight, rule.zone[1] + (mark[1] - rule.zone[1]) * rule.weight],
        gain: GAINS.mark,
      }
    }
    case 'press': {
      const att = pos(rule.att)
      if (!att) return { target: [self.x, self.y], gain: GAINS.press }
      return { target: [att[0] + (rule.dx ?? 0), att[1] + dir * (rule.gap ?? 1.0)], gain: GAINS.press }
    }
    case 'follow': {
      const att = pos(rule.att)
      return { target: att ? followTarget(rule, att, dir) : rule.zone, gain: GAINS.follow }
    }
    case 'ai':
      return { target: rule.x !== undefined && rule.y !== undefined ? [rule.x, rule.y] : [self.x, self.y], gain: rule.gain ?? GAINS.ai }
  }
}

/** The attacker a rule is watching, if any. */
const ruleAttacker = (r: DefenderRule | null): string | null =>
  !r ? null : r.type === 'mark' ? r.attacker : r.type === 'press' || r.type === 'follow' ? r.att : null

/** Simulate `play.steps[stepIndex]` from `start`. `startBall` pins the ball position at frame 0 so it
 * inherits exactly from where the previous step ended rather than being recomputed from the holder's facing. */
export function simulateStep(play: Play, stepIndex: number, start: SimState, holderStartIn: string | null, startBall?: Pt): StepTimeline {
  const step: PlayStep = play.steps[stepIndex]
  const duration = step.duration > 0 ? step.duration : 0
  const n = Math.round(duration / H)
  const st = cloneState(start)
  const ids = Object.keys(st)
  for (const id of ids) st[id].fol = newFollowTrack() // trackers and cooldowns are per step

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
  const authoredIds = new Set(Object.keys(step.defenderRules))
  const passes: PassAnimation[] = [...step.passes].sort((a, b) => a.startTime - b.startTime)
  const passOrigins: Pt[] = step.passes.map(() => [0, 0])
  // a step that opens with a pass starts with the ball at the passer
  const holderStart = passes.length > 0 && st[passes[0].from] ? passes[0].from : holderStartIn

  // ---- defensive AI bookkeeping ----
  const teams: Team[] = ['ours', 'opp']
  const aiConfig = (team: Team): AiConfig | undefined => step.ai?.[team]
  const nextRefresh: Record<Team, number> = {
    ours: aiConfig('ours')?.on ? (aiConfig('ours')?.reaction ?? AI_REACTION) : 0,
    opp: aiConfig('opp')?.on ? (aiConfig('opp')?.reaction ?? AI_REACTION) : 0,
  }
  const labels = Object.fromEntries(play.players.map((p) => [p.id, p.label]))
  const homes = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
  const memory: AiWorld['memory'] = {}
  const events: SimEvent[] = []

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
        return { x: f.x, y: f.y, flying: true, lift: f.lift, holder: null, target: p.to }
      }
      h = p.to
    }
    if (!h || !st[h]) return { x: 0, y: 0, flying: false, lift: 0, holder: null, target: null }
    const q = bp(h, t)
    return { x: q[0], y: q[1], flying: false, lift: 0, holder: h, target: h }
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
  const posOf = (id: string): Pt | null => (st[id] ? [st[id].x, st[id].y] : null)
  const isKeeper = (id: string) => /gk/i.test(labels[id] ?? '')

  const handoffLocked = new Set<string>() // handoff receivers: the AI leaves them on their new job
  const lastPresser: Partial<Record<Team, string | null>> = {}
  /** The marking / pressing / following job a player's current rule gives him. */
  const dutyOf = (id: string): Duty | null => {
    const r = st[id].rule
    if (!r) return null
    if (r.type === 'press' || r.type === 'follow') return { type: r.type, att: r.att }
    if (r.type === 'mark') return { type: 'mark', att: r.attacker }
    return null
  }

  /** Re-evaluate the defensive AI for `team` and hand each driven player its new target. */
  const refreshAi = (team: Team, t: number) => {
    const cfg = aiConfig(team)
    // authored ai(delay, role) rules: those players are AI-driven even when the team switch is off
    const forced: Record<string, AiRole> = {}
    for (const id of ids) {
      const r = st[id].rule
      if (st[id].team === team && authoredIds.has(id) && r?.type === 'ai') forced[id] = r.role ?? 'auto'
    }
    if (!cfg?.on && Object.keys(forced).length === 0) return
    const hasBall = lastBall && (lastBall.holder || lastBall.flying)
    // The block reacts to where the ball is going: while a pass is in flight the AI plays the receiver as the ball,
    // so the line is already dropping (and the receiver being closed down) when the ball arrives.
    const receiver = lastBall?.flying && lastBall.target ? st[lastBall.target] : null
    const world: AiWorld = {
      ball: hasBall ? (receiver ? { x: receiver.x, y: receiver.y } : { x: lastBall!.x, y: lastBall!.y }) : null,
      memory,
      owner: hasBall && lastBall!.target ? (st[lastBall!.target]?.team ?? null) : null,
      focus: hasBall ? lastBall!.target : null,
      t,
      locked: handoffLocked,
      players: ids.map((id) => ({
        id, team: st[id].team, label: labels[id] ?? id, x: st[id].x, y: st[id].y,
        home: homes[id] ?? [st[id].x, st[id].y], duty: dutyOf(id),
      })),
    }
    const targets = computeAiTargets(world, team, step, cfg ?? { on: false }, forced)
    let presser: string | null = null
    for (const [id, tg] of Object.entries(targets)) {
      if (tweens.has(id)) continue
      if (tg.role === 'presser') presser = id
      st[id].rule = { type: 'ai', role: forced[id] ?? tg.role, x: tg.x, y: tg.y, gain: tg.gain, delay: 0 }
    }
    if (Object.keys(targets).length > 0 && (lastPresser[team] ?? null) !== presser) {
      events.push({ t, type: 'presser', team, from: lastPresser[team] ?? null, to: presser })
      lastPresser[team] = presser
    }
  }

  /** A follower's attacker has left its bounds: revert to the zone and let someone else pick him up. */
  const handOff = (id: string, t: number) => {
    const me = st[id]
    const rule = me.rule
    if (!rule || rule.type !== 'follow') return
    me.rule = { type: 'zone', target: rule.zone, delay: 0 }
    const att = posOf(rule.att)
    const mode = rule.handoff ?? 'auto'
    let to: string | null = null
    if (att && mode !== 'none') {
      const dir = goalDirOf(me.team)
      if (mode === 'auto') {
        const candidates: HandoffCandidate[] = ids
          .filter((cid) => cid !== id && st[cid].team === me.team && !isKeeper(cid) && !tweens.has(cid)
            && st[cid].fol.cooldownUntil <= t && ruleAttacker(st[cid].rule) !== rule.att)
          .map((cid) => ({ id: cid, pos: [st[cid].x, st[cid].y] as Pt, bounds: st[cid].rule?.type === 'follow' ? st[cid].rule.bounds : undefined }))
        to = pickHandoff(candidates, att, dir)
      } else if (st[mode] && st[mode].team === me.team && !tweens.has(mode)) {
        to = mode
      }
      if (to) {
        const c = st[to]
        const cr = c.rule
        handoffLocked.add(to)
        c.fol = newFollowTrack()
        if (cr?.type === 'follow') c.rule = { ...cr, att: rule.att, delay: 0 }
        else {
          const zone: Pt = cr?.type === 'zone' ? cr.target : cr?.type === 'mark' ? cr.zone : [c.x, c.y]
          c.rule = { type: 'mark', attacker: rule.att, gap: rule.gap ?? 2.5, weight: rule.w ?? 0.85, zone, delay: 0, ...(rule.dx !== undefined && { dx: rule.dx }) }
        }
      }
    }
    events.push({ t, type: 'handoff', from: id, to, attacker: rule.att })
  }

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

    // 2. rules: activate due authored rules, refresh the AI, resolve follow handoffs, then chase the targets
    for (const q of ruleQueues) {
      while (q.next < q.rules.length && (q.rules[q.next].delay ?? 0) <= t + 1e-9) {
        if (st[q.id]) st[q.id].rule = q.rules[q.next]
        q.next++
      }
    }
    for (const team of teams) {
      if (t >= nextRefresh[team] - 1e-9) {
        refreshAi(team, t)
        nextRefresh[team] = t + AI_REFRESH
      }
    }
    for (const id of ids) {
      const p = st[id]
      if (moved.has(id) || p.rule?.type !== 'follow') continue
      const att = posOf(p.rule.att)
      if (att && trackExit(p.fol, p.rule, att, t)) handOff(id, t)
    }

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
      const { target, gain } = ruleTarget(p.rule, p, posOf)
      const dx = target[0] - p.x
      const dy = target[1] - p.y
      const d = Math.hypot(dx, dy)
      const speed = Math.min(VMAX, d * gain, Math.sqrt(2 * AMAX * BRAKE * d)) // brake early enough to stop on the target
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

    // 3. separation between free players of the SAME team (teammates never stack on one spot; a presser may
    //    close right down on his opponent, whichever team is defending)
    const free = ids.filter((id) => !moved.has(id) && (st[id].team === 'opp' || st[id].rule))
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = st[free[i]]
        const b = st[free[j]]
        if (a.team !== b.team) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d >= PERSONAL || d <= 1e-6) continue
        // inside SEPARATION they are overlapping and are separated outright; beyond it they merely ease apart
        const want = (Math.min(PERSONAL, SEPARATION + (PERSONAL - SEPARATION)) - d) / 2
        const push = d < SEPARATION ? (SEPARATION - d) / 2 : Math.min(want, PERSONAL_V * H)
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
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
    const frame: SimFrame = { t, players, ball: { x: 0, y: 0, flying: false, lift: 0, holder: null, target: null }, marks: [] }
    // (ball needs this frame's positions, so it is computed against `frame` before it is pushed)
    frames.push(frame)
    frame.ball = ballAt(t)
    // step N (N>0): pin the ball at frame 0 to the exact position the previous step ended on
    if (k === 0 && startBall) frame.ball = { ...frame.ball, x: startBall[0], y: startBall[1] }
    // defenders only watch a ball that exists (a play without passes has none)
    lastBall = frame.ball.holder || frame.ball.flying ? frame.ball : null
    for (const id of ids) {
      const att = ruleAttacker(st[id].rule)
      if (att && !moved.has(id)) frame.marks.push({ from: id, to: att })
    }
  }

  passes.forEach((p) => {
    const i = step.passes.indexOf(p)
    if (i >= 0) passOrigins[i] = passOriginOf(p)
  })

  return { stepIndex, duration, frames, events, start, end: cloneState(st), passOrigins, holderStart }
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
  const baseTl = base < 0 ? null : getTimeline(play, base)
  const start = baseTl ? baseTl.end : initialState(play)
  const lastBallFrame = baseTl?.frames.at(-1)?.ball
  const startBall: Pt | undefined = lastBallFrame ? [lastBallFrame.x, lastBallFrame.y] : undefined
  const tl = simulateStep(play, i, start, ballHolderBefore(play, i), startBall)
  perPlay.set(i, tl)
  return tl
}

/** The recorded frame nearest to `t` seconds into the step (clamped). */
export function sampleTimeline(tl: StepTimeline, t: number): SimFrame {
  const idx = Math.min(tl.frames.length - 1, Math.max(0, Math.round(t / H)))
  return tl.frames[idx]
}
