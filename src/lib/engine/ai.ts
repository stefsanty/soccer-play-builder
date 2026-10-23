// Defensive AI: where each player of a team should be, given the ball.
//
//   computeAiTargets(S, team, step, config, forced?) -> { playerId: { x, y, gain, role } }
//
// Pitch frame: x 0..68, y 0..105. 'opp' defends the goal at y = 105 (goal-side = +y); 'ours' defends
// y = 0 (goal-side = -y). Depths are measured from the defending team's own goal line:
//   dBall = 105 - ball.y for 'opp', ball.y for 'ours'.
//
// Three 0-100 controls shape the behaviour (see resolveAiParams):
//   aggressiveness  how readily defenders break shape to press (radius, gains, how many break)
//   lineHeight      explicit height of the back line, blended with the ball-driven height
//   width           how wide the block holds and how far it may slide sideways
// `intensity` (low / mid / high) is the old quick-set: it maps to aggressiveness 20 / 50 / 80.
//
// DEFENDING (the other team has the ball): the line height blends the ball-driven depth (see lineDepth) with the
// lineHeight target, and is always kept goal-side of the ball. The block slides sideways towards the ball and
// exactly ONE player presses, with a cover behind him; at high aggressiveness the block squeezes further towards
// the ball side as a unit rather than sending a second chaser (shape over chase). Everyone else who is not in the
// back line steps onto an OPEN passing lane out of the carrier (see passingLaneOpen), nearest his own zone first,
// and the keeper tracks the ball.
// IN POSSESSION (the team's own player has the ball, or it is on its way to one): there is nobody to defend
// against, so the team holds its shape high instead of collapsing around its own ball: no presser, no cover, no
// lane screens, and the line is not bound to sit behind the ball.

import type { AiConfig, AiRole, PlayStep } from '@/lib/types/play'

export type XY = [number, number]
export type Team = 'ours' | 'opp'
export type Intensity = 'low' | 'mid' | 'high'

/** What an authored rule currently has a player doing (press / mark / follow someone). */
export interface Duty {
  type: 'press' | 'mark' | 'follow'
  att: string
}

export interface AiWorldPlayer {
  id: string
  team: Team
  label: string
  x: number
  y: number
  /** Formation home position: the shape the block keeps. */
  home: XY
  /** The marking / pressing / following job this player is on right now, if any. */
  duty?: Duty | null
}

/** What the AI looks at. `memory` survives between calls (presser hysteresis). */
export interface AiWorld {
  players: AiWorldPlayer[]
  /** Ball position; null = no ball in play (the AI then does nothing). */
  ball: { x: number; y: number } | null
  memory: { presser?: Partial<Record<Team, string>> }
  /** Team that has (or is about to receive) the ball. null = unknown. */
  owner?: Team | null
  /** The player holding the ball, or the receiver of the pass in flight. */
  focus?: string | null
  /** Seconds into the step (decides whether a delayed authored rule has taken over yet). */
  t?: number
  /** Players another system (a follow handoff) has put on a job: the AI leaves them alone. */
  locked?: ReadonlySet<string>
}

export interface AiTarget {
  x: number
  y: number
  gain: number
  role: Exclude<AiRole, 'auto'>
  /** For a `screen`: the opponent whose pass this player is cutting. */
  lane?: string
}

/** Reference rows for the old low / mid / high presets (aggressiveness 20 / 50 / 80 interpolate between them). */
export const INTENSITY = {
  // OFFSET (how far the line sits goal-side of the ball) is superseded by the ball-depth rules in lineDepth();
  // it is kept as a tuning reference.
  low: { OFFSET: 14, MAXLINE: 32, COMPACT: 0.55, PRESS_R: 8, SHIFT_K: 0.4, SHIFT_MAX: 10 },
  mid: { OFFSET: 11, MAXLINE: 42, COMPACT: 0.65, PRESS_R: 12, SHIFT_K: 0.45, SHIFT_MAX: 12 },
  high: { OFFSET: 8, MAXLINE: 54, COMPACT: 0.75, PRESS_R: 18, SHIFT_K: 0.5, SHIFT_MAX: 14 },
} as const

/** Quick-set bundles: tapping Low / Mid / High in the editor sets all three sliders. */
export const PRESETS = {
  low: { aggressiveness: 20, lineHeight: 30, width: 40 },
  mid: { aggressiveness: 50, lineHeight: 50, width: 50 },
  high: { aggressiveness: 80, lineHeight: 70, width: 60 },
} as const

/** The closest defender presses without any radius check when the ball is at least this deep (dBall). */
export const URGENT_DBALL = 80
export const GAIN = { press: 4.0, cover: 2.6, screen: 2.4, block: 2.2, gk: 1.8 } as const
/** Neighbours in a line may be at most their formation spacing plus this far apart. */
export const GAP_SLACK = 4
/** A defender this close to a pass's straight line is counted as covering it (metres). */
export const LANE_BLOCK_R = 3.5
/** As the back line pushes up it takes over any attacker it comes this close to, freeing that attacker's screener. */
export const HANDOFF_R = 6
/** A wide player only shadows a receiver this close in x to his own slot: he cuts lanes, he does not leave the flank. */
export const WIDE_LANE_REACH = 12
/** Shorter than this there is no lane to cut: the "receiver" is the carrier's own feet, and going there is pressing. */
export const MIN_LANE = 8
/**
 * What an open lane is worth to the man weighing it up (see laneValue).
 *   base      every uncovered lane is worth cutting at all
 *   affinity  ...and worth more to a slot of its own width, which is what sends wingers to the wide ones
 *   travel    ...less whatever it costs him to get there, as a share of LANE_REACH
 */
