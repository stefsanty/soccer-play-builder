// Defensive AI: where each defender of a team should be, given the ball.
//
//   computeAiTargets(S, team, step, config, forced?) -> { playerId: { x, y, gain, role } }
//
// Pitch frame: x 0..68, y 0..105. 'opp' defends the goal at y = 105 (goal-side = +y); 'ours' defends
// y = 0 (goal-side = -y). Depths are measured from the defending team's own goal line:
//   dBall = 105 - ball.y for 'opp', ball.y for 'ours'.
// The defensive line height follows dBall exactly as specified (see lineDepth); it is always kept goal-side
// of the ball. The block slides sideways towards the ball, one player presses (with a cover behind him),
// central midfielders close passing lanes to unmarked central attackers, and the keeper tracks the ball.

import type { AiConfig, AiRole, PlayStep } from '@/lib/types/play'

export type XY = [number, number]
export type Team = 'ours' | 'opp'
export type Intensity = 'low' | 'mid' | 'high'

export interface AiWorldPlayer {
  id: string
  team: Team
  label: string
  x: number
  y: number
  /** Formation home position: the shape the block keeps. */
  home: XY
}

/** What the AI looks at. `memory` survives between calls (presser hysteresis). */
export interface AiWorld {
  players: AiWorldPlayer[]
  /** Ball position; null = no ball in play (the AI then does nothing). */
  ball: { x: number; y: number } | null
  memory: { presser?: Partial<Record<Team, string>> }
}

export interface AiTarget {
  x: number
  y: number
  gain: number
  role: Exclude<AiRole, 'auto'>
}

export const INTENSITY = {
  // OFFSET (how far the line sits goal-side of the ball) is superseded by the ball-depth rules in lineDepth();
  // it is kept as a tuning reference.
  low: { OFFSET: 14, MAXLINE: 32, COMPACT: 0.55, PRESS_R: 8, SHIFT_K: 0.4, SHIFT_MAX: 10 },
  mid: { OFFSET: 11, MAXLINE: 42, COMPACT: 0.65, PRESS_R: 12, SHIFT_K: 0.45, SHIFT_MAX: 12 },
  high: { OFFSET: 8, MAXLINE: 54, COMPACT: 0.75, PRESS_R: 18, SHIFT_K: 0.5, SHIFT_MAX: 14 },
} as const

/** The closest defender presses without any radius check when the ball is at least this deep (dBall). */
export const URGENT_DBALL = 80
/** ...and also whenever the ball is within this many metres of the defending goal line. */
export const NEAR_GOAL_PRESS_R = 15
export const GAIN = { press: 4.0, cover: 2.6, screen: 2.4, block: 2.2, gk: 1.8 } as const

const PITCH_W = 68
const PITCH_H = 105
const CENTRE_X = 34
const HYSTERESIS = 3
const LINE_GAP = 5 // m of home depth that separates one line from the next

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])
const isGk = (p: AiWorldPlayer) => /gk/i.test(p.label)

/**
 * Depth of the defensive line from the defending goal, for a ball `dBall` metres from it.
 * Deep and compact when the ball is close to goal, higher as the ball moves away, never ahead of the ball.
 */
export function lineDepth(dBall: number, intensity: Intensity = 'mid'): number {
  const MAXLINE = INTENSITY[intensity].MAXLINE
  let d: number
  if (dBall < 20) d = 8
  else if (dBall < 35) d = lerp(8, MAXLINE * 0.5, (dBall - 20) / 15)
  else if (dBall < 60) d = lerp(MAXLINE * 0.5, MAXLINE * 0.8, (dBall - 35) / 25)
  else if (dBall < 80) d = lerp(MAXLINE * 0.8, MAXLINE, (dBall - 60) / 20)
  else d = MAXLINE
  // defence is always goal-side of the ball (floor of 2 m keeps it off the goal line)
  return Math.max(2, Math.min(d, dBall - 2))
}

