// The three behaviour controls of the defensive AI: aggressiveness, line height and width.

import { describe, expect, it } from 'vitest'
import { GAIN, INTENSITY, PRESETS, blendedLineDepth, blockShift, computeAiTargets, resolveAiParams, type AiWorld, type AiWorldPlayer } from '@/lib/engine/ai'
import { toPlayInsert } from '@/lib/seed/defensiveAiTest'
import type { Play } from '@/lib/types/play'

const emptyStep = { defenderRules: {}, moves: [] }
const seeded = (): Play => ({ ...toPlayInsert(), id: 'ai-params', createdAt: '', updatedAt: '' })

function world(ball: { x: number; y: number } | null, extra: Partial<AiWorld> = {}): AiWorld {
  const players: AiWorldPlayer[] = seeded().players.map((p) => ({ id: p.id, team: p.team, label: p.label, x: p.x, y: p.y, home: [p.x, p.y] }))
  return { players, ball, memory: {}, ...extra }
}
const P = (cfg: object = {}) => resolveAiParams(cfg)

describe('resolveAiParams', () => {
  it('intensity maps to aggressiveness 20 / 50 / 80, and everything defaults to 50', () => {
    expect(P({ intensity: 'low' }).aggressiveness).toBe(20)
    expect(P({ intensity: 'mid' }).aggressiveness).toBe(50)
    expect(P({ intensity: 'high' }).aggressiveness).toBe(80)
    expect(P({})).toMatchObject({ aggressiveness: 50, lineHeight: 50, width: 50 })
    expect(PRESETS.low).toEqual({ aggressiveness: 20, lineHeight: 30, width: 40 })
    expect(PRESETS.mid).toEqual({ aggressiveness: 50, lineHeight: 50, width: 50 })
    expect(PRESETS.high).toEqual({ aggressiveness: 80, lineHeight: 70, width: 60 })
  })

  it('aggressiveness takes precedence over intensity; values are clamped to 0-100', () => {
    expect(P({ intensity: 'high', aggressiveness: 10 }).aggressiveness).toBe(10)
    expect(P({ aggressiveness: 250, lineHeight: -5, width: 101 })).toMatchObject({ aggressiveness: 100, lineHeight: 0, width: 100 })
  })

  it('hits the table rows exactly at 0 / 50 / 100 and interpolates between them', () => {
    const at = (a: number) => P({ aggressiveness: a })
    const row = (a: number) => [at(a).pressR, at(a).presserGain, at(a).coverGain, at(a).nearGoalR]
    expect(row(0)).toEqual([4, 2.5, 2.0, 8])
    expect(row(50)).toEqual([12, 4.0, 2.6, 15])
    expect(row(100)).toEqual([22, 6.0, 3.5, 40])
    expect(at(25).pressR).toBeCloseTo(8, 9)
    expect(at(75).presserGain).toBeCloseTo(5.0, 9)
    for (let a = 1; a <= 100; a++) {
      expect(at(a).pressR).toBeGreaterThanOrEqual(at(a - 1).pressR)
      expect(at(a).presserGain).toBeGreaterThanOrEqual(at(a - 1).presserGain)
      expect(at(a).coverGain).toBeGreaterThanOrEqual(at(a - 1).coverGain)
      expect(at(a).nearGoalR).toBeGreaterThanOrEqual(at(a - 1).nearGoalR)
    }
  })

  it('the defaults reproduce the old mid preset for pressing, max line, compaction and slide', () => {
    const p = P({})
    expect([p.pressR, p.maxLine, p.compact, p.shiftK, p.shiftMax]).toEqual([
      INTENSITY.mid.PRESS_R, INTENSITY.mid.MAXLINE, INTENSITY.mid.COMPACT, INTENSITY.mid.SHIFT_K, INTENSITY.mid.SHIFT_MAX,
    ])
    expect([p.presserGain, p.coverGain]).toEqual([GAIN.press, GAIN.cover])
  })

  it('how many extra players break shape: 0 below 40, 1 from 40, 2 from 70', () => {
    const n = (a: number) => P({ aggressiveness: a }).pressBreakers
    expect([0, 20, 39].map(n)).toEqual([0, 0, 0])
    expect([40, 50, 69].map(n)).toEqual([1, 1, 1])
    expect([70, 85, 100].map(n)).toEqual([2, 2, 2])
  })

  it('width: SHIFT_MAX 6 / 12 / 18, inward 12 / 6 / 0. Line height target 8 / 31.5 / 55. Blend weight 0.3 / 0.5 / 0.7', () => {
    const w = (v: number) => P({ width: v })
    expect([w(0).shiftMax, w(50).shiftMax, w(100).shiftMax]).toEqual([6, 12, 18])
    expect([w(0).widthInward, w(50).widthInward, w(100).widthInward]).toEqual([12, 6, 0])
    expect([0, 50, 100].map((v) => P({ lineHeight: v }).targetLineD)).toEqual([8, 31.5, 55])
    expect([0, 50, 100].map((a) => P({ aggressiveness: a }).blendWeight)).toEqual([0.3, 0.5, 0.7])
  })
})