export const LANE_VALUE = { base: 1, affinity: 1.4, travel: 3.5 } as const
/** How far sideways the cover may come off his own slot to get behind the press. */
const COVER_REACH = 8
/** How far a cutter will step off his own slot to get onto a lane. Past this he holds his position instead. */
export const LANE_REACH = 18
/** Neighbours may be this much further apart than their formation spacing before cohesion starts pulling. */
export const NEIGHBOUR_SLACK = 5
/** How many formation neighbours each player is tied to. */
const NEIGHBOURS = 2
/** The least depth between one formation line and the next, so a compressing block never interleaves. */
export const LINE_MIN_GAP = 7
/** A slot nearer the middle than this is a central one, and is held there. */
const CENTRAL_OFF = 10
/** A slot this far off centre is a flank slot: its job is the wide outlet, so it holds its lateral position.
 *  Between the two sits a centre-back, who slides with the ball under neither rule. */
const WIDE_OFF = 16
/** How far towards the centre a flank player may ever come off his slot: at width 100 / at width 0. */
export const WIDE_HOLD = { tight: 2, loose: 10 } as const
/**
 * The sideways slide is full strength within `full` metres of the ball and has died away by `none`. `floor` is
 * how much of it the far side still feels at width 0, so a compact block narrows as a whole.
 */
export const BALL_PULL = { full: 12, none: 40, floor: 0.3 } as const
/** An opponent further than this from a player's slot exerts no gravity on him at all. */
export const GRAVITY_R = 15
/** Gravity aims this far goal-side of the opponent, so the defender ends up between him and the goal. */
const GRAVITY_GAP = 2
/** How far from his slot the push away from an already-covered opponent aims. */
const REPEL_STEP = 10
/**
 * What a player holding shape wants, and how much. These are weighed against each other in one place (see
 * solveShape) rather than applied as a chain of overrides, so no one of them can quietly undo another.
 *   slot       stand where the formation puts you
 *   ball       slide towards the ball side, fading with distance from the ball
 *   gravity    stick to an opponent near your zone, stronger the closer he is
 *   neighbour  come back into contact when the shape is stretched
 * `ballPress` multiplies the ball pull while a hard press is on: the block squeezes as a unit instead of
 * sending a second chaser after the carrier.
 */
export const W = { slot: 1, ball: 2.5, gravity: 2.8, repel: 0.5, neighbour: 0.9, displace: 3.0, ballPress: 1.6 } as const
/** How many times the weighed pulls are re-solved; neighbours move, so it settles rather than resolving once. */
const SOLVE_PASSES = 4

const PITCH_W = 68
const PITCH_H = 105
const CENTRE_X = 34
const HYSTERESIS = 3
const LINE_GAP = 5 // m of home depth that separates one line from the next
const ENGAGED_R = 3 // an authored job on someone this close to the ball counts as "engaging the ball"

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])
const isGk = (p: AiWorldPlayer) => /gk/i.test(p.label)

/** Piecewise-linear through three anchors at positions p0 < p1 < p2 (clamped outside). */
const tri = (v: number, [p0, p1, p2]: [number, number, number], [y0, y1, y2]: [number, number, number]) =>
  v <= p1 ? lerp(y0, y1, clamp((v - p0) / (p1 - p0), 0, 1)) : lerp(y1, y2, clamp((v - p1) / (p2 - p1), 0, 1))

/**
 * The point of the finite segment `a`-`b` closest to `p`, with `minFromA` metres of it next to `a` ruled out
 * (a lane cutter uses that to stay off the carrier's feet).
 */
export function closestPointOnSegment(p: XY, a: XY, b: XY, minFromA = 0): XY {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return [a[0], a[1]]
  const len = Math.sqrt(lenSq)
  const lo = Math.min(minFromA / len, 1)
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq, lo, 1)
  return [a[0] + t * dx, a[1] + t * dy]
}

/**
 * Distance from `p` to the finite segment `a`-`b`. Beyond either end it is the distance to that end, so a
 * defender standing past the receiver does not count as being on the pass.
 */
export function distPointToSegment(p: XY, a: XY, b: XY): number {
  return dist(p, closestPointOnSegment(p, a, b))
}

/**
 * Is the straight pass from `carrier` to `receiver` on? It is open while every blocker is further than
 * `threshold` from the line between them — a defender inside that corridor is close enough to read and
 * intercept the ball. Pass the blockers who are actually holding position: a presser on his way to the ball
 * has left the lane he happens to be standing in.
 */
export function passingLaneOpen(carrier: XY, receiver: XY, blockers: readonly XY[], threshold = LANE_BLOCK_R): boolean {
  return blockers.every((b) => distPointToSegment(b, carrier, receiver) > threshold)
}

export interface AiParams {
  aggressiveness: number
  lineHeight: number
  width: number
  // from aggressiveness
  pressR: number
  presserGain: number
  coverGain: number
  /** The closest defender presses without a radius check when the ball is within this many metres of his goal. */
  nearGoalR: number
  /** How many players besides the presser break shape: 0 none, 1 the cover, 2 the cover and the nearest midfielder. */
  pressBreakers: 0 | 1 | 2
  /** Share of the ball-driven line height in the blend with the lineHeight target. */
  blendWeight: number
  // from the old intensity rows, interpolated by aggressiveness
  maxLine: number
  compact: number
  shiftK: number
  // from width
  shiftMax: number
  /** Wide players are held at least this far in from the touchlines (3 m + this). */
  widthInward: number
  // from lineHeight
  targetLineD: number
}

/**
 * Turn the config into numbers. `aggressiveness` wins over `intensity` (low / mid / high = 20 / 50 / 80);
 * `lineHeight` and `width` default to 50. At the defaults (50 / 50 / 50) pressing matches the old "mid" preset.
 * Values at aggressiveness 0 / 50 / 100 are exactly the rows of the spec table; between them they interpolate.
 */
