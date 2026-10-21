import { describe, expect, it } from 'vitest'
import { toPlayInsert } from '@/lib/seed/rightSideBuildUp'
import { AMAX, BALL_OFFSET, H, VMAX, evalTw, getTimeline, sampleTimeline } from '@/lib/engine/simulator'
import { baseStepIndex, ballHolderAfter, ballHolderBefore, neighbourStep } from '@/lib/engine/ballHolder'
import type { Play } from '@/lib/types/play'

const play = (): Play => ({ ...toPlayInsert(), id: 'seed', createdAt: '', updatedAt: '' })

describe('evalTw', () => {
  const tw = { fx: 0, fy: 0, tx: 10, ty: 20, t0: 1, t1: 3, a: 0.25 }
  it('holds the start before t0 and the target after t1', () => {
    expect(evalTw(tw, 0)).toEqual({ x: 0, y: 0 })
    expect(evalTw(tw, 3)).toEqual({ x: 10, y: 20 })
    expect(evalTw(tw, 99)).toEqual({ x: 10, y: 20 })
  })
  it('is half way at the midpoint (symmetric trapezoid)', () => {
    const m = evalTw(tw, 2)
    expect(m.x).toBeCloseTo(5, 6)
    expect(m.y).toBeCloseTo(10, 6)
  })
  it('bends through the bezier control point', () => {
    const m = evalTw({ ...tw, via: [10, 0] }, 2)
    expect(m.x).toBeCloseTo(7.5, 6) // 0.25*0 + 0.5*10 + 0.25*10
    expect(m.y).toBeCloseTo(5, 6) // 0.25*0 + 0.5*0 + 0.25*20
  })
})

describe('step graph', () => {
  const p = play()
  it('branch steps start from the main step they branch off', () => {
    expect(baseStepIndex(p, 2)).toBe(1)
    expect(baseStepIndex(p, 6)).toBe(1) // "1a" branches off step 1, not step 5
    expect(baseStepIndex(p, 7)).toBe(2) // "3a" replays step 3 from the end of step 2
  })
  it('Next / Prev skip branches', () => {
    expect(neighbourStep(p, 5, 1)).toBeNull() // last main step
    expect(neighbourStep(p, 1, 1)).toBe(2)
    expect(neighbourStep(p, 2, -1)).toBe(1)
    expect(neighbourStep(p, 6, -1)).toBe(1)
    expect(neighbourStep(p, 7, 1)).toBe(4) // branch offered after step 3, so on to step 4
  })
  it('the ball starts with RCB and follows the last receiver', () => {
    expect(ballHolderBefore(p, 0)).toBe('RCB')
    expect(ballHolderAfter(p, 1)).toBe('RB')
    expect(ballHolderAfter(p, 3)).toBe('RW')
    expect(ballHolderBefore(p, 6)).toBe('RB') // branch from step 1
    expect(ballHolderAfter(p, 6)).toBe('RCB')
  })
})

