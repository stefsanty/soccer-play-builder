// Attacking AI — team shape: where the off-ball teammates go while the user's command plays out.
//
// The user commands one player (or a few). Everybody else on the attacking team is moved by this
// solver the way teammates move in Football Manager / FIFA / PES: the formation is a block anchored on
// the ball that lifts and slides with it a little every turn, and a few players near the ball break
// the shape for a support angle, a wide outlet, a run beyond, an overlap, or a box run on a shot.
// Football principles behind each rule: docs/attacking-ai-spec.md §2.
//
// Pure and deterministic: a function of the turn start, the formation homes and the user's queue.
// User commands always win — a commanded player, a pass receiver and the keeper are never moved.
// The moves fit inside the turn (they never make it longer) and are capped per turn so the team
// drifts in tandem with the ball instead of teleporting into an ideal shape.

import type { PlayerMove } from '@/lib/types/play'
import { PITCH_H, PITCH_W } from '@/lib/engine/pitch'
import { MIN_ACTION_S, MIN_TURN_S, MOVE_MPS, TURN_TAIL_S, holderAfter, type BuilderAction, type TurnSchedule } from '@/lib/engine/turnBuilder'

type Pt = [number, number]
type Team = 'ours' | 'opp'
export type LineRole = 'gk' | 'def' | 'mid' | 'fwd'

export type SupportReason =
  | 'shape'       // block lift / shift toward the formation slot
  | 'support'     // support angle beside-and-behind the carrier
  | 'wide'        // wide outlet ahead of the ball on the touchline
  | 'depth'       // run beyond the ball (third man)
  | 'overlap'     // outside the wide carrier
  | 'box'         // crash the box on a shot
  | 'second-ball' // edge of the box on a shot
  | 'rest'        // held back for rest defence

export interface SupportMove {
  playerId: string
  from: Pt
  to: Pt
  reason: SupportReason
  start: number
  end: number
}

export interface ShapeInput {
  players: { id: string; team: Team; label: string }[]
  /** Everyone at the turn start. */
  positions: Record<string, Pt>
  /** Kick-off formation spots (play.players) — the home shape. */
  homes: Record<string, Pt>
  attackingTeam: Team
  /** Ball holder at the turn start. */
  holder: string | null
  queue: BuilderAction[]
  /** scheduleTurn(queue, positions). */
  schedule: TurnSchedule
}

export type Phase = 'forward' | 'back' | 'lateral' | 'shot'

// ---- tunables (docs/attacking-ai-spec.md §4.6) ----
/** A gap of at least this much in home depth starts a new formation line. */
export const LINE_GAP_M = 8
/** A home this far from the centre line makes a player "wide" (holds width on the far side). */
export const WIDE_M = 18
/** How much of the ball's height above the midfield home line each line follows. */
export const LIFT: Record<Exclude<LineRole, 'gk'>, number> = { def: 0.6, mid: 1, fwd: 1 }
/** The defence never goes further than this (5 m past halfway): rest defence. */
export const DEF_MAX_DEPTH = PITCH_H / 2 + 5
export const SHIFT_K = 0.35
export const SHIFT_MAX = 10
/** Support angle: beside and behind the carrier. */
export const SUP_SIDE = 9
export const SUP_BACK = 5
/** The wide outlet sits this far ahead of the ball, on the touchline side. */
export const WIDE_AHEAD = 6
/** The run beyond the ball. */
export const DEPTH_RUN = 12
export const OVERLAP_OUT = 5
export const OVERLAP_AHEAD = 10
/** A deeper same-side wide player this far behind the carrier overlaps. */
export const OVERLAP_MIN_BEHIND = 5
export const OVERLAP_MAX_BEHIND = 35
/** A carrier this far from the centre line is "wide" (overlap trigger). */
export const CARRIER_WIDE_M = 16
/** With the ball this deep, the run beyond becomes a far-post run. */
export const BOX_DEPTH = 80
/** Per-turn cap on a shape move: the block drifts, it does not teleport. */
export const MAX_SHAPE_M = 12
/** Per-turn cap on a triggered run (support, wide, depth, overlap, box). */
export const MAX_RUN_M = 18
export const SPACING_M = 7
export const CLEAR_M = 4
export const DEADBAND_M = 2.5
export const REST_COUNT = 3
export const REST_BEHIND = 10
/** In a 'back' turn a forward or midfielder drops at most this share of the ball's retreat. */
export const BACK_HOLD = 0.5
export const OFFSIDE_MARGIN = 1
/** Only players this close to the ball's end are support / second-ball candidates. */
export const SUPPORT_REACH = 25
/** A slot already filled within this is skipped. */
export const SLOT_TAKEN_M = 5
/** A ball move shorter than this (up the pitch) is a 'lateral' turn, not 'forward' / 'back'. */
export const PHASE_DEADBAND = 3
const CENTRE_X = PITCH_W / 2
const EDGE_X = 4
const DEPTH_MIN = 3
const DEPTH_MAX = PITCH_H - 3
const CONSTRAINT_ROUNDS = 3

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const isKeeperLabel = (label: string) => /gk/i.test(label)