export function resolveAiParams(cfg: Pick<AiConfig, 'intensity' | 'aggressiveness' | 'lineHeight' | 'width'> = {}): AiParams {
  const aggressiveness = clamp(cfg.aggressiveness ?? PRESETS[cfg.intensity ?? 'mid'].aggressiveness, 0, 100)
  const lineHeight = clamp(cfg.lineHeight ?? 50, 0, 100)
  const width = clamp(cfg.width ?? 50, 0, 100)
  const a = aggressiveness / 100
  const at = (lo: number, mid: number, hi: number) => tri(aggressiveness, [0, 50, 100], [lo, mid, hi])
  const fromIntensity = (k: 'MAXLINE' | 'COMPACT' | 'SHIFT_K') =>
    tri(aggressiveness, [20, 50, 80], [INTENSITY.low[k], INTENSITY.mid[k], INTENSITY.high[k]])
  const w = width / 100
  return {
    aggressiveness,
    lineHeight,
    width,
    pressR: at(4, 12, 22),
    presserGain: at(2.5, 4.0, 6.0),
    coverGain: at(2.0, 2.6, 3.5),
    nearGoalR: at(8, 15, 40),
    pressBreakers: a < 0.4 ? 0 : a < 0.7 ? 1 : 2,
    blendWeight: lerp(0.3, 0.7, a),
    maxLine: fromIntensity('MAXLINE'),
    compact: fromIntensity('COMPACT'),
    shiftK: fromIntensity('SHIFT_K'),
    shiftMax: lerp(6, 18, w),
    widthInward: lerp(12, 0, w),
    targetLineD: lerp(8, 55, lineHeight / 100),
  }
}

/**
 * Depth of the ball-driven defensive line from the defending goal, for a ball `dBall` metres from it.
 * Deep and compact when the ball is close to goal, higher as the ball moves away, never ahead of the ball.
 * `max` is the highest the line may sit (a preset name, or MAXLINE in metres).
 */
export function lineDepth(dBall: number, max: Intensity | number = 'mid'): number {
  const MAXLINE = typeof max === 'number' ? max : INTENSITY[max].MAXLINE
  let d: number
  if (dBall < 20) d = 8
  else if (dBall < 35) d = lerp(8, MAXLINE * 0.5, (dBall - 20) / 15)
  else if (dBall < 60) d = lerp(MAXLINE * 0.5, MAXLINE * 0.8, (dBall - 35) / 25)
  else if (dBall < 80) d = lerp(MAXLINE * 0.8, MAXLINE, (dBall - 60) / 20)
  else d = MAXLINE
  // defence is always goal-side of the ball (floor of 2 m keeps it off the goal line)
  return Math.max(2, Math.min(d, dBall - 2))
}

/**
 * The line height actually used: the ball-driven depth blended with the lineHeight target (the ball dominates
 * more as aggressiveness rises), then kept goal-side of the ball. In possession the "ball-driven" height is the
 * team's maximum line and the ball does not limit it.
 */
export function blendedLineDepth(dBall: number, p: Pick<AiParams, 'targetLineD' | 'blendWeight' | 'maxLine'>, inPossession = false): number {
  if (inPossession) return lerp(p.targetLineD, p.maxLine, p.blendWeight)
  const ball = lineDepth(dBall, p.maxLine)
  return Math.max(2, Math.min(lerp(p.targetLineD, ball, p.blendWeight), dBall - 2))
}

/** Sideways slide of the whole block towards the ball side. */
export function blockShift(ballX: number, p: Intensity | Pick<AiParams, 'shiftK' | 'shiftMax'> = 'mid'): number {
  const k = typeof p === 'string' ? { shiftK: INTENSITY[p].SHIFT_K, shiftMax: INTENSITY[p].SHIFT_MAX } : p
  return clamp((ballX - CENTRE_X) * k.shiftK, -k.shiftMax, k.shiftMax)
}

/** Group outfield players into lines by home depth (0 = deepest). */
function lineIndexes(players: AiWorldPlayer[], depthOf: (y: number) => number): { index: Map<string, number>; count: number; homeDepth: Map<string, number> } {
  const homeDepth = new Map(players.map((p) => [p.id, depthOf(p.home[1])] as const))
  const sorted = [...players].sort((a, b) => homeDepth.get(a.id)! - homeDepth.get(b.id)!)
  const index = new Map<string, number>()
  let line = -1
  let last = -Infinity
  for (const p of sorted) {
    const d = homeDepth.get(p.id)!
    if (d - last > LINE_GAP) line++
    index.set(p.id, Math.max(line, 0))
    last = d
  }
  return { index, count: line + 1, homeDepth }
}

/**
 * Targets for the team's AI-driven players.
 *  - Eligible: not in `config.exclude`, not locked, no move this step, and no authored rule that has taken
 *    effect yet (a player whose authored rule fires later is AI-driven until it does, instead of drifting on
 *    last step's stale target). `ai` rules never count as authored.
 *  - `forced`: authored `ai(delay, role)` rules; those players are driven even when `config.on` is false.
 */
