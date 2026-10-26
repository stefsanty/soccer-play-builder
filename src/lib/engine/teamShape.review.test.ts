// Attacking AI — second-pass football review of the team-shape solver (docs/attacking-ai-spec.md §7):
// the carrier, build-up from the back, and a pass back from a high block.

import { describe, expect, it } from 'vitest'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { scheduleTurn, type BuilderAction } from '@/lib/engine/turnBuilder'
import { FWD_BACK_MAX, MAX_JOB_DROP, SPACING_M, planTeamShape, type ShapeInput, type SupportMove } from '@/lib/engine/teamShape'

type Pt = [number, number]

const play = createDefaultPlay()
const homes = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
const players = play.players.map((p) => ({ id: p.id, team: p.team, label: p.label }))

function input(queue: BuilderAction[], holder: string, overrides: Record<string, Pt> = {}): ShapeInput {
  const positions: Record<string, Pt> = { ...homes, ...overrides }
  return { players, positions, homes, attackingTeam: 'ours', holder, queue, schedule: scheduleTurn(queue, positions) }
}
const plan = (queue: BuilderAction[], holder: string, overrides: Record<string, Pt> = {}) => planTeamShape(input(queue, holder, overrides))
const byId = (moves: SupportMove[], pid: string) => moves.find((m) => m.playerId === pid)
/** How far down the pitch a move takes its player (negative = up). */
const drop = (m: SupportMove) => m.from[1] - m.to[1]

describe('review: the carrier, build-up from the back, back passes', () => {
  it('R1 — the ball holder is never moved when the user commands somebody else', () => {
    // LM makes an off-ball run; the ball stays with RCM, who has no action of his own
    const moves = plan([{ kind: 'run', playerId: 'o-LM', toX: 6, toY: 50 }], 'o-RCM')
    expect(byId(moves, 'o-RCM')).toBeUndefined()
    // the support angle is still offered — by the next midfielder
    const sup = moves.filter((m) => m.reason === 'support')
    expect(sup.map((m) => m.playerId)).toContain('o-LCM')
  })

  it('R2 — build-up from the back: the forwards hold their height and nobody drops more than 5 m', () => {
    const cases: [BuilderAction[], string][] = [
      [[{ kind: 'dribble', playerId: 'o-RCB', toX: 43, toY: 30 }], 'o-RCB'],
      [[{ kind: 'pass', playerId: 'o-RCB', to: 'o-LCB' }], 'o-RCB'],
      [[{ kind: 'pass', playerId: 'o-GK', to: 'o-RCB' }], 'o-GK'],
    ]
    for (const [q, holder] of cases) {
      const moves = plan(q, holder)
      for (const m of moves) expect(drop(m)).toBeLessThanOrEqual(MAX_JOB_DROP + 1e-6)
      for (const pid of ['o-LST', 'o-RST']) {
        const m = byId(moves, pid)
        if (m) expect(drop(m)).toBeLessThanOrEqual(0.1)
      }
      // a run "beyond" never ends behind where the runner started
      for (const m of moves.filter((m) => m.reason === 'depth')) expect(m.to[1]).toBeGreaterThan(m.from[1])
    }
  })

  it('R3 — the support angle for a deep carrier is beside and slightly ahead, not a drop into the defence', () => {
    // RCB plays LCB at (25, 18); LCM (25, 34) shows for the ball
    const moves = plan([{ kind: 'pass', playerId: 'o-RCB', to: 'o-LCB' }], 'o-RCB')
    const lcm = byId(moves, 'o-LCM')!
    expect(lcm.reason).toBe('support')
    expect(lcm.to[1]).toBeGreaterThanOrEqual(34 - MAX_JOB_DROP - 1e-6)
    expect(lcm.to[0]).toBeLessThan(25)
  })

  it('R4 — a pass back from a high block: the forwards hold (≤ 3 m), the midfield drops at most half the retreat, the defence stays', () => {
    const high: Record<string, Pt> = {
      'o-RCM': [43, 70], 'o-LCM': [25, 68], 'o-LM': [10, 70], 'o-RM': [58, 70], 'o-LST': [26, 80], 'o-RST': [42, 80],
      'o-LB': [10, 50], 'o-LCB': [25, 48], 'o-RCB': [43, 48], 'o-RB': [58, 50],
    }
    // the ball goes back 22 m, from RCM (43, 70) to RCB (43, 48)
    const moves = plan([{ kind: 'pass', playerId: 'o-RCM', to: 'o-RCB' }], 'o-RCM', high)
    for (const pid of ['o-LST', 'o-RST']) {
      const m = byId(moves, pid)
      if (m) expect(drop(m)).toBeLessThanOrEqual(FWD_BACK_MAX + 1e-6)
    }
    for (const pid of ['o-LM', 'o-LCM', 'o-RM']) {
      const m = byId(moves, pid)
      if (m) expect(drop(m)).toBeLessThanOrEqual(11 + 1e-6)
    }
    for (const pid of ['o-LB', 'o-LCB', 'o-RB']) expect(byId(moves, pid)).toBeUndefined()
  })

  it('R5 — the dribble-up scenario keeps its jobs under the review rules', () => {
    const moves = plan([{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 49 }], 'o-RCM')
    expect(byId(moves, 'o-RST')?.reason).toBe('depth')
    expect(byId(moves, 'o-LCM')?.reason).toBe('support')
    expect(byId(moves, 'o-RM')?.reason).toBe('wide')
    for (const m of moves) expect(drop(m)).toBeLessThanOrEqual(0.1)
  })

  it('R6 — a run that cannot get past the carrier in time stops short of him instead of running into him', () => {
    // RCM dribbles sideways to the right touchline; RB (25 m behind) overlaps but cannot get ahead inside the turn
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 61, toY: 38 }]
    const inp = input(q, 'o-RCM')
    const moves = planTeamShape(inp)
    const ball = inp.schedule.planned['o-RCM']
    const rb = byId(moves, 'o-RB')!
    expect(rb.reason).toBe('overlap')
    // he goes the right way, up the line, and arrives at the carrier's shoulder, not on top of him
    expect(rb.to[1]).toBeGreaterThan(rb.from[1] + 8)
    expect(Math.hypot(rb.to[0] - ball[0], rb.to[1] - ball[1])).toBeGreaterThanOrEqual(SPACING_M - 1e-6)
    // nobody who started outside the carrier's space ends inside it (RM starts 3.6 m from where the ball
    // arrives and can only step aside, which the spacing rule does)
    for (const m of moves) {
      if (Math.hypot(m.from[0] - ball[0], m.from[1] - ball[1]) < SPACING_M) continue
      expect(Math.hypot(m.to[0] - ball[0], m.to[1] - ball[1])).toBeGreaterThanOrEqual(SPACING_M - 0.01)
    }
  })
})