/** How long the turn lasts, the same way turnStep derives it (the AI moves must fit inside). */
export function turnDuration(schedule: Pick<TurnSchedule, 'length'>): number {
  return Math.max(MIN_TURN_S, schedule.length + TURN_TAIL_S)
}

export interface FormationLines {
  role: (id: string) => LineRole
  wide: (id: string) => boolean
  /** -1 left of centre, +1 right, 0 central. */
  side: (id: string) => -1 | 0 | 1
  /** Mean home depth of the midfield line (all outfielders when there is none). */
  midHomeDepth: number
  outfield: string[]
}

/**
 * Group a team's outfield players into formation lines by home depth (0 = deepest). The first line is
 * the defence, the last (when there are two or more) the forwards, the rest the midfield.
 */
export function formationLines(players: ShapeInput['players'], homes: Record<string, Pt>, team: Team): FormationLines {
  const depthOf = (y: number) => (team === 'ours' ? y : PITCH_H - y)
  const own = players.filter((p) => p.team === team)
  const keepers = new Set(own.filter((p) => isKeeperLabel(p.label)).map((p) => p.id))
  const outfield = own.filter((p) => !keepers.has(p.id) && homes[p.id]).map((p) => p.id)
  const depth = new Map(outfield.map((id) => [id, depthOf(homes[id][1])] as const))
  const sorted = [...outfield].sort((a, b) => depth.get(a)! - depth.get(b)!)
  const line = new Map<string, number>()
  let li = -1
  let last = -Infinity
  for (const id of sorted) {
    const d = depth.get(id)!
    if (d - last >= LINE_GAP_M) li++
    line.set(id, Math.max(li, 0))
    last = d
  }
  const count = li + 1
  const role = (id: string): LineRole => {
    if (keepers.has(id)) return 'gk'
    const l = line.get(id)
    if (l === undefined) return 'mid'
    if (count <= 1) return 'mid'
    if (l === 0) return 'def'
    if (l === count - 1) return 'fwd'
    return 'mid'
  }
  const mids = outfield.filter((id) => role(id) === 'mid')
  const pool = mids.length > 0 ? mids : outfield
  const midHomeDepth = pool.length > 0 ? pool.reduce((s, id) => s + depth.get(id)!, 0) / pool.length : PITCH_H / 3
  return {
    role,
    wide: (id) => !!homes[id] && Math.abs(homes[id][0] - CENTRE_X) >= WIDE_M,
    side: (id) => (!homes[id] ? 0 : homes[id][0] > CENTRE_X ? 1 : homes[id][0] < CENTRE_X ? -1 : 0),
    midHomeDepth,
    outfield,
  }
}

/** What kind of turn the user's queue makes: where the ball ends relative to where it started. */
export function turnPhase(advance: number, queue: BuilderAction[]): Phase {
  if (queue.some((a) => a.kind === 'shot')) return 'shot'
  if (advance > PHASE_DEADBAND) return 'forward'
  if (advance < -PHASE_DEADBAND) return 'back'
  return 'lateral'
}

interface Job {
  to: Pt // [x, depth]
  reason: SupportReason
}