describe('aggressiveness: how defenders break shape to press', () => {
  const ball = { x: 34, y: 59 } // oCAM (34,62) is 3 m away
  const roles = (cfg: object) => computeAiTargets(world(ball, { owner: 'ours' }), 'opp', emptyStep, { on: true, ...cfg })
  const count = (t: ReturnType<typeof roles>, r: string) => Object.values(t).filter((v) => v.role === r).length

  it('low (0-30): one presser inside a tight radius, nobody else breaks shape, no lane screening', () => {
    const t = roles({ aggressiveness: 10 })
    expect(count(t, 'presser')).toBe(1)
    expect(count(t, 'cover')).toBe(0)
    expect(count(t, 'support')).toBe(0)
    expect(count(t, 'screen')).toBe(0)
    // the radius is tight (5.6 m at aggressiveness 10): with the nearest outfield player ~12 m away nobody presses at all
    const far = computeAiTargets(world({ x: 34, y: 50 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, aggressiveness: 10 })
    expect(Object.values(far).some((v) => v.role === 'presser')).toBe(false)
  })

  it('mid (40-60): a presser and one cover break; the rest hold the block', () => {
    const t = roles({ aggressiveness: 50 })
    expect(count(t, 'presser')).toBe(1)
    expect(count(t, 'cover')).toBe(1)
    expect(count(t, 'support')).toBe(0)
  })

  it('high (70-100): presser + cover + the nearest midfielder all collapse on the ball', () => {
    const t = roles({ aggressiveness: 90 })
    expect(count(t, 'presser')).toBe(1)
    expect(count(t, 'cover')).toBe(1)
    expect(count(t, 'support')).toBe(1)
    const support = Object.values(t).find((v) => v.role === 'support')!
    expect(Math.hypot(support.x - 34, support.y - 59)).toBeLessThan(5) // he comes right up to the ball
    expect(support.gain).toBe(P({ aggressiveness: 90 }).coverGain)
  })

  it('presser and cover gains follow the table', () => {
    for (const a of [0, 50, 100]) {
      const p = P({ aggressiveness: a })
      const t = roles({ aggressiveness: a })
      expect(Object.values(t).find((v) => v.role === 'presser')!.gain).toBe(p.presserGain)
      const cover = Object.values(t).find((v) => v.role === 'cover')
      if (p.pressBreakers >= 1) expect(cover!.gain).toBe(p.coverGain)
      else expect(cover).toBeUndefined()
    }
  })

  it('the press radius grows with aggressiveness: a ball 16 m from everyone is ignored at 0 and 50, pressed at 100', () => {
    const w = world({ x: 34, y: 60 }, { owner: 'ours' })
    // every OPP outfield player ~16 m from the ball
    w.players.filter((p) => p.team === 'opp' && !/gk/i.test(p.label)).forEach((p, i, all) => {
      const ang = (i / all.length) * Math.PI
      p.x = 34 + Math.cos(ang) * 16
      p.y = 60 + 5 + Math.sin(ang) * 15.2
    })
    const pressed = (a: number) => Object.values(computeAiTargets(w, 'opp', emptyStep, { on: true, aggressiveness: a })).some((v) => v.role === 'presser')
    expect(pressed(0)).toBe(false) // 4 m
    expect(pressed(50)).toBe(false) // 12 m
    expect(pressed(100)).toBe(true) // 22 m
  })

  it('the near-goal radius grows too: an unconditional press when the ball is within 8 / 15 / 40 m of the goal', () => {
    const press = (a: number, dBall: number) => {
      const w = world({ x: 34, y: 105 - dBall }, { owner: 'ours' })
      for (const p of w.players) if (p.team === 'opp' && !/gk/i.test(p.label)) Object.assign(p, { x: 60, y: 60 }) // nobody near the ball
      return Object.values(computeAiTargets(w, 'opp', emptyStep, { on: true, aggressiveness: a })).some((v) => v.role === 'presser')
    }
    expect([press(0, 6), press(0, 20)]).toEqual([true, false])
    expect([press(50, 12), press(50, 30)]).toEqual([true, false])
    expect([press(100, 38), press(100, 60)]).toEqual([true, false])
  })

  it('an intensity-only config behaves as the equivalent aggressiveness', () => {
    const a = computeAiTargets(world({ x: 20, y: 70 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, intensity: 'high' })
    const b = computeAiTargets(world({ x: 20, y: 70 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, aggressiveness: 80 })
    expect(a).toEqual(b)
  })
})

describe('width', () => {
  // y=30: oRW(y=42) is 12.2 m from ball — just outside pressR=12, so no presser/cover, all players in block
  const left = () => world({ x: 10, y: 30 }, { owner: 'ours' })
  const t = (width: number, w = left()) => computeAiTargets(w, 'opp', emptyStep, { on: true, width })

  it('wide players are held at least 3 m + inward from the touchlines', () => {
    expect(t(0).oRB.x).toBeGreaterThanOrEqual(15 - 1e-9) // 3 + 12
    expect(t(50).oRB.x).toBeGreaterThanOrEqual(9 - 1e-9) // 3 + 6
    expect(t(100).oRB.x).toBeGreaterThanOrEqual(3 - 1e-9)
    expect(t(100).oRB.x).toBeLessThan(t(50).oRB.x) // 3 against 9: wider
    // the far side is held in from the right touchline by the same amount
    const right = computeAiTargets(world({ x: 60, y: 60 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, width: 0 })
    expect(right.oLB.x).toBeLessThanOrEqual(68 - 15 + 1e-9)
  })

  it('a narrower setting compresses the back line and a wider one spreads it', () => {
    const spread = (width: number) => {
      const r = t(width)
      const xs = ['oLB', 'oLCB', 'oRCB', 'oRB'].filter((id) => !['presser', 'cover'].includes(r[id].role)).map((id) => r[id].x)
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(spread(0)).toBeLessThan(spread(100))
  })

  it('the sideways slide scales with width (cap 6 / 12 / 18); central players stay central either way', () => {
    expect(blockShift(0, P({ width: 0 }))).toBeCloseTo(-6, 9)
    expect(blockShift(0, P({ width: 100 }))).toBeCloseTo(-15.3, 9) // 34 * 0.45, below the 18 cap
    expect(blockShift(0, P({ width: 100, aggressiveness: 100 }))).toBeCloseTo(-17, 9) // 34 * 0.5
    for (const width of [0, 100]) {
      const r = t(width, world({ x: 0, y: 60 }, { owner: 'ours' }))
      expect(Math.abs(r.oCAM.x - 34)).toBeLessThanOrEqual(3 + 1e-9)
    }
  })
})

describe('line height', () => {
  it('blends the ball-driven height with the target, lerp(target, ball, weight), kept goal-side', () => {
    // ball 75 m from goal: ball-driven (max line 42) = 39.9; target at line height 50 = 31.5; weight 0.5
    expect(blendedLineDepth(75, P())).toBeCloseTo(35.7, 6)
    expect(blendedLineDepth(75, P({ lineHeight: 100 }))).toBeCloseTo(47.45, 6) // lerp(55, 39.9, 0.5)
    expect(blendedLineDepth(75, P({ lineHeight: 0 }))).toBeCloseTo(23.95, 6) // lerp(8, 39.9, 0.5)
  })

  it('a higher line height never gives a lower line, whatever the ball does', () => {
    for (const dBall of [30, 45, 60, 75, 95]) {
      let prev = -Infinity
      for (const lh of [0, 25, 50, 75, 100]) {
        const v = blendedLineDepth(dBall, P({ lineHeight: lh }))
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
    }
  })

  it('aggressiveness moves the weight from the line-height target to the ball', () => {
    // a deep target with the ball far away: the reactive team still follows the ball up, the disciplined one stays deep
    const disciplined = blendedLineDepth(95, P({ lineHeight: 0, aggressiveness: 0 }))
    const reactive = blendedLineDepth(95, P({ lineHeight: 0, aggressiveness: 100 }))
    expect(reactive).toBeGreaterThan(disciplined + 10)
    // low aggressiveness + a high line height holds a high line while the ball is far from goal
    expect(blendedLineDepth(95, P({ lineHeight: 100, aggressiveness: 0 }))).toBeGreaterThan(40)
  })

  it('the line is never ahead of the ball, even with the highest line height (critical invariant)', () => {
    for (const dBall of [4, 8, 12, 20, 30]) {
      for (const a of [0, 50, 100]) {
        expect(blendedLineDepth(dBall, P({ lineHeight: 100, aggressiveness: a }))).toBeLessThanOrEqual(Math.max(2, dBall - 2) + 1e-9)
      }
    }
    // ...end to end: ball 15 m from their goal, a high line height still leaves the back line goal-side
    const t = computeAiTargets(world({ x: 34, y: 90 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, lineHeight: 100, aggressiveness: 0 })
    for (const id of ['oLB', 'oRB']) expect(105 - t[id].y).toBeLessThanOrEqual(15 - 2 + 1e-9)
  })

  it('in possession the line height governs: lerp(target, max line, weight)', () => {
    const w = world({ x: 34, y: 95 }, { owner: 'opp' })
    const y = (lineHeight: number) => computeAiTargets(w, 'opp', emptyStep, { on: true, lineHeight }).oLB.y
    expect(y(0)).toBeGreaterThan(y(100)) // a lower line height keeps them deeper (larger y for OPP)
    expect(105 - y(50)).toBeCloseTo(36.75, 6) // lerp(31.5, 42, 0.5)
  })

  it('the offside line still holds the back line at one height with the new controls', () => {
    const t = computeAiTargets(world({ x: 20, y: 60 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, aggressiveness: 20, lineHeight: 80, width: 70 })
    const ys = ['oLB', 'oLCB', 'oRCB', 'oRB'].filter((id) => t[id].role === 'line').map((id) => t[id].y)
    expect(ys.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9)
  })
})
