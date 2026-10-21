import type { PassAnimation, Play, PlayerMove } from '@/lib/types/play'
import { passFlight, tweenPosition } from './physics'

type Pt = [number, number]

export interface FrameState {
  players: Array<{ id: string; x: number; y: number; label: string; team: 'ours' | 'opp' }>
  /** `height` is 0..1 (lob arc) and only present while a lob is in flight. */
  ball: { x: number; y: number; height?: number } | null
  activePass: { from: Pt; to: Pt; progress: number } | null
  /** One entry per player running this step; `progress` is the linear 0..1 share of the trail to draw. */
  runTrails: Array<{ playerId: string; points: Pt[]; progress: number }>
}

export const EMPTY_FRAME: FrameState = { players: [], ball: null, activePass: null, runTrails: [] }

const DEFAULT_STEP_SECONDS = 3
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function stepSeconds(duration: number | undefined): number {
  return duration && duration > 0 ? duration : DEFAULT_STEP_SECONDS
}

/** Normalised 0..1 progress of a time window [start, end] (seconds) at `time` seconds. */
function windowT(time: number, start: number, end: number): number {
  if (end <= start) return time >= end ? 1 : 0
  return clamp01((time - start) / (end - start))
}

/**
 * Visual state of a play at step `stepIndex`, `t` (0..1) of the way through it.
 *
 * Step 0 is the setup: steps 1..stepIndex-1 are applied in full, and step
 * `stepIndex` is interpolated. Move/pass times are seconds within the step
 * (as the editor stores them) and are normalised against the step duration.
 */
export function computeFrame(play: Play | null | undefined, stepIndex: number, t: number): FrameState {
  if (!play || play.steps.length === 0) return EMPTY_FRAME

  const idx = Math.min(Math.max(Math.trunc(stepIndex) || 0, 0), play.steps.length - 1)
  const tc = clamp01(Number.isFinite(t) ? t : 0)
  const step = play.steps[idx]
  const time = tc * stepSeconds(step.duration)

  const base = new Map<string, Pt>()
  for (const p of play.players) base.set(p.id, [p.x, p.y])
  for (let i = 1; i < idx; i++) {
    for (const m of play.steps[i].moves) base.set(m.playerId, [m.toX, m.toY])
  }

  // Later moves for the same player override earlier ones.
  const moves = new Map<string, PlayerMove>()
  for (const m of step.moves) moves.set(m.playerId, m)

  const pos = new Map<string, Pt>(base)
  const runTrails: FrameState['runTrails'] = []
  for (const [id, m] of moves) {
    const from = base.get(id)
    if (!from) continue
    const to: Pt = [m.toX, m.toY]
    const local = windowT(time, m.startTime, m.endTime)
    pos.set(id, tweenPosition(from, to, local, m.easeFraction ?? 0.25, m.via))
    if (from[0] !== to[0] || from[1] !== to[1]) {
      runTrails.push({ playerId: id, points: m.via ? [from, m.via, to] : [from, to], progress: local })
    }
  }

  // Ball: held by the last receiver (initially the first passer anywhere in the play).
  let holder: string | null = null
  for (const s of play.steps) {
    if (s.passes.length > 0) { holder = s.passes[0].from; break }
  }
  for (let i = 0; i < idx; i++) {
    const last = play.steps[i].passes.at(-1)
    if (last) holder = last.to
  }

  let ball: FrameState['ball'] = null
  let activePass: FrameState['activePass'] = null
  const passes: PassAnimation[] = [...step.passes].sort((a, b) => a.startTime - b.startTime)
  let flying: PassAnimation | null = null
  for (const pass of passes) {
    if (time < pass.startTime) break
    if (time <= pass.endTime && pass.endTime > pass.startTime) { flying = pass; break }
    holder = pass.to
  }

  if (flying) {
    const from = pos.get(flying.from)
    const to = pos.get(flying.to)
    if (from && to) {
      const progress = windowT(time, flying.startTime, flying.endTime)
      const b = passFlight(from, to, progress, flying.isLob)
      ball = flying.isLob ? { x: b.x, y: b.y, height: b.height } : { x: b.x, y: b.y }
      activePass = { from, to, progress }
    }
  } else if (holder) {
    const h = pos.get(holder)
    if (h) ball = { x: h[0], y: h[1] }
  }

  const players = play.players.map((p) => {
    const [x, y] = pos.get(p.id) ?? [p.x, p.y]
    return { id: p.id, x, y, label: p.label, team: p.team }
  })

  return { players, ball, activePass, runTrails }
}