/** Plan the off-ball teammates' moves for the queued turn. */
export function planTeamShape(input: ShapeInput): SupportMove[] {
  const { players, positions, homes, attackingTeam, holder, queue, schedule } = input
  if (!holder || !positions[holder] || queue.length === 0) return []
  const dir: 1 | -1 = attackingTeam === 'ours' ? 1 : -1
  const D = (y: number) => (dir === 1 ? y : PITCH_H - y)
  const Y = (d: number) => (dir === 1 ? d : PITCH_H - d)
  /** [x, depth] of a point. */
  const xd = (p: Pt): Pt => [p[0], D(p[1])]

  const lines = formationLines(players, homes, attackingTeam)
  const opp = players.filter((p) => p.team !== attackingTeam && positions[p.id])
  const planned = schedule.planned

  // 1. frozen: keeper, commanded players, pass receivers
  const frozen = new Set<string>()
  for (const p of players) if (p.team === attackingTeam && lines.role(p.id) === 'gk') frozen.add(p.id)
  for (const a of queue) {
    frozen.add(a.playerId)
    if (a.kind === 'pass') frozen.add(a.to)
  }
  const free = lines.outfield.filter((id) => !frozen.has(id) && positions[id])
  if (free.length === 0) return []

  // 2. ball story
  const lastShot = [...queue].reverse().find((a) => a.kind === 'shot')
  const endCarrier = holderAfter(holder, queue) ?? lastShot?.playerId ?? holder
  const ballEndPt = planned[endCarrier] ?? positions[endCarrier] ?? positions[holder]
  const ball = xd(ballEndPt)
  const advance = ball[1] - D(positions[holder][1])
  const phase = turnPhase(advance, queue)
  const ballSide: 1 | -1 = ball[0] >= CENTRE_X ? 1 : -1

  // offside line: the second-last opponent (keeper included), never inside our own half
  const oppDepths = opp.map((p) => D(positions[p.id][1])).sort((a, b) => b - a)
  const offsideCap = Math.max(PITCH_H / 2, (oppDepths[1] ?? oppDepths[0] ?? PITCH_H) - OFFSIDE_MARGIN)

  const lift = Math.max(0, ball[1] - lines.midHomeDepth)
  const shift = clamp((ball[0] - CENTRE_X) * SHIFT_K, -SHIFT_MAX, SHIFT_MAX)

  const cur = (id: string): Pt => xd(positions[id])
  const home = (id: string): Pt => xd(homes[id] ?? positions[id])

  // 3. shape target for every free player
  const shapeX = (id: string) => home(id)[0] + (lines.wide(id) && lines.side(id) !== ballSide ? 0 : shift)
  const shapeTarget = (id: string): Pt => {
    const role = lines.role(id) as Exclude<LineRole, 'gk'>
    const c = cur(id)
    let d = home(id)[1] + lift * LIFT[role]
    if (role === 'def') d = Math.min(d, DEF_MAX_DEPTH)
    if (phase === 'back') {
      if (role === 'def') return c
      d = Math.max(d, c[1] - Math.abs(advance) * BACK_HOLD)
    } else if (phase === 'forward') {
      // the ball goes forward: nobody drops
      d = Math.max(d, c[1])
    }
    return [shapeX(id), d]
  }

  const jobs = new Map<string, Job>()
  const frozenFinal = [...frozen].filter((id) => planned[id] || positions[id]).map((id) => xd(planned[id] ?? positions[id]))
  const taken = (slot: Pt) =>
    frozenFinal.some((p) => dist(p, slot) < SLOT_TAKEN_M) || [...jobs.values()].some((j) => dist(j.to, slot) < SLOT_TAKEN_M)
  const nearest = (ids: string[]) => [...ids].sort((a, b) => dist(cur(a), ball) - dist(cur(b), ball) || lines.outfield.indexOf(a) - lines.outfield.indexOf(b))
  const fwds = free.filter((id) => lines.role(id) === 'fwd')
  const nonFwd = free.filter((id) => lines.role(id) !== 'fwd')
  const farPost: Pt = [CENTRE_X - ballSide * 8, 99]
  const nearPost: Pt = [CENTRE_X + ballSide * 8, 99]
  const penSpot: Pt = [CENTRE_X, 94]

  // 4. support cast
  if (phase === 'shot') {
    for (const id of nearest(fwds)) {
      const slots = [nearPost, farPost, penSpot].filter((s) => !taken(s)).sort((a, b) => dist(cur(id), a) - dist(cur(id), b))
      if (slots[0]) jobs.set(id, { to: slots[0], reason: 'box' })
    }
    const edges: Pt[] = [[CENTRE_X - 10, 85], [CENTRE_X + 10, 85]]
    for (const id of nearest(nonFwd.filter((id) => lines.role(id) === 'mid' && dist(cur(id), ball) <= SUPPORT_REACH))) {
      const slots = edges.filter((s) => !taken(s)).sort((a, b) => dist(cur(id), a) - dist(cur(id), b))
      if (slots[0]) jobs.set(id, { to: slots[0], reason: 'second-ball' })
    }
  } else if (phase !== 'back') {
    // the run beyond: the nearest free forward
    const runner = nearest(fwds)[0]
    if (runner) {
      const c = cur(runner)
      const slot: Pt = ball[1] >= BOX_DEPTH ? farPost : [c[0] + (ball[0] - c[0]) * 0.3, ball[1] + DEPTH_RUN]
      jobs.set(runner, { to: slot, reason: 'depth' })
    }
    // the overlap: a deeper wide player on the carrier's side
    if (Math.abs(ball[0] - CENTRE_X) >= CARRIER_WIDE_M) {
      const behind = (id: string) => ball[1] - cur(id)[1]
      const cands = nearest(free.filter((id) => !jobs.has(id) && lines.wide(id) && lines.side(id) === ballSide && behind(id) >= OVERLAP_MIN_BEHIND && behind(id) <= OVERLAP_MAX_BEHIND))
      if (cands[0]) jobs.set(cands[0], { to: [clamp(ball[0] + ballSide * OVERLAP_OUT, EDGE_X, PITCH_W - EDGE_X), ball[1] + OVERLAP_AHEAD], reason: 'overlap' })
    }
    // two support angles: midfielders first, defenders only when no midfielder is near
    const cands = nearest(nonFwd.filter((id) => !jobs.has(id) && dist(cur(id), ball) <= SUPPORT_REACH)).sort(
      (a, b) => (lines.role(a) === 'def' ? 1 : 0) - (lines.role(b) === 'def' ? 1 : 0) || dist(cur(a), ball) - dist(cur(b), ball),
    )
    let given = 0
    for (const id of cands) {
      if (given >= 2) break
      if (lines.wide(id)) {
        const slot: Pt = [shapeX(id), ball[1] + WIDE_AHEAD]
        if (taken(slot)) continue
        jobs.set(id, { to: slot, reason: 'wide' })
        given++
        continue
      }
      const c = cur(id)
      const s: 1 | -1 = c[0] - ball[0] > 0 ? 1 : -1
      const own: Pt = [ball[0] + s * SUP_SIDE, ball[1] - SUP_BACK]
      const other: Pt = [ball[0] - s * SUP_SIDE, ball[1] - SUP_BACK]
      const slot = !taken(own) ? own : !taken(other) ? other : null
      if (!slot) continue
      jobs.set(id, { to: slot, reason: 'support' })
      given++
    }
  }

  // targets: jobs win, everyone else is on shape
  const target = new Map<string, Pt>()
  const reason = new Map<string, SupportReason>()
  for (const id of free) {
    const j = jobs.get(id)
    target.set(id, j ? [...j.to] : shapeTarget(id))
    reason.set(id, j ? j.reason : 'shape')
  }

  // 5. rest defence: three outfielders at least REST_BEHIND behind a ball in the opponent half
  if (phase !== 'back' && ball[1] > PITCH_H / 2) {
    const limit = ball[1] - REST_BEHIND
    const count = () =>
      lines.outfield.filter((id) => {
        const p = frozen.has(id) ? xd(planned[id] ?? positions[id]) : target.get(id)
        return !!p && p[1] <= limit + 1e-9
      }).length
    const holdable = free.filter((id) => !jobs.has(id)).sort((a, b) => target.get(a)![1] - target.get(b)![1] || lines.outfield.indexOf(a) - lines.outfield.indexOf(b))
    for (const id of holdable) {
      if (count() >= REST_COUNT) break
      const t = target.get(id)!
      if (t[1] > limit) {
        target.set(id, [t[0], limit])
        reason.set(id, 'rest')
      }
    }
  }

  // 6. constraints
  const duration = turnDuration(schedule)
  const capOf = (id: string) => Math.min(reason.get(id) === 'shape' || reason.get(id) === 'rest' ? MAX_SHAPE_M : MAX_RUN_M, MOVE_MPS * duration)
  const capMove = (id: string) => {
    const c = cur(id)
    const t = target.get(id)!
    const d = dist(c, t)
    const cap = capOf(id)
    if (d > cap) target.set(id, [c[0] + ((t[0] - c[0]) * cap) / d, c[1] + ((t[1] - c[1]) * cap) / d])
  }
  const bound = (id: string) => {
    const t = target.get(id)!
    target.set(id, [clamp(t[0], EDGE_X, PITCH_W - EDGE_X), clamp(t[1], DEPTH_MIN, Math.min(DEPTH_MAX, offsideCap))])
  }
  const finalOf = (id: string): Pt | null => (free.includes(id) ? target.get(id)! : planned[id] ? xd(planned[id]) : positions[id] ? xd(positions[id]) : null)
  const oppStarts = opp.map((p) => xd(positions[p.id]))

  for (const id of free) {
    capMove(id)
    bound(id)
  }
  for (let round = 0; round < CONSTRAINT_ROUNDS; round++) {
    // spacing between attackers: the free one(s) give way
    for (let i = 0; i < lines.outfield.length; i++) {
      for (let j = i + 1; j < lines.outfield.length; j++) {
        const a = lines.outfield[i]
        const b = lines.outfield[j]
        const pa = finalOf(a)
        const pb = finalOf(b)
        if (!pa || !pb) continue
        const d = dist(pa, pb)
        if (d >= SPACING_M) continue
        const aFree = free.includes(a)
        const bFree = free.includes(b)
        if (!aFree && !bFree) continue
        let ux: number
        let uy: number
        if (d < 1e-6) {
          ux = 0
          uy = -1
        } else {
          ux = (pb[0] - pa[0]) / d
          uy = (pb[1] - pa[1]) / d
        }
        const gap = SPACING_M - d
        const share = aFree && bFree ? gap / 2 : gap
        if (aFree) target.set(a, [pa[0] - ux * share, pa[1] - uy * share])
        if (bFree) target.set(b, [pb[0] + ux * share, pb[1] + uy * share])
      }
    }
    // clearance from the opponents' start positions: a sideways step (depth is what the shape, the
    // offside line and the rest defence care about — you find space beside a defender, not past him)
    for (const id of free) {
      for (const o of oppStarts) {
        const t = target.get(id)!
        if (dist(t, o) >= CLEAR_M) continue
        const dy = t[1] - o[1]
        const need = Math.sqrt(Math.max(0, CLEAR_M * CLEAR_M - dy * dy))
        const sx = t[0] - o[0] >= 0 ? 1 : -1
        target.set(id, [o[0] + sx * need, t[1]])
      }
    }
    for (const id of free) bound(id)
  }
  for (const id of free) {
    capMove(id)
    bound(id)
  }

  // 7. deadband and timing
  const out: SupportMove[] = []
  for (const id of free) {
    const from = positions[id]
    const t = target.get(id)!
    const to: Pt = [t[0], Y(t[1])]
    const d = dist(from, to)
    if (d < DEADBAND_M) continue
    out.push({ playerId: id, from: [from[0], from[1]], to, reason: reason.get(id)!, start: 0, end: Math.min(duration, Math.max(MIN_ACTION_S, d / MOVE_MPS)) })
  }
  return out
}

/** The AI moves as step moves: a jog, drawn by the builder itself (hidden from the editor / viewer arrows). */
export function supportMovesToPlayerMoves(moves: SupportMove[]): PlayerMove[] {
  return moves.map((m) => ({ playerId: m.playerId, toX: m.to[0], toY: m.to[1], startTime: m.start, endTime: m.end, runningSpeed: 'jog', hidden: true }))
}