describe('simulateStep on the pattern-of-play data', () => {
  const p = play()

  it('chains steps: a step starts where the previous one ended', () => {
    const s1 = getTimeline(p, 1)
    const s2 = getTimeline(p, 2)
    for (const id of Object.keys(s1.end)) {
      expect(s2.start[id].x).toBeCloseTo(s1.end[id].x, 9)
      expect(s2.start[id].y).toBeCloseTo(s1.end[id].y, 9)
    }
  })

  it('a branch starts from the end of its base step, not the step listed before it', () => {
    const base = getTimeline(p, 1).end
    const alt = getTimeline(p, 6).start
    expect(alt.RB.x).toBeCloseTo(base.RB.x, 9)
    expect(alt.RB.y).toBeCloseTo(base.RB.y, 9)
    expect(Math.hypot(alt.RB.x - getTimeline(p, 5).end.RB.x, alt.RB.y - getTimeline(p, 5).end.RB.y)).toBeGreaterThan(1)
  })

  it('our moves arrive on target', () => {
    const tl = getTimeline(p, 1)
    expect(tl.end.RB.x).toBeCloseTo(63.5, 1)
    expect(tl.end.RB.y).toBeCloseTo(44, 1)
    expect(tl.end.CAM.x).toBeCloseTo(46.5, 1)
    expect(tl.end.CAM.y).toBeCloseTo(62, 1)
  })

  it('defenders respect VMAX, and AMAX except for contact pushes between defenders', () => {
    let samples = 0
    let overAccel = 0
    for (let i = 0; i < p.steps.length; i++) {
      const { frames } = getTimeline(p, i)
      for (let k = 2; k < frames.length; k++) {
        for (const id of Object.keys(frames[k].players).filter((x) => x.startsWith('o'))) {
          const a = frames[k - 2].players[id]
          const b = frames[k - 1].players[id]
          const c = frames[k].players[id]
          const v1 = Math.hypot(c.x - b.x, c.y - b.y) / H
          const v0 = Math.hypot(b.x - a.x, b.y - a.y) / H
          expect(v1).toBeLessThanOrEqual(VMAX + 1) // separation can nudge slightly past the cap
          samples++
          if (Math.abs(v1 - v0) / H > AMAX * 1.2) overAccel++
        }
      }
    }
    expect(overAccel / samples).toBeLessThan(0.002) // only where two defenders touch and are pushed apart
  })

  it('a marker stands goal-side of his attacker (oCB2 vs ST)', () => {
    const tl = getTimeline(p, 3)
    expect(tl.end.oCB2.y).toBeGreaterThan(tl.end.ST.y)
  })

  it('defenders react: oLM presses RB during step 1', () => {
    const tl = getTimeline(p, 1)
    const d0 = Math.hypot(tl.start.oLM.x - tl.start.RB.x, tl.start.oLM.y - tl.start.RB.y)
    const d1 = Math.hypot(tl.end.oLM.x - tl.end.RB.x, tl.end.oLM.y - tl.end.RB.y)
    expect(d1).toBeLessThan(d0 - 4)
    expect(tl.frames.at(-1)!.marks.some((m) => m.from === 'oLM' && m.to === 'RB')).toBe(true)
  })

  it('defenders do not stack on one spot', () => {
    for (const i of [1, 3, 4]) {
      const end = getTimeline(p, i).end
      const opp = Object.keys(end).filter((x) => x.startsWith('o'))
      for (let a = 0; a < opp.length; a++) {
        for (let b = a + 1; b < opp.length; b++) {
          expect(Math.hypot(end[opp[a]].x - end[opp[b]].x, end[opp[a]].y - end[opp[b]].y)).toBeGreaterThan(1.2)
        }
      }
    }
  })

  it('the ball is carried, flies on a pass, and is carried by the receiver', () => {
    const tl = getTimeline(p, 1) // RCB -> RB between 0.3s and 1.6s
    const before = sampleTimeline(tl, 0.1).ball
    expect(before.holder).toBe('RCB')
    expect(before.flying).toBe(false)
    const mid = sampleTimeline(tl, 1.0).ball
    expect(mid.flying).toBe(true)
    expect(mid.holder).toBeNull()
    const after = sampleTimeline(tl, 2.0).ball
    expect(after.holder).toBe('RB')
    // carried ball sits BALL_OFFSET from the holder along their facing
    const f = sampleTimeline(tl, 2.0)
    const rb = f.players.RB
    expect(Math.hypot(after.x - rb.x, after.y - rb.y)).toBeCloseTo(BALL_OFFSET, 6)
  })

  it('lobs arc (lift > 0 mid-flight, 0 at the ends); ground passes stay flat', () => {
    const lob = getTimeline(p, 7) // CAM -> RW lob 2.4s..4.9s
    expect(sampleTimeline(lob, 3.65).ball.lift).toBeGreaterThan(0.9)
    expect(sampleTimeline(lob, 0.5).ball.lift).toBe(0)
    const ground = getTimeline(p, 1)
    expect(sampleTimeline(ground, 1.0).ball.lift).toBe(0)
  })

  it('players turn at a limited rate towards their face target', () => {
    const tl = getTimeline(p, 3) // CAM faces RB at 0, then up the pitch (towards [46.5, 105]) at 1.6s
    let maxTurn = 0
    for (let k = 1; k < tl.frames.length; k++) {
      let d = tl.frames[k].players.CAM.face - tl.frames[k - 1].players.CAM.face
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      maxTurn = Math.max(maxTurn, Math.abs(d))
    }
    expect(maxTurn).toBeLessThanOrEqual(7 * H + 1e-9) // never snaps
    expect(maxTurn).toBeGreaterThan(0.05) // but does turn
    expect(sampleTimeline(tl, 3.5).players.CAM.face).toBeCloseTo(-Math.PI / 2, 1) // settled, facing up the pitch
  })

  it('works for a plain draft play with no rules', () => {
    const draft: Play = {
      ...play(),
      id: 'd',
      players: [{ id: 'a', team: 'ours', label: 'A', x: 10, y: 10 }, { id: 'b', team: 'opp', label: 'B', x: 30, y: 60 }],
      steps: [{ ...play().steps[0], duration: 2, faceTargets: [], defenderRules: {}, passes: [], moves: [] }],
    }
    const tl = getTimeline(draft, 0)
    expect(tl.frames.length).toBe(121)
    expect(tl.end.b.x).toBeCloseTo(30, 6)
  })
})

describe('facing without a ball', () => {
  it('defenders keep facing down the pitch when the play has no ball', () => {
    const draft: Play = {
      ...play(),
      id: 'noball',
      players: [{ id: 'a', team: 'ours', label: 'A', x: 10, y: 10 }, { id: 'b', team: 'opp', label: 'B', x: 30, y: 60 }],
      steps: [{ ...play().steps[0], duration: 1, faceTargets: [], defenderRules: {}, passes: [], moves: [] }],
    }
    const tl = getTimeline(draft, 0)
    expect(tl.end.b.face).toBeCloseTo(Math.PI / 2, 6) // not turned towards a phantom ball at (0, 0)
    expect(tl.end.a.face).toBeCloseTo(-Math.PI / 2, 6)
  })
})
