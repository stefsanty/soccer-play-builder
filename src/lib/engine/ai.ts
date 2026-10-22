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
/** Share of the gap to the ball's x that the block closes while a press is on (high aggressiveness only). */
const PRESS_SQUEEZE = 0.18
/** How far sideways the cover may come off his own slot to get behind the press. */
const COVER_REACH = 8

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
 * Distance from `p` to the finite segment `a`-`b`. Beyond either end it is the distance to that end, so a
 * defender standing past the receiver does not count as being on the pass.
 */
export function distPointToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return dist(p, a)
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq, 0, 1)
  return dist(p, [a[0] + t * dx, a[1] + t * dy])
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

  const lineD = blendedLineDepth(dBall, P, inPossession)
  const shiftX = blockShift(ball.x, P)

  // ---- block position for everyone (before presser / cover / screens override some) ----
  const block = new Map<string, XY>()
  for (const p of field) {
    const line = lineOf.get(p.id) ?? 1
    let depth: number
    if (line === defIdx) depth = lineD
    else if (line === fwdIdx) depth = inPossession ? lineD + 18 : Math.min(dBall - 4, lineD + 18)
    else {
      depth = lineD + (homeDepth.get(p.id)! - defHome) * P.compact
      if (!inPossession) depth = Math.min(depth, dBall - 1)
    }
    depth = Math.min(Math.max(2, depth), PITCH_H - 25) // never into the keeper's area from the other end either

    let x = p.home[0] + shiftX
    const off = p.home[0] - CENTRE_X
    if (Math.abs(off) >= 10 && off * (ball.x - CENTRE_X) < 0) x += (ball.x - p.home[0]) * 0.2 // far side tucks in
    if (Math.abs(off) < 10) x = clamp(x, p.home[0] - 3, p.home[0] + 3) // central players stay central
    // width: the formation holds between 3 m + inward from the touchlines (inward is 0 at width 100)
    block.set(p.id, [clamp(x, 3 + P.widthInward, PITCH_W - 3 - P.widthInward), yOf(depth)])
  }

  const role = new Map<string, Exclude<AiRole, 'auto'>>()
  for (const p of field) role.set(p.id, lineOf.get(p.id) === defIdx ? 'line' : 'wide')
  const target = new Map<string, XY>(block)
  const gain = new Map<string, number>(field.map((p) => [p.id, GAIN.block] as const))

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
        const slotX = block.get(cover.id)![0]
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
        const bx = block.get(p.id)![0]
        for (const a of foes) if (dist([bx, lineY], [a.x, a.y]) <= HANDOFF_R) onTheLine.add(a.id)
      }
      const screeners = field.filter((p) => !pulled.has(p.id) && lineOf.get(p.id) !== defIdx && forced[p.id] !== 'wide')
      for (const m of [...screeners].sort((a, b) => dist([a.x, a.y], [ball.x, ball.y]) - dist([b.x, b.y], [ball.x, ball.y]))) {
        const mHome = depthOf(m.home[1])
        const lo = Math.min(dBall, mHome)
        const hi = Math.max(dBall, mHome)
        const blockers = field.filter((d) => d.id !== m.id && !pulled.has(d.id)).map((d): XY => [d.x, d.y])
        const wide = Math.abs(m.home[0] - CENTRE_X) >= 10
        const open = foes
          .filter((a) => a !== carrier && !taken.has(a.id) && !onJob.has(a.id) && !onTheLine.has(a.id))
          .filter((a) => depthOf(a.y) > lo && depthOf(a.y) < hi) // between the ball and his own zone
          .filter((a) => dist([a.x, a.y], [ball.x, ball.y]) >= MIN_LANE) // a real pass, not the carrier's feet
          .filter((a) => !wide || Math.abs(a.x - m.home[0]) <= WIDE_LANE_REACH) // a wide man holds his flank
          .filter((a) => passingLaneOpen([ball.x, ball.y], [a.x, a.y], blockers))
          .sort((a, b) => dist(m.home, [a.x, a.y]) - dist(m.home, [b.x, b.y]))[0] // nearest his own zone first
        if (!open) continue
        taken.add(open.id)
        target.set(m.id, [clamp((ball.x + open.x) / 2, 2, PITCH_W - 2), clamp((ball.y + open.y) / 2 + goalDir * 1, 0, PITCH_H)])
        gain.set(m.id, GAIN.screen)
        role.set(m.id, 'screen')
      }
    }

    // ---- press compression: the block squeezes towards the ball side as ONE unit while the press goes in.
    //      This is what high aggressiveness buys instead of a second chaser: nobody leaves his zone. ----
    if (presser && P.pressBreakers >= 2) {
      for (const p of field) {
        const r = role.get(p.id)
        if (r !== 'line' && r !== 'wide') continue
        const t = target.get(p.id)!
        target.set(p.id, [clamp(t[0] + (ball.x - t[0]) * PRESS_SQUEEZE, 3 + P.widthInward, PITCH_W - 3 - P.widthInward), t[1]])
      }
    }
  } else {
    S.memory.presser = { ...S.memory.presser, [team]: undefined }
  }

  const minSep = lerp(5, 8, P.width / 100)

  // ---- separation: keep AI-driven block players from clustering ----
  // Runs before the no-gaps pass, which has the final word on spacing inside a line, and before the offside
  // line, whose Y correction re-pins the back line to one height. Presser / cover / screen have specific
  // tactical targets and are exempt.
  {
    const xLo = 3 + P.widthInward
    const xHi = PITCH_W - 3 - P.widthInward
    const sepExempt = (p: AiWorldPlayer): boolean => {
      const r = role.get(p.id)
      if (r === 'presser' || r === 'cover' || r === 'screen') return true
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
          target.set(sepField[i].id, [clamp(ti[0] - nx * push, xLo, xHi), clamp(ti[1] - ny * push, 3, PITCH_H - 3)])
          target.set(sepField[j].id, [clamp(tj[0] + nx * push, xLo, xHi), clamp(tj[1] + ny * push, 3, PITCH_H - 3)])
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
    if (f === 'line') target.set(p.id, [block.get(p.id)![0], yOf(lineD)])
    else if (f === 'wide') target.set(p.id, block.get(p.id)!)
    // 'screen' keeps its lane target when one exists, 'gk' is handled below for the keeper
    if (f !== 'screen') role.set(p.id, f)
  }

  for (const p of field) {
    const t = target.get(p.id)!
    out[p.id] = { x: t[0], y: t[1], gain: gain.get(p.id)!, role: role.get(p.id)! }
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