export function computeAiTargets(
  S: AiWorld,
  team: Team,
  step: Pick<PlayStep, 'defenderRules' | 'moves'>,
  config: AiConfig,
  forced: Record<string, AiRole> = {},
): Record<string, AiTarget> {
  const out: Record<string, AiTarget> = {}
  if (!S.ball) return out
  const ball = S.ball
  const now = S.t ?? 0
  const P = resolveAiParams(config)

  const own = S.players.filter((p) => p.team === team)
  const foes = S.players.filter((p) => p.team !== team)
  const goalDir: 1 | -1 = team === 'opp' ? 1 : -1 // goal-side direction in y
  const goalY = team === 'opp' ? PITCH_H : 0
  const depthOf = (y: number) => (team === 'opp' ? PITCH_H - y : y)
  const yOf = (d: number) => (team === 'opp' ? PITCH_H - d : d)
  const dBall = depthOf(ball.y)
  const inPossession = S.owner === team

  const excluded = new Set(config.exclude ?? [])
  const authoredFrom = (id: string) =>
    Math.min(Infinity, ...(step.defenderRules[id] ?? []).filter((r) => r.type !== 'ai').map((r) => r.delay ?? 0))
  const moved = (id: string) => step.moves.some((m) => m.playerId === id)
  const eligible = (p: AiWorldPlayer) =>
    !excluded.has(p.id) && !S.locked?.has(p.id) && !moved(p.id) && now < authoredFrom(p.id) - 1e-9 && (config.on || forced[p.id] !== undefined)

  const drive = own.filter(eligible)
  const field = drive.filter((p) => !isGk(p))
  const keeper = drive.find(isGk)

  // formation lines come from every outfield player's home depth, so they do not change as players leave the AI
  const outfield = own.filter((p) => !isGk(p))
  const { index: lineOf, count: lineCount, homeDepth } = lineIndexes(outfield, depthOf)
  const defIdx = 0
  const fwdIdx = lineCount >= 3 ? lineCount - 1 : -1
  const defHomeDepths = outfield.filter((p) => lineOf.get(p.id) === defIdx).map((p) => homeDepth.get(p.id)!)
  const defHome = defHomeDepths.length ? defHomeDepths.reduce((a, b) => a + b, 0) / defHomeDepths.length : 25

  // who each player keeps contact with: his closest neighbours in the FORMATION, and how far apart the
  // formation puts them. Taken from the shape, so it does not drift as players are pulled about in play.
  const neighbours = new Map<string, { id: string; d: number }[]>()
  for (const p of outfield) {
    const byHome = outfield
      .filter((q) => q.id !== p.id)
      .map((q) => ({ id: q.id, d: dist(p.home, q.home) }))
      .sort((a, b) => a.d - b.d)
    neighbours.set(p.id, byHome.slice(0, NEIGHBOURS))
  }

  const lineD = blendedLineDepth(dBall, P, inPossession)
  const shiftX = blockShift(ball.x, P)

  const xLo = 3 + P.widthInward
  const xHi = PITCH_W - 3 - P.widthInward

  // ---- the slot: where the formation on its own would put each player ----
  // Depth comes from the line height; sideways it is simply his formation x. Nothing about the ball or the
  // opposition is baked in here — every reason to stand somewhere else is a pull weighed against this one
  // in solveShape below.
  const rawDepth = new Map<string, number>()
  for (const p of field) {
    const line = lineOf.get(p.id) ?? 1
    let depth: number
    if (line === defIdx) depth = lineD
    else if (line === fwdIdx) depth = inPossession ? lineD + 18 : Math.min(dBall - 4, lineD + 18)
    else {
      depth = lineD + (homeDepth.get(p.id)! - defHome) * P.compact
      if (!inPossession) depth = Math.min(depth, dBall - 1)
    }
    rawDepth.set(p.id, Math.min(Math.max(2, depth), PITCH_H - 25)) // never into the keeper's area either
  }

  // ---- the lines keep their formation order ----
  // Every line above the back one is held behind the ball, so as the ball comes in they all converge on one
  // depth and the formation stops being a formation: with the ball 16 m out the forwards sat BETWEEN the
  // centre-backs and the midfield. A striker whose nearest team-mates are two centre-backs has no shape left
  // to keep, and no pull towards his own slot can mend it, because his slot is where the trouble is. So the
  // lines are pushed apart far enough to stay in order — upfield, leaving the back line and the offside
  // height it carries exactly where they were.
  const lineLift = new Map<number, number>()
  {
    const mean = new Map<number, number>()
    for (const li of new Set(field.map((p) => lineOf.get(p.id) ?? 1))) {
      const members = field.filter((p) => (lineOf.get(p.id) ?? 1) === li)
      mean.set(li, members.reduce((s, p) => s + rawDepth.get(p.id)!, 0) / members.length)
    }
    let behind = -Infinity
    for (const li of [...mean.keys()].sort((a, b) => a - b)) {
      const want = Math.max(mean.get(li)!, behind + LINE_MIN_GAP)
      lineLift.set(li, want - mean.get(li)!)
      behind = want
    }
  }

  const slot = new Map<string, XY>()
  for (const p of field) {
    const depth = clamp(rawDepth.get(p.id)! + (lineLift.get(lineOf.get(p.id) ?? 1) ?? 0), 2, PITCH_H - 25)
    slot.set(p.id, [clamp(p.home[0], xLo, xHi), yOf(depth)])
  }

  const role = new Map<string, Exclude<AiRole, 'auto'>>()
  for (const p of field) role.set(p.id, lineOf.get(p.id) === defIdx ? 'line' : 'wide')
  const target = new Map<string, XY>(slot)
  const gain = new Map<string, number>(field.map((p) => [p.id, GAIN.block] as const))
  const lane = new Map<string, string>()

  /**
   * The limits that are absolute rather than weighed: the pitch and the width setting, a central slot staying
   * central, a flank slot never being drawn further in than the width allows (outwards it is free — that is
   * the wing it is there to deny), and a lane cutter staying on the pass he was given, the solve deciding
   * only where along it he stands.
   */
  const confine = (p: AiWorldPlayer, pt: XY): XY => {
    const recv = foes.find((f) => f.id === lane.get(p.id))
    if (recv) {
      // A cutter's lane IS his permitted ground — canCut already checked it against his flank and his reach
      // before giving it to him — so the lane governs here and the solve only picks where along it he stands.
      // Running the lateral limits afterwards instead would just push him off the pass.
      const from: XY = [clamp(pt[0], 2, PITCH_W - 2), clamp(pt[1], 2, PITCH_H - 2)]
      const on = closestPointOnSegment(from, [ball.x, ball.y], [recv.x, recv.y], MIN_LANE / 2)
      return [on[0], clamp(on[1] + goalDir * 1, 0, PITCH_H)]
    }
    let x = pt[0]
    const off = p.home[0] - CENTRE_X
    if (Math.abs(off) < CENTRAL_OFF) {
      x = clamp(x, p.home[0] - 3, p.home[0] + 3)
    } else if (Math.abs(off) >= WIDE_OFF) {
      const inwards = lerp(WIDE_HOLD.loose, WIDE_HOLD.tight, P.width / 100)
      x = off < 0 ? Math.min(x, p.home[0] + inwards) : Math.max(x, p.home[0] - inwards)
    }
    return [clamp(x, xLo, xHi), clamp(pt[1], 2, PITCH_H - 2)]
  }

  let pressing = false

  if (!inPossession) {
    // ---- is someone already engaging the ball through an authored job (press / mark / follow the carrier)? ----
    const posOf = (id: string): XY | null => {
      const q = S.players.find((x) => x.id === id)
      return q ? [q.x, q.y] : null
    }
    const engaged = own.find((p) => {
      if (!p.duty) return false
      if (p.duty.att === S.focus) return true
      const a = posOf(p.duty.att)
      return a !== null && dist(a, [ball.x, ball.y]) <= ENGAGED_R
    })

    // ---- presser (not needed when an authored job already has the ball covered) ----
    const byBall = [...field].sort((a, b) => dist([a.x, a.y], [ball.x, ball.y]) - dist([b.x, b.y], [ball.x, ball.y]))
    const urgent = dBall >= URGENT_DBALL || dBall <= P.nearGoalR
    const radius = urgent ? Infinity : P.pressR
    let presser: AiWorldPlayer | undefined = field.find((p) => forced[p.id] === 'presser')
    if (!presser && !engaged && byBall.length) {
      const best = byBall[0]
      const dBest = dist([best.x, best.y], [ball.x, ball.y])
      if (dBest <= radius) {
        presser = best
        const prev = S.memory.presser?.[team] ? field.find((p) => p.id === S.memory.presser![team]) : undefined
        if (prev && prev !== best) {
          const dPrev = dist([prev.x, prev.y], [ball.x, ball.y])
          if (dPrev <= radius && dPrev <= dBest + HYSTERESIS) presser = prev // no flicker between near-equal candidates
        }
      }
    }
    S.memory.presser = { ...S.memory.presser, [team]: presser?.id }
    pressing = presser !== undefined

    if (presser) {
      target.set(presser.id, [clamp(ball.x, 2, PITCH_W - 2), clamp(ball.y + goalDir * 1.2, 0, PITCH_H)])
      gain.set(presser.id, P.presserGain)
      role.set(presser.id, 'presser')
    }

    // ---- cover: ONE player behind the ball-winner (presser, or the authored player on the ball), 5 m goal-side
    //      and 3 m towards the centre. Picked from a deeper line where there is one (so the cover really is
    //      behind the press), and from the zone nearest the ball rather than whichever body happens to be
    //      closest — otherwise a far-side wide player gets dragged out of his flank. Only when aggressiveness
    //      lets a second player break shape (a forced `cover` role always applies). ----
    const anchor = presser ?? engaged
    const forcedCover = field.find((p) => forced[p.id] === 'cover' && p.id !== anchor?.id)
    let cover: AiWorldPlayer | undefined
    if (anchor) {
      const aLine = lineOf.get(anchor.id) ?? 1
      const rank = (p: AiWorldPlayer) => ((lineOf.get(p.id) ?? 1) === aLine ? 1 : 0) // a deeper line first
      const coverPool = field
        .filter((p) => p.id !== anchor.id && (lineOf.get(p.id) ?? 1) <= aLine)
        .sort((a, b) => rank(a) - rank(b) || Math.abs(a.home[0] - ball.x) - Math.abs(b.home[0] - ball.x))
      cover = forcedCover ?? (P.pressBreakers >= 1 ? coverPool[0] : undefined)
      if (cover) {
        const towardsCentre = Math.sign(CENTRE_X - anchor.x)
        // he tucks across towards the press, he does not relocate: no further than COVER_REACH from his own slot
        const slotX = slot.get(cover.id)![0]
        const wanted = clamp(anchor.x + towardsCentre * 3, 2, PITCH_W - 2)
        target.set(cover.id, [clamp(wanted, slotX - COVER_REACH, slotX + COVER_REACH), clamp(anchor.y + goalDir * 5, 0, PITCH_H)])
        gain.set(cover.id, P.coverGain)
        role.set(cover.id, 'cover')
      }
    }

    // ---- lane cutters: everyone outside the back line who is not on the ball steps onto an open passing lane
    //      out of the carrier (at low aggressiveness nobody leaves the block, so there is no screening) ----
    if (P.pressBreakers >= 1) {
      const taken = new Set<string>()
      const onJob = new Set(own.map((p) => p.duty?.att).filter((x): x is string => !!x)) // already marked / pressed / followed
      const carrier = foes.find((f) => dist([f.x, f.y], [ball.x, ball.y]) < 2)
      // A presser / cover is on his way to the ball, so a lane he happens to stand in is not covered by him.
      const pulled = new Set(field.filter((p) => role.get(p.id) === 'presser' || role.get(p.id) === 'cover').map((p) => p.id))
      // Handoff: the back line picks up whoever it steps onto as it pushes up, which frees that attacker's
      // screener to cut a lane further forward instead of shadowing someone already covered.
      const lineY = yOf(lineD)
      const onTheLine = new Set<string>()
      for (const p of field) {
        if (lineOf.get(p.id) !== defIdx || pulled.has(p.id)) continue
        const bx = slot.get(p.id)![0]
        for (const a of foes) if (dist([bx, lineY], [a.x, a.y]) <= HANDOFF_R) onTheLine.add(a.id)
      }
      /** The spot ON the lane to `a` that `m` would take: the nearest to his own slot, never closer to the
       *  carrier than MIN_LANE / 2, which is the presser's business and not his. */
      const spotOnLane = (m: AiWorldPlayer, a: AiWorldPlayer): XY =>
        closestPointOnSegment(slot.get(m.id)!, [ball.x, ball.y], [a.x, a.y], MIN_LANE / 2)

      /** May `m` be the one to cut the pass to `a`? Pure geometry: his band of the pitch, a real pass, his own
       *  flank, a lane nobody covers already, and close enough that covering it does not strand him. */
      const canCut = (m: AiWorldPlayer, a: AiWorldPlayer): boolean => {
        const mHome = depthOf(m.home[1])
        const aDepth = depthOf(a.y)
        if (aDepth <= Math.min(dBall, mHome) || aDepth >= Math.max(dBall, mHome)) return false // between ball and slot
        if (dist([a.x, a.y], [ball.x, ball.y]) < MIN_LANE) return false // a real pass, not the carrier's feet
        if (Math.abs(m.home[0] - CENTRE_X) >= 10 && Math.abs(a.x - m.home[0]) > WIDE_LANE_REACH) return false // holds his flank
        if (dist(slot.get(m.id)!, spotOnLane(m, a)) > LANE_REACH) return false // too far to cover without stranding him
        const blockers = field.filter((d) => d.id !== m.id && !pulled.has(d.id)).map((d): XY => [d.x, d.y])
        return passingLaneOpen([ball.x, ball.y], [a.x, a.y], blockers)
      }

      /**
       * What cutting the pass to `a` is worth to `m`. A lane anyone already covers is not scored at all —
       * canCut has dropped it, and `taken` below drops one a team-mate has just claimed — so every lane here
       * is one nobody has, and the score only has to say which of them is worth most to whom.
       */
      const laneValue = (m: AiWorldPlayer, a: AiWorldPlayer): number => {
        const s = slot.get(m.id)!
        const half = PITCH_W / 2
        const mWide = Math.abs(s[0] - CENTRE_X) / half
        const aWide = Math.abs(a.x - CENTRE_X) / half
        // A flank slot is worth most on a flank lane, a central slot on a central one. This is the whole of
        // the winger rule: it is a reward, not a ban, so he drifts wide to find a lane nobody has rather than
        // joining the congestion in the middle — and can still come inside when the middle is all there is.
        const affinity = 1 - Math.abs(mWide - aWide)
        const travel = dist(s, spotOnLane(m, a)) / LANE_REACH
        return LANE_VALUE.base + LANE_VALUE.affinity * affinity - LANE_VALUE.travel * travel
      }

      const screeners = field.filter((p) => !pulled.has(p.id) && lineOf.get(p.id) !== defIdx && forced[p.id] !== 'wide')
      const free = foes.filter((a) => a !== carrier && !onJob.has(a.id) && !onTheLine.has(a.id))
      // Every legal pairing, scored, best first. Taking them in that order spreads the cutters across
      // DIFFERENT lanes: the moment a lane is claimed it is worth nothing to anybody else, so the next man's
      // best remaining option is one nobody has — breadth before depth, and never two on one pass.
      const pairs: { m: AiWorldPlayer; a: AiWorldPlayer; v: number }[] = []
      for (const m of screeners) {
        for (const a of free) if (canCut(m, a)) pairs.push({ m, a, v: laneValue(m, a) })
      }
      pairs.sort((x, y) => y.v - x.v)
      const busy = new Set<string>()
      for (const { m, a } of pairs) {
        if (busy.has(m.id) || taken.has(a.id)) continue
        busy.add(m.id)
        taken.add(a.id)
        // He steps onto the lane properly — a man shading it from 6 m away blocks nothing. What keeps him in
        // the shape is that canCut refused any lane further than LANE_REACH from his slot, plus the cohesion
        // pass below pulling him back if covering it has stretched him off his neighbours.
        const onLane = spotOnLane(m, a)
        target.set(m.id, [clamp(onLane[0], 2, PITCH_W - 2), clamp(onLane[1] + goalDir * 1, 0, PITCH_H)])
        gain.set(m.id, GAIN.screen)
        role.set(m.id, 'screen')
        lane.set(m.id, a.id)
      }
    }

  } else {
    S.memory.presser = { ...S.memory.presser, [team]: undefined }
  }

  // ---- solveShape: one weighed decision per player holding shape ----
  // Everything a player who is not going to the ball might want is a pull — a point and a weight — and they
  // are AVERAGED, not applied one after another. That is the whole point: a chain of overrides lets each step
  // undo the one before it, and the balance between them ends up buried in the order they run. Here the
  // balance is explicit (see W) and lives in one place.
  //
  // The presser and his cover are not in this: winning the ball is worth leaving the shape for, and they are
  // the only two allowed to.
  {
    const holdsShape = (id: string) => {
      const r = role.get(id)
      return r === 'line' || r === 'wide' || r === 'screen'
    }
    // a neighbour the AI is not driving (an authored job, say) still anchors from where he actually stands
    const anchorOf = (id: string): XY | null => {
      const t = target.get(id)
      if (t) return t
      const q = own.find((p) => p.id === id)
      return q ? [q.x, q.y] : null
    }
    // The ball pull fades with distance, so the two or three men around the ball come across and the far side
    // does not — sliding the whole block equally is what opens the far wing for one long diagonal. A compact
    // width keeps a floor under it so the block still narrows as a whole.
    const ballWeight = (p: AiWorldPlayer) => {
      const d = dist([p.x, p.y], [ball.x, ball.y])
      const falloff = 1 - clamp((d - BALL_PULL.full) / (BALL_PULL.none - BALL_PULL.full), 0, 1)
      const reach = Math.max(falloff, lerp(BALL_PULL.floor, 0, P.width / 100))
      return W.ball * reach * (pressing && P.pressBreakers >= 2 ? W.ballPress : 1)
    }
    // An opponent near a player's zone draws him in, harder the closer he is, and he aims to end up goal-side
    // — between that man and the goal. This is what keeps a full-back with a winger who has stayed wide, and
    // it is weighed against his slot and his neighbours rather than overriding them.
    // Whoever is already covering an opponent is not to be joined: a man with two defenders on him is one
    // defender wasted, and somewhere else an attacker is free. A pressing team-mate does not count as cover —
    // he is going to the ball, not standing with anyone.
    const coverers = own.filter((q) => !isGk(q) && role.get(q.id) !== 'presser' && role.get(q.id) !== 'cover')
    /**
     * How free `a` is of everyone except `p`, as `p` sees it: 1 when nobody else is near him, 0 when a
     * team-mate is standing on him. Measured against p's own distance, so it also settles who takes the man —
     * the closer one keeps his claim and the further one looks elsewhere.
     */
    const freedom = (p: AiWorldPlayer, a: AiWorldPlayer, d: number) => {
      if (own.some((q) => q.id !== p.id && q.duty?.att === a.id)) return 0 // already somebody's job
      const nearestOther = Math.min(Infinity, ...coverers.filter((q) => q.id !== p.id).map((q) => dist([q.x, q.y], [a.x, a.y])))
      return clamp(nearestOther / Math.max(d, 1), 0, 1)
    }
    const gravity = (p: AiWorldPlayer): { at: XY; w: number } | null => {
      const s = slot.get(p.id)!
      let bestAt: XY | null = null
      let bestW = 0
      for (const a of foes) {
        const d = dist(s, [a.x, a.y])
        if (d >= GRAVITY_R) continue
        const w = W.gravity * (1 - d / GRAVITY_R) * freedom(p, a, d)
        // the strongest claim wins, so he is drawn to the free man rather than the best-covered one
        if (w > bestW) {
          bestW = w
          bestAt = [a.x, clamp(a.y + goalDir * GRAVITY_GAP, 0, PITCH_H)]
        }
      }
      return bestAt ? { at: bestAt, w: bestW } : null
    }
    /**
     * Negative gravity: pushed away from an opponent a team-mate already has. Standing beside a job that is
     * done is how a defender ends up contributing nothing, and it is half of what makes two men converge on
     * one attacker — `freedom` stops him being drawn in, this moves him back out.
     */
    const repel = (p: AiWorldPlayer): { at: XY; w: number } | null => {
      const s = slot.get(p.id)!
      let ax = 0
      let ay = 0
      let w = 0
      for (const a of foes) {
        const d = dist(s, [a.x, a.y])
        if (d >= GRAVITY_R || d < 1e-6) continue
        const covered = 1 - freedom(p, a, d)
        if (covered <= 0) continue
        const weight = W.repel * covered * (1 - d / GRAVITY_R)
        ax += ((s[0] - a.x) / d) * weight
        ay += ((s[1] - a.y) / d) * weight
        w += weight
      }
      if (w <= 0) return null
      return { at: [clamp(s[0] + (ax / w) * REPEL_STEP, 2, PITCH_W - 2), clamp(s[1] + (ay / w) * REPEL_STEP, 2, PITCH_H - 2)], w }
    }

    for (let pass = 0; pass < SOLVE_PASSES; pass++) {
      for (const p of field) {
        if (!holdsShape(p.id)) continue
        const s = slot.get(p.id)!
        const cur = target.get(p.id)!
        let wx = s[0] * W.slot
        let wy = s[1] * W.slot
        let wsum = W.slot

        const bw = ballWeight(p)
        if (bw > 0) {
          wx += clamp(s[0] + shiftX, xLo, xHi) * bw
          wy += s[1] * bw
          wsum += bw
        }
        for (const g of [gravity(p), repel(p)]) {
          if (!g) continue
          wx += g.at[0] * g.w
          wy += g.at[1] * g.w
          wsum += g.w
        }
        // Contact with the formation: the pull is towards being back WITHIN reach of a neighbour, not on top
        // of him, and it only exists once the shape is stretched past its spacing plus the slack.
        // A neighbour who has gone to the ball is not part of the shape while he is there — following him out
        // is how a block unravels — so he is not counted.
        for (const nb of neighbours.get(p.id) ?? []) {
          const nbRole = role.get(nb.id)
          if (nbRole === 'presser' || nbRole === 'cover') continue
          const q = anchorOf(nb.id)
          if (!q) continue
          const d = dist(cur, q)
          const limit = nb.d + NEIGHBOUR_SLACK
          if (d <= limit || d < 1e-9) continue
          const k = limit / d
          // The weight keeps growing with the stretch, so a badly stranded player is pulled back hard while a
          // marginal one is barely touched. A capped weight would let a big stretch sit there unanswered.
          const w = W.neighbour * clamp((d - limit) / NEIGHBOUR_SLACK, 0, 4)
          wx += (q[0] + (cur[0] - q[0]) * k) * w
          wy += (q[1] + (cur[1] - q[1]) * k) * w
          wsum += w
        }
        target.set(p.id, confine(p, [wx / wsum, wy / wsum]))
      }
    }
  }

  const minSep = lerp(5, 8, P.width / 100)

  // ---- separation: keep AI-driven block players from clustering ----
  // Runs before the no-gaps pass, which has the final word on spacing inside a line, and before the offside
  // line, whose Y correction re-pins the back line to one height.
  //
  // A lane cutter IS included: he used to be exempt, from when his target floated free and pushing him would
  // have taken him off his job. It no longer does — confine() puts him back on his lane — so he gives way like
  // anyone else and merely slides along the pass he is cutting. Leaving him out was letting a cutter and a
  // block player whose slot sat on the same spot stand a metre apart, which reads as two men marking one.
  // The presser and his cover stay exempt: they are going to the ball.
  {
    const sepExempt = (p: AiWorldPlayer): boolean => {
      const r = role.get(p.id)
      if (r === 'presser' || r === 'cover') return true
      const d = p.duty?.type
      return d === 'press' || d === 'mark' || d === 'follow'
    }
    const sepField = field.filter((p) => !sepExempt(p))
    for (let sepPass = 0; sepPass < 4; sepPass++) {
      let moved = false
      for (let i = 0; i < sepField.length; i++) {
        for (let j = i + 1; j < sepField.length; j++) {
          const ti = target.get(sepField[i].id)!
          const tj = target.get(sepField[j].id)!
          const dx = tj[0] - ti[0]
          const dy = tj[1] - ti[1]
          // Two players of one line spread sideways only: the offside line flattens their y afterwards, which
          // would eat any y part of the push.
          const sameLine = lineOf.get(sepField[i].id) === lineOf.get(sepField[j].id)
          const d = sameLine ? Math.abs(dx) : Math.hypot(dx, dy)
          if (d >= minSep) continue
          let nx: number
          let ny: number
          if (sameLine) {
            // They give way along the side they are already on; only when they sit on exactly the same spot
            // does the formation break the tie, so two pinned players cannot be swapped by visiting order.
            nx = (dx !== 0 ? dx : sepField[j].home[0] - sepField[i].home[0]) >= 0 ? 1 : -1
            ny = 0
          } else if (d < 1e-6) {
            nx = 1 // identical positions: push apart along X
            ny = 0
          } else {
            nx = dx / d
            ny = dy / d
          }
          const push = (minSep - d) / 2
          // confine() re-applies each man's own limits, so a cutter pushed off his lane comes straight back
          // onto it and the give-way turns into a slide along the pass
          target.set(sepField[i].id, confine(sepField[i], [ti[0] - nx * push, ti[1] - ny * push]))
          target.set(sepField[j].id, confine(sepField[j], [tj[0] + nx * push, tj[1] + ny * push]))
          moved = true
        }
      }
      if (!moved) break
    }
  }

  // ---- no gaps in a line: neighbours stay within their formation spacing (+ slack) ----
  // (the sideways shift moves wide players more than the pinned central ones, which would tear a hole between
  //  them). The allowance never drops below minSep, so closing a gap cannot undo the separation above.
  const blockPlayers = field.filter((p) => role.get(p.id) === 'line' || role.get(p.id) === 'wide')
  const lines = new Map<number, AiWorldPlayer[]>()
  for (const p of blockPlayers) {
    const li = lineOf.get(p.id) ?? 1
    lines.set(li, [...(lines.get(li) ?? []), p])
  }
  for (const group of lines.values()) {
    const g = [...group].sort((a, b) => a.home[0] - b.home[0])
    for (let pass = 0; pass < g.length; pass++) {
      let changed = false
      for (let i = 0; i + 1 < g.length; i++) {
        const l = target.get(g[i].id)!
        const r = target.get(g[i + 1].id)!
        const allowed = Math.max(g[i + 1].home[0] - g[i].home[0] + GAP_SLACK, minSep)
        if (r[0] - l[0] > allowed + 1e-9) {
          // pull the more peripheral of the two back towards the other
          if (Math.abs(l[0] - CENTRE_X) > Math.abs(r[0] - CENTRE_X)) target.set(g[i].id, [r[0] - allowed, l[1]])
          else target.set(g[i + 1].id, [l[0] + allowed, r[1]])
          changed = true
        }
      }
      if (!changed) break
    }
  }

  // ---- offside line: the back line holds one height (the presser is the exception) ----
  if (config.offsideLine !== false) {
    for (const p of field) {
      if (lineOf.get(p.id) !== defIdx || role.get(p.id) === 'presser') continue
      const t = target.get(p.id)!
      target.set(p.id, [t[0], yOf(lineD)])
    }
  }

  // ---- forced roles from authored ai(delay, role) rules ----
  for (const p of field) {
    const f = forced[p.id]
    if (!f || f === 'auto' || f === 'presser' || f === 'cover') continue
    if (f === 'line') target.set(p.id, [slot.get(p.id)![0], yOf(lineD)])
    else if (f === 'wide') target.set(p.id, slot.get(p.id)!)
    // 'screen' keeps its lane target when one exists, 'gk' is handled below for the keeper
    if (f !== 'screen') role.set(p.id, f)
  }

  for (const p of field) {
    const t = target.get(p.id)!
    const cutting = lane.get(p.id)
    out[p.id] = { x: t[0], y: t[1], gain: gain.get(p.id)!, role: role.get(p.id)!, ...(cutting && role.get(p.id) === 'screen' ? { lane: cutting } : {}) }
  }

  // ---- keeper: stays in the box, shades towards the ball ----
  if (keeper) {
    const v: XY = [ball.x - CENTRE_X, ball.y - goalY]
    const len = Math.hypot(v[0], v[1]) || 1
    const d = clamp(2 + (dBall - 20) * 0.15, 2, 8)
    out[keeper.id] = {
      x: clamp(CENTRE_X + (v[0] / len) * d, 26, 42),
      y: clamp(goalY + (v[1] / len) * d, 0, PITCH_H),
      gain: GAIN.gk,
      role: 'gk',
    }
  }

  return out
}
