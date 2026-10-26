// Attacking AI — "the team moves up with the carrier, whoever he is" (Stefan's playtest, 2026-10-26:
// LCB carried the ball up and the team stayed where it was). A 20 m carry by a centre-back, a central
// midfielder and a full-back: the whole block shifts up (and across, for the full-back) with the ball,
// the lines keep their order and distance, and somebody stays behind as rest defence.

import { describe, expect, it } from 'vitest'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { scheduleTurn, type BuilderAction } from '@/lib/engine/turnBuilder'
import { SPACING_M, planTeamShape, type ShapeInput } from '@/lib/engine/teamShape'
import { ROLES, TABLE_DEPTHS, TABLE_HOMES, TABLE_XS, roleFor, tableSlots } from '@/lib/engine/formationTable'

type Pt = [number, number]

const play = createDefaultPlay()
const homes = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
const players = play.players.map((p) => ({ id: p.id, team: p.team, label: p.label }))
const ours = play.players.filter((p) => p.team === 'ours' && p.label !== 'GK').map((p) => p.id)
const DEF = ['o-LB', 'o-LCB', 'o-RCB', 'o-RB']
const MID = ['o-LM', 'o-LCM', 'o-RCM', 'o-RM']
const FWD = ['o-LST', 'o-RST']

/** Everyone's position once the turn has run: AI target, else the schedule's planned spot. */
function carry(holder: string, to: Pt) {
  const q: BuilderAction[] = [{ kind: 'dribble', playerId: holder, toX: to[0], toY: to[1] }]
  const inp: ShapeInput = { players, positions: homes, homes, attackingTeam: 'ours', holder, queue: q, schedule: scheduleTurn(q, homes) }
  const moves = planTeamShape(inp)
  const f: Record<string, Pt> = { ...inp.schedule.planned }
  for (const m of moves) f[m.playerId] = m.to
  return { f, moves }
}
const meanY = (f: Record<string, Pt>, ids: string[]) => ids.reduce((t, id) => t + f[id][1], 0) / ids.length
const meanX = (f: Record<string, Pt>, ids: string[]) => ids.reduce((t, id) => t + f[id][0], 0) / ids.length

describe('the block moves up with the carrier, whoever he is', () => {
  const cases: [string, string, Pt][] = [
    ['LCB (centre-back)', 'o-LCB', [25, 38]],
    ['LCM (central midfielder)', 'o-LCM', [25, 54]],
    ['LB (full-back)', 'o-LB', [8, 40]],
  ]
  for (const [name, holder, to] of cases) {
    it(`${name} carries 20 m: every line moves up, keeps its order and distance`, () => {
      const { f } = carry(holder, to)
      const others = ours.filter((id) => id !== holder)
      // nobody is left behind: each teammate moves at least 5 m up the pitch; on average 9 m or more
      for (const id of others) expect(f[id][1] - homes[id][1]).toBeGreaterThanOrEqual(5)
      expect(others.reduce((t, id) => t + f[id][1] - homes[id][1], 0) / others.length).toBeGreaterThanOrEqual(9)
      // defence < midfield < forwards, each gap a real line distance (8–25 m)
      const lines = [DEF, MID, FWD].map((ids) => ids.filter((id) => id !== holder))
      const [d, m, w] = lines.map((ids) => meanY(f, ids))
      expect(m - d).toBeGreaterThanOrEqual(8)
      expect(m - d).toBeLessThanOrEqual(25)
      expect(w - m).toBeGreaterThanOrEqual(8)
      expect(w - m).toBeLessThanOrEqual(25)
      // the ball is never the most advanced point: the forwards are ahead of it
      for (const id of FWD.filter((id) => id !== holder)) expect(f[id][1]).toBeGreaterThan(to[1])
      // rest defence: with the keeper, at least one outfielder 8 m or more behind a ball in our half, two
      // behind a ball past halfway
      expect(others.filter((id) => f[id][1] <= to[1] - 8).length).toBeGreaterThanOrEqual(to[1] < 52.5 ? 1 : 2)
      // nobody runs into the carrier
      for (const id of others) expect(Math.hypot(f[id][0] - to[0], f[id][1] - to[1])).toBeGreaterThanOrEqual(SPACING_M - 0.01)
    })
  }

  it('the centre-back carrying is not the most advanced defender-or-midfielder left alone: the midfield is ahead of him', () => {
    const { f } = carry('o-LCB', [25, 38])
    expect(meanY(f, MID)).toBeGreaterThan(38)
  })

  it('the full-back carrying on the left: the block slides across to the left too', () => {
    const { f } = carry('o-LB', [8, 40])
    const others = ours.filter((id) => id !== 'o-LB')
    expect(meanX(f, others)).toBeLessThan(meanX(homes, others) - 4)
    // the far-side winger keeps some width
    expect(f['o-RM'][0]).toBeGreaterThanOrEqual(50)
  })
})

describe('formation table (engine/formationTable.ts)', () => {
  it('returns the sample itself at a sample ball position', () => {
    const s = tableSlots([34, 40])
    expect(s.LCB).toEqual([24, 29])
    expect(s.LST).toEqual([27, 66])
  })

  it('the right touchline column is the left one mirrored', () => {
    for (const d of TABLE_DEPTHS) {
      const left = tableSlots([TABLE_XS[0], d])
      const right = tableSlots([TABLE_XS[2], d])
      expect(right.RB[0]).toBeCloseTo(68 - left.LB[0], 9)
      expect(right.RB[1]).toBeCloseTo(left.LB[1], 9)
      expect(right.LST[0]).toBeCloseTo(68 - left.RST[0], 9)
    }
  })

  it('interpolates continuously: a small ball move gives a small shape move', () => {
    for (let x = 0; x <= 68; x += 3.7) {
      for (let d = 0; d <= 105; d += 4.3) {
        const a = tableSlots([x, d])
        const b = tableSlots([x + 0.5, d + 0.5])
        for (const r of ROLES) expect(Math.hypot(a[r][0] - b[r][0], a[r][1] - b[r][1])).toBeLessThan(1.5)
      }
    }
  })

  it('every sample keeps the lines in order (defence < midfield < forwards) and the centre-backs at or below 57 m', () => {
    for (const x of TABLE_XS) {
      for (const d of TABLE_DEPTHS) {
        const s = tableSlots([x, d])
        const def = (s.LCB[1] + s.RCB[1]) / 2
        const mid = (s.LCM[1] + s.RCM[1]) / 2
        const fwd = (s.LST[1] + s.RST[1]) / 2
        expect(def).toBeLessThan(mid)
        expect(mid).toBeLessThan(fwd)
        expect(Math.max(s.LCB[1], s.RCB[1])).toBeLessThanOrEqual(57)
      }
    }
  })

  it('maps a player to his role by label, else by the nearest 4-4-2 home', () => {
    expect(roleFor('LCB', [0, 0])).toBe('LCB')
    expect(roleFor('CDM', [34, 30])).toMatch(/CM$/)
    expect(roleFor('CF', [34, 60])).toMatch(/ST$/)
    expect(roleFor('LWB', TABLE_HOMES.LB)).toBe('LB')
  })
})