/** Sideways slide of the whole block towards the ball side. */
export function blockShift(ballX: number, intensity: Intensity = 'mid'): number {
  const k = INTENSITY[intensity]
  return clamp((ballX - CENTRE_X) * k.SHIFT_K, -k.SHIFT_MAX, k.SHIFT_MAX)
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
 * Targets for the defending `team`'s AI-driven players.
 *  - Eligible: not in `config.exclude`, no authored rule in this step (except `ai` rules), no move this step.
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
  const intensity = config.intensity ?? 'mid'
  const K = INTENSITY[intensity]

  const own = S.players.filter((p) => p.team === team)
  const foes = S.players.filter((p) => p.team !== team)
  const goalDir: 1 | -1 = team === 'opp' ? 1 : -1 // goal-side direction in y
  const goalY = team === 'opp' ? PITCH_H : 0
  const depthOf = (y: number) => (team === 'opp' ? PITCH_H - y : y)
  const yOf = (d: number) => (team === 'opp' ? PITCH_H - d : d)
  const dBall = depthOf(ball.y)

  const excluded = new Set(config.exclude ?? [])
  const authored = (id: string) => (step.defenderRules[id] ?? []).some((r) => r.type !== 'ai')
  const moved = (id: string) => step.moves.some((m) => m.playerId === id)
  const eligible = (p: AiWorldPlayer) =>
    !excluded.has(p.id) && !moved(p.id) && !authored(p.id) && (config.on || forced[p.id] !== undefined)

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

  const lineD = lineDepth(dBall, intensity)
  const shiftX = blockShift(ball.x, intensity)

  // ---- block position for everyone (before presser / cover / screens override some) ----
  const block = new Map<string, XY>()
  for (const p of field) {
    const line = lineOf.get(p.id) ?? 1
    let depth: number
    if (line === defIdx) depth = lineD
    else if (line === fwdIdx) depth = Math.min(dBall - 4, lineD + 18)
    else depth = Math.min(lineD + (homeDepth.get(p.id)! - defHome) * K.COMPACT, dBall - 1)
    depth = Math.max(2, depth)

    let x = p.home[0] + shiftX
    const off = p.home[0] - CENTRE_X
    if (Math.abs(off) >= 10 && off * (ball.x - CENTRE_X) < 0) x += (ball.x - p.home[0]) * 0.2 // far side tucks in
    if (Math.abs(off) < 10) x = clamp(x, p.home[0] - 3, p.home[0] + 3) // central players stay central
    block.set(p.id, [clamp(x, 2, PITCH_W - 2), yOf(depth)])
  }

  const role = new Map<string, Exclude<AiRole, 'auto'>>()
  for (const p of field) role.set(p.id, lineOf.get(p.id) === defIdx ? 'line' : 'wide')
  const target = new Map<string, XY>(block)
  const gain = new Map<string, number>(field.map((p) => [p.id, GAIN.block] as const))

  // ---- presser ----
  const byBall = [...field].sort((a, b) => dist([a.x, a.y], [ball.x, ball.y]) - dist([b.x, b.y], [ball.x, ball.y]))
  const urgent = dBall >= URGENT_DBALL || dBall <= NEAR_GOAL_PRESS_R
  const radius = urgent ? Infinity : K.PRESS_R
  let presser: AiWorldPlayer | undefined = field.find((p) => forced[p.id] === 'presser')
  if (!presser && byBall.length) {
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
    gain.set(presser.id, GAIN.press)
    role.set(presser.id, 'presser')

    // ---- cover: next closest to the presser from the same or a deeper line, 5 m goal-side and 3 m towards the centre ----
    const pLine = lineOf.get(presser.id) ?? 1
    const coverPool = field
      .filter((p) => p.id !== presser!.id && (lineOf.get(p.id) ?? 1) <= pLine)
      .sort((a, b) => dist([a.x, a.y], [presser!.x, presser!.y]) - dist([b.x, b.y], [presser!.x, presser!.y]))
    const cover = field.find((p) => forced[p.id] === 'cover' && p.id !== presser!.id) ?? coverPool[0]
    if (cover) {
      const towardsCentre = Math.sign(CENTRE_X - presser.x)
      target.set(cover.id, [clamp(presser.x + towardsCentre * 3, 2, PITCH_W - 2), clamp(presser.y + goalDir * 5, 0, PITCH_H)])
      gain.set(cover.id, GAIN.cover)
      role.set(cover.id, 'cover')
    }
  }

  // ---- lane screening: central midfielders close the passing lane to an unmarked central attacker ----
  const taken = new Set<string>()
  const carrier = foes.find((f) => dist([f.x, f.y], [ball.x, ball.y]) < 2)
  const screeners = field.filter((p) => {
    const r = role.get(p.id)
    return r !== 'presser' && r !== 'cover' && lineOf.get(p.id) !== defIdx && Math.abs(p.home[0] - CENTRE_X) < 14 && forced[p.id] !== 'wide'
  })
  for (const m of [...screeners].sort((a, b) => dist([a.x, a.y], [ball.x, ball.y]) - dist([b.x, b.y], [ball.x, ball.y]))) {
    const mHome = depthOf(m.home[1])
    const lo = Math.min(dBall, mHome)
    const hi = Math.max(dBall, mHome)
    const open = foes
      .filter((a) => a !== carrier && !taken.has(a.id) && Math.abs(a.x - CENTRE_X) < 14)
      .filter((a) => depthOf(a.y) > lo && depthOf(a.y) < hi)
      .filter((a) => !own.some((d) => !isGk(d) && dist([d.x, d.y], [a.x, a.y]) < 4)) // unmarked
      .sort((a, b) => dist([a.x, a.y], [ball.x, ball.y]) - dist([b.x, b.y], [ball.x, ball.y]))[0]
    if (!open) continue
    taken.add(open.id)
    target.set(m.id, [clamp((ball.x + open.x) / 2, 2, PITCH_W - 2), clamp((ball.y + open.y) / 2 + goalDir * 1, 0, PITCH_H)])
    gain.set(m.id, GAIN.screen)
    role.set(m.id, 'screen')
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
