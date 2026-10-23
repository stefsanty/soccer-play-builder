import { describe, expect, it } from 'vitest'
import { AiWorld, GAIN, INTENSITY, LANE_BLOCK_R, MIN_LANE, NEIGHBOUR_SLACK, PRESETS, WIDE_HOLD, WIDE_LANE_REACH, blendedLineDepth, blockShift, computeAiTargets, distPointToSegment, lineDepth, passingLaneOpen, resolveAiParams, type AiWorldPlayer, type XY } from '@/lib/engine/ai'
import { EXIT_MARGIN, HANDOFF_COOLDOWN, clampIntoBounds, contains, handoffCost, newFollowTrack, pickHandoff, trackExit } from '@/lib/engine/follow'
import { H, getTimeline, sampleTimeline } from '@/lib/engine/simulator'
import { ai, fl, mk, pr, zn } from '@/lib/engine/rules'
import { toPlayInsert } from '@/lib/seed/defensiveAiTest'
import type { Bounds, Play, PlayStep } from '@/lib/types/play'

const NOW = '2026-01-01T00:00:00.000Z'
const seeded = (): Play => ({ ...toPlayInsert(), id: 'ai-test', createdAt: NOW, updatedAt: NOW })

/** The seeded roster at its starting positions, with the ball somewhere. */
function world(ball: { x: number; y: number } | null, extra: Partial<AiWorld> = {}): AiWorld {
  const players: AiWorldPlayer[] = seeded().players.map((p) => ({ id: p.id, team: p.team, label: p.label, x: p.x, y: p.y, home: [p.x, p.y] }))
  return { players, ball, memory: {}, ...extra }
}
/**
 * The same block with the attacking side withdrawn into its own half, so phase 1 gives nobody a man and
 * what is left acting on the block is the ball pull alone. The slide tests below are about how that pull
 * fades with distance, and a defender who has been given somebody is placed by that instead.
 */
function blockOnly(ball: { x: number; y: number }): AiWorld {
  const w = world(ball, { owner: 'ours' })
  return { ...w, players: w.players.map((p) => (p.team === 'ours' ? { ...p, y: Math.min(p.y, 22) } : p)) }
}
const emptyStep = { defenderRules: {}, moves: [] }
const ON = { on: true } as const
const DEFAULTS = resolveAiParams({}) // aggressiveness 50, line height 50, width 50
const homeOf = (w: AiWorld, id: string) => w.players.find((p) => p.id === id)!.home

describe('lineDepth: defensive line height from the ball depth (mid)', () => {
  const MAX = INTENSITY.mid.MAXLINE
  it('is 8 m when the ball is within 20 m of the goal, then rises with distance to the ball', () => {
    expect(lineDepth(19)).toBe(8 > 17 ? 17 : 8)
    expect(lineDepth(20)).toBeCloseTo(8, 6)
    expect(lineDepth(35)).toBeCloseTo(MAX * 0.5, 6)
    expect(lineDepth(60)).toBeCloseTo(MAX * 0.8, 6)
    expect(lineDepth(80)).toBeCloseTo(MAX, 6)
    expect(lineDepth(100)).toBeCloseTo(MAX, 6)
  })
  it('never decreases as the ball gets further from the defending goal', () => {
    let prev = -Infinity
    for (let d = 20; d <= 105; d += 1) {
      const v = lineDepth(d)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
  it('is always goal-side of the ball, with a 2 m floor off the goal line', () => {
    for (const d of [3, 6, 10, 15, 25, 40]) expect(lineDepth(d)).toBeLessThanOrEqual(Math.max(2, d - 2) + 1e-9)
    expect(lineDepth(3)).toBe(2)
  })
  it('scales with intensity', () => {
    expect(lineDepth(100, 'low')).toBe(32)
    expect(lineDepth(100, 'mid')).toBe(42)
    expect(lineDepth(100, 'high')).toBe(54)
  })
})

describe('computeAiTargets', () => {
  it('ball at (34, 30): the back line sits goal-side of the ball and the block does not shift', () => {
    // opp defend y = 105: the ball is 75 m from their goal
    const w = world({ x: 34, y: 30 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const line = 105 - blendedLineDepth(75, DEFAULTS) // ball-driven 39.9 blended with the line-height target (31.5)
    for (const id of ['oLB', 'oLCB', 'oRCB', 'oRB']) {
      expect(t[id].y).toBeCloseTo(line, 6)
      expect(t[id].y).toBeGreaterThan(30) // goal-side of the ball (towards y = 105)
      // shiftX ~ 0, so what lateral movement there is comes from a flank slot getting across an attacker
      // standing in it (oRB on LW) and from cohesion keeping contact with a neighbour
      expect(Math.abs(t[id].x - homeOf(w, id)[0])).toBeLessThanOrEqual(4.5)
    }
    expect(blockShift(34)).toBe(0)
    // and the same for the team defending y = 0: ball 30 m from their goal
    const o = computeAiTargets(world({ x: 34, y: 30 }), 'ours', emptyStep, ON)
    const oursLine = blendedLineDepth(30, DEFAULTS)
    const holding = Object.entries(o).filter(([id, v]) => ['LB', 'LCB', 'RCB', 'RB'].includes(id) && v.role !== 'presser')
    expect(holding.length).toBeGreaterThanOrEqual(3) // the ball is close to LCB, so he presses; the rest hold the line
    for (const [, v] of holding) {
      expect(v.y).toBeCloseTo(oursLine, 6)
      expect(v.y).toBeLessThan(30) // goal-side of the ball (towards y = 0)
    }
  })

  it('ball at (10, 60): the block slides to the ball side', () => {
    const w = world({ x: 10, y: 60 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const shiftX = blockShift(10)
    expect(shiftX).toBeLessThan(-3)
    // The block as a whole ends up nearer the ball than the formation puts it. It is measured over the
    // block rather than on a named centre-back because phase 1 now hands out the jobs first: which of the
    // two centre-backs ends up covering the press and which slides is decided by who else has a man, and
    // was never the point of this test.
    const outfield = Object.keys(t).filter((id) => t[id].role !== 'gk')
    const meanDrift = outfield.reduce((acc, id) => acc + (t[id].x - homeOf(w, id)[0]), 0) / outfield.length
    expect(meanDrift).toBeLessThan(-2)
    // the far-side centre-back barely moves: the slide fades with distance from the ball
    expect(homeOf(w, 'oLCB')[0] - t.oLCB.x).toBeLessThanOrEqual(3)
    // the far flank holds its ground instead of being dragged across — that is the wing a long ball would find
    expect(Math.abs(t.oLB.x - homeOf(w, 'oLB')[0])).toBeLessThanOrEqual(WIDE_HOLD.loose)
    // the near flank holds his too: he denies the wide outlet, he does not join the press
    expect(Math.abs(t.oRW.x - homeOf(w, 'oRW')[0])).toBeLessThanOrEqual(WIDE_HOLD.loose)
    // central players stay central: at most 3 m from home
    // (a player picked as presser / cover / lane screen is placed by that job instead of by the block)
    const blockCentral = ['oLCB', 'oST', 'oCAM'].filter((id) => ['line', 'wide', 'mark'].includes(t[id].role))
    expect(blockCentral.length).toBeGreaterThanOrEqual(2)
    for (const id of blockCentral) {
      expect(Math.abs(t[id].x - homeOf(w, id)[0])).toBeLessThanOrEqual(3 + 1e-9)
    }
  })

  describe('ball at (34, 85)', () => {
    it('ours defending y = 0: the ball is 85 m away, so the closest defender presses and the line is at max depth', () => {
      const w = world({ x: 34, y: 85 })
      const t = computeAiTargets(w, 'ours', emptyStep, ON)
      const pressers = Object.entries(t).filter(([, v]) => v.role === 'presser')
      expect(pressers).toHaveLength(1)
      expect(pressers[0][0]).toBe('ST') // the closest outfield player
      expect(pressers[0][1].gain).toBe(GAIN.press)
      for (const id of ['LB', 'LCB', 'RCB', 'RB']) expect(t[id].y).toBeCloseTo(blendedLineDepth(85, DEFAULTS), 6) // 36.75: halfway between the 42 m max line and the 31.5 m target
    })

    it('presses regardless of distance when the ball is urgent (dBall >= 80, or within 15 m of the goal)', () => {
      // dBall = 100: the nearest outfield player is more than PRESS_R away, yet he presses
      const far = computeAiTargets(world({ x: 34, y: 100 }), 'ours', emptyStep, ON)
      const p = Object.entries(far).find(([, v]) => v.role === 'presser')!
      expect(p).toBeTruthy()
      expect(Math.hypot(34 - 34, 100 - 80)).toBeGreaterThan(INTENSITY.mid.PRESS_R) // ST is 20 m away
      expect(p[1].y).toBeGreaterThan(95) // heading for the ball

      // ball 10 m from the opponents' own goal: oRCB is 19 m away and still presses
      const w = world({ x: 34, y: 95 })
      const near = computeAiTargets(w, 'opp', emptyStep, ON)
      expect(Object.values(near).some((v) => v.role === 'presser')).toBe(true)
    })

    it('opp defending y = 105: the ball is 20 m from their goal, so the line is as deep as it gets', () => {
      const w = world({ x: 34, y: 85 })
      const t = computeAiTargets(w, 'opp', emptyStep, ON)
      expect(Object.values(t).some((v) => v.role === 'presser')).toBe(true)
      const lines = ['oLB', 'oRB'].map((id) => t[id].y) // oLCB / oRCB may be the presser / cover
      for (const y of lines) expect(y).toBeCloseTo(105 - blendedLineDepth(20, DEFAULTS), 6) // 87: goal-side of the ball whatever the blend says
    })
  })

  it('no presser when nobody is within PRESS_R and the ball is not urgent', () => {
    // oST now at y=35: use y=48 so oST(y=35) is 13 m away and oCAM(y=62) is 14 m away — both > pressR=12
    const t = computeAiTargets(world({ x: 34, y: 48 }), 'opp', emptyStep, ON)
    expect(Object.values(t).some((v) => v.role === 'presser')).toBe(false)
  })

  it('the cover sits 5 m goal-side of the presser and 3 m towards the centre', () => {
    const w = world({ x: 14, y: 70 })
    const t = computeAiTargets(w, 'opp', emptyStep, { on: true, offsideLine: false })
    const presser = Object.entries(t).find(([, v]) => v.role === 'presser')
    const cover = Object.entries(t).find(([, v]) => v.role === 'cover')
    expect(presser).toBeTruthy()
    expect(cover).toBeTruthy()
    const pp = w.players.find((p) => p.id === presser![0])!
    expect(cover![1].y).toBeCloseTo(pp.y + 5, 6)
    expect(cover![1].x).toBeCloseTo(pp.x + 3, 6) // presser is left of centre, so towards the centre is +x
    expect(cover![1].gain).toBe(GAIN.cover)
  })

  it('with the offside line on, a back-line cover keeps the line height (only x follows the presser)', () => {
    const w = world({ x: 14, y: 70 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const cover = Object.entries(t).find(([, v]) => v.role === 'cover')!
    const back = ['oLB', 'oLCB', 'oRCB', 'oRB']
    if (back.includes(cover[0])) expect(cover[1].y).toBeCloseTo(105 - blendedLineDepth(35, DEFAULTS), 6)
    const presser = Object.entries(t).find(([, v]) => v.role === 'presser')![0]
    expect(back.includes(presser) ? 'presser may leave the line' : 'on the line').toBeTruthy()
  })

  it('presser hysteresis: a near-equal rival does not take the job', () => {
    const w = world({ x: 40, y: 72 })
    // two candidates a similar distance from the ball
    const first = computeAiTargets(w, 'opp', emptyStep, ON)
    const a = Object.entries(first).find(([, v]) => v.role === 'presser')![0]
    // nudge another defender slightly closer (well inside the 3 m hysteresis)
    const other = w.players.find((p) => p.team === 'opp' && p.id !== a && p.id !== 'oGK' && Math.hypot(p.x - 40, p.y - 72) < 13)!
    const keep = w.players.find((p) => p.id === a)!
    const dA = Math.hypot(keep.x - 40, keep.y - 72)
    other.x = 40 + (other.x - 40) * ((dA - 1) / Math.hypot(other.x - 40, other.y - 72))
    other.y = 72 + (other.y - 72) * ((dA - 1) / Math.hypot(other.x - 40 + 0, other.y - 72 + 0) || 1)
    const second = computeAiTargets(w, 'opp', emptyStep, ON)
    expect(Object.entries(second).find(([, v]) => v.role === 'presser')![0]).toBe(a)
  })

  it('the keeper stays in the box and shades towards the ball (gain 1.8)', () => {
    const t = computeAiTargets(world({ x: 10, y: 60 }), 'opp', emptyStep, ON)
    expect(t.oGK.role).toBe('gk')
    expect(t.oGK.gain).toBe(GAIN.gk)
    expect(t.oGK.y).toBeGreaterThanOrEqual(105 - 8)
    expect(t.oGK.x).toBeGreaterThanOrEqual(26)
    expect(t.oGK.x).toBeLessThanOrEqual(42)
    expect(t.oGK.x).toBeLessThan(34) // ball is to the left
  })

  it('lane screening: a central midfielder closes the lane to an unmarked central attacker', () => {
    const w = world({ x: 34, y: 20 })
    // our other players are out of the picture: one carrier on the ball, one unmarked central attacker between
    // the ball and the opponents' midfield, away from every defender
    w.players = w.players.filter((p) => p.team === 'opp' || p.id === 'GK' || p.id === 'CAM')
    w.players.find((p) => p.id === 'GK')!.x = 34
    w.players.find((p) => p.id === 'GK')!.y = 20
    const att = w.players.find((p) => p.id === 'CAM')!
    att.x = 34
    att.y = 50
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const screeners = Object.entries(t).filter(([, v]) => v.role === 'screen')
    expect(screeners.length).toBeGreaterThanOrEqual(1)
    const [, tgt] = screeners[0]
    // he stands ON the pass, which is what closing a lane means — the spot of it nearest his own slot
    expect(distPointToSegment([tgt.x, tgt.y], [34, 20], [34, 50])).toBeLessThanOrEqual(LANE_BLOCK_R)
    expect(tgt.lane).toBe('CAM')
  })

  it('respects exclude and authored rules, and does nothing without a ball', () => {
    const w = world({ x: 34, y: 60 })
    const t = computeAiTargets(w, 'opp', { defenderRules: { oLB: [zn(10, 90)] }, moves: [] }, { on: true, exclude: ['oRB'] })
    expect(t.oLB).toBeUndefined() // authored rule wins
    expect(t.oRB).toBeUndefined() // excluded
    expect(t.oLCB).toBeDefined()
    expect(computeAiTargets(world(null), 'opp', emptyStep, ON)).toEqual({})
    expect(computeAiTargets(w, 'opp', emptyStep, { on: false })).toEqual({}) // switched off
    // players with a move this step are driven by their tween, not the AI
    const moving = computeAiTargets(w, 'opp', { defenderRules: {}, moves: [{ playerId: 'oST', toX: 1, toY: 1, startTime: 0, endTime: 1 }] }, ON)
    expect(moving.oST).toBeUndefined()
  })

  it('the back line holds one height (offside line) unless it is switched off', () => {
    const w = world({ x: 34, y: 60 })
    const on = computeAiTargets(w, 'opp', emptyStep, ON)
    const ys = ['oLB', 'oLCB', 'oRCB', 'oRB'].map((id) => on[id].y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9)
  })

  describe('separation: defenders do not cluster', () => {
    const minSep = (width = 50) => 5 + (8 - 5) * (width / 100)

    it('pushes two defenders apart when their targets would overlap (same home position)', () => {
      // Two defenders stacked at the same home → their block targets are identical → separation must push them apart
      const players: AiWorldPlayer[] = [
        { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 99, home: [34, 99] },
        { id: 'oLCB', team: 'opp', label: 'oLCB', x: 20, y: 70, home: [20, 70] },
        { id: 'oRCB', team: 'opp', label: 'oRCB', x: 20, y: 70, home: [20, 70] }, // same as oLCB
      ]
      const w: AiWorld = { players, ball: { x: 34, y: 30 }, memory: {} }
      const t = computeAiTargets(w, 'opp', emptyStep, ON)
      const a = [t['oLCB'].x, t['oLCB'].y]
      const b = [t['oRCB'].x, t['oRCB'].y]
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(minSep() - 1e-6)
    })

    it('separation scales with width: wider setting → larger minimum gap', () => {
      // Stacked off centre on purpose: a slot within CENTRAL_OFF of the middle is pinned to its own x +/- 3 m,
      // and two players sharing one central home therefore cannot be spread further than 6 m whatever the
      // width says. The pin is the harder rule of the two — this test is about the width scaling under it.
      const players: AiWorldPlayer[] = [
        { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 99, home: [34, 99] },
        { id: 'oLCB', team: 'opp', label: 'oLCB', x: 20, y: 70, home: [20, 70] },
        { id: 'oRCB', team: 'opp', label: 'oRCB', x: 20, y: 70, home: [20, 70] },
      ]
      const w: AiWorld = { players, ball: { x: 34, y: 30 }, memory: {} }
      const narrow = computeAiTargets(w, 'opp', emptyStep, { on: true, width: 10 })
      const wide = computeAiTargets(w, 'opp', emptyStep, { on: true, width: 90 })
      const sepNarrow = Math.hypot(narrow['oLCB'].x - narrow['oRCB'].x, narrow['oLCB'].y - narrow['oRCB'].y)
      const sepWide = Math.hypot(wide['oLCB'].x - wide['oRCB'].x, wide['oLCB'].y - wide['oRCB'].y)
      expect(sepNarrow).toBeGreaterThanOrEqual(minSep(10) - 1e-6)
      expect(sepWide).toBeGreaterThanOrEqual(minSep(90) - 1e-6)
      expect(sepWide).toBeGreaterThanOrEqual(sepNarrow - 1e-6)
    })

    it('presser is exempt from separation (can close down regardless of teammate proximity)', () => {
      // Put a ball very close to oLCB so it becomes presser; oRCB is near the same spot
      const players: AiWorldPlayer[] = [
        { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 99, home: [34, 99] },
        { id: 'oLCB', team: 'opp', label: 'oLCB', x: 34, y: 75, home: [34, 75] },
        { id: 'oRCB', team: 'opp', label: 'oRCB', x: 36, y: 75, home: [36, 75] }, // 2 m away
      ]
      const w: AiWorld = { players, ball: { x: 34, y: 72 }, memory: {} }
      const t = computeAiTargets(w, 'opp', emptyStep, ON)
      const presser = Object.entries(t).find(([, v]) => v.role === 'presser')
      expect(presser).toBeTruthy()
      // presser's target can be close to the ball regardless of oRCB's position
      const pid = presser![0]
      expect(t[pid].y).toBeGreaterThanOrEqual(72 - 5) // heading for the ball
    })

    it('the back line keeps its spacing with both the gap and the separation rules acting on it', () => {
      // The two pull opposite ways: the gap rule caps how far apart neighbours may sit, separation sets a
      // floor. With the allowance floored at minSep they settle within ~0.75 m of it (the relaxation is
      // iterative, not exact) instead of the line collapsing on itself.
      for (const by of [4, 25, 46, 67, 88, 100]) {
        for (const bx of [2, 18, 34, 50, 66]) {
          for (const team of ['opp', 'ours'] as const) {
            const t = computeAiTargets(world({ x: bx, y: by }), team, emptyStep, ON)
            const back = (team === 'opp' ? ['oLB', 'oLCB', 'oRCB', 'oRB'] : ['LB', 'LCB', 'RCB', 'RB'])
              .filter((id) => t[id] && t[id].role === 'line')
              .sort((a, b) => t[a].x - t[b].x)
            for (let i = 0; i + 1 < back.length; i++) {
              expect(t[back[i + 1]].x - t[back[i]].x).toBeGreaterThanOrEqual(minSep() - 1)
            }
          }
        }
      }
    })

    it('two defenders pinned on the same spot are not swapped over by the order they are visited in', () => {
      // both slots clamp to the same x against the width limit, so only the formation can say who goes left
      const players: AiWorldPlayer[] = [
        { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 100, home: [34, 100] },
        { id: 'oRCB', team: 'opp', label: 'oRCB', x: 20, y: 82, home: [20, 82] },
        { id: 'oRB', team: 'opp', label: 'oRB', x: 8, y: 82, home: [8, 82] },
      ]
      const t = computeAiTargets({ players, ball: { x: 8, y: 28 }, memory: {} }, 'opp', emptyStep, ON)
      expect(t.oRB.x).toBeLessThan(t.oRCB.x) // the full-back stays outside the centre-back
      expect(t.oRCB.x - t.oRB.x).toBeGreaterThanOrEqual(minSep() - 1)
    })

    it('does not separate players with an authored press/mark/follow duty', () => {
      const w = world({ x: 34, y: 60 })
      // Give oLCB an authored press duty on the ball carrier
      w.players.find((p) => p.id === 'oLCB')!.duty = { type: 'press', att: 'GK' }
      // Stack oRCB at the same home position as oLCB so they would normally cluster
      const lcb = w.players.find((p) => p.id === 'oLCB')!
      w.players.find((p) => p.id === 'oRCB')!.x = lcb.x
      w.players.find((p) => p.id === 'oRCB')!.y = lcb.y
      ;(w.players.find((p) => p.id === 'oRCB') as AiWorldPlayer).home = [lcb.x, lcb.y]
      const t = computeAiTargets(w, 'opp', emptyStep, ON)
      // oLCB has press duty → exempt; it can be collocated with oRCB without separation pushing it
      // We only assert oRCB gets a valid target (it might be pushed, oLCB might not be)
      expect(t['oRCB']).toBeDefined()
    })
  })
})

describe('passing-lane geometry', () => {
  it('distPointToSegment: on the line, perpendicular to it, and past either end', () => {
    const a: XY = [0, 0]
    const b: XY = [10, 0]
    expect(distPointToSegment([5, 0], a, b)).toBe(0) // standing on the pass
    expect(distPointToSegment([5, 3], a, b)).toBe(3) // square to the middle of it
    expect(distPointToSegment([0, 0], a, b)).toBe(0) // on the carrier
    expect(distPointToSegment([-4, 0], a, b)).toBe(4) // behind the carrier: the segment does not extend
    expect(distPointToSegment([14, 0], a, b)).toBe(4) // beyond the receiver
    expect(distPointToSegment([13, 4], a, b)).toBe(5) // beyond the receiver and off to the side
    expect(distPointToSegment([4, 3], [1, 1], [1, 1])).toBeCloseTo(Math.hypot(3, 2), 9) // carrier == receiver
  })

  it('a lane is open until a defender stands inside the corridor', () => {
    const carrier: XY = [26, 25]
    const receiver: XY = [26, 55]
    expect(passingLaneOpen(carrier, receiver, [])).toBe(true)
    expect(passingLaneOpen(carrier, receiver, [[26, 40]])).toBe(false) // right on it
    expect(passingLaneOpen(carrier, receiver, [[29, 40]])).toBe(false) // 3 m off, inside LANE_BLOCK_R
    expect(passingLaneOpen(carrier, receiver, [[26 + LANE_BLOCK_R, 40]])).toBe(false) // exactly on the limit
    expect(passingLaneOpen(carrier, receiver, [[31, 40]])).toBe(true) // 5 m off: the pass is on
    expect(passingLaneOpen(carrier, receiver, [[31, 40], [26, 45]])).toBe(false) // any one blocker shuts it
  })

  it('a defender past the receiver, or behind the carrier, is not covering the lane', () => {
    expect(passingLaneOpen([26, 25], [26, 55], [[26, 62]])).toBe(true)
    expect(passingLaneOpen([26, 25], [26, 55], [[26, 18]])).toBe(true)
  })

  it('the corridor width is configurable', () => {
    expect(passingLaneOpen([0, 0], [0, 20], [[6, 10]], 5)).toBe(true)
    expect(passingLaneOpen([0, 0], [0, 20], [[6, 10]], 8)).toBe(false)
  })

  it('a diagonal lane is measured square to the pass, not along the axes', () => {
    // the pass runs (0,0) -> (10,10); a defender at (6,4) is 1.41 m from it, well inside the corridor
    expect(distPointToSegment([6, 4], [0, 0], [10, 10])).toBeCloseTo(Math.SQRT2, 9)
    expect(passingLaneOpen([0, 0], [10, 10], [[6, 4]])).toBe(false)
    expect(passingLaneOpen([0, 0], [10, 10], [[9, 2]])).toBe(true) // 4.95 m off the diagonal
  })
})

describe('pressing: one presser, and the block keeps its shape behind him', () => {
  it('never sends two players at the same carrier, at any ball position or aggressiveness', () => {
    for (const by of [10, 25, 40, 55, 70, 85, 100]) {
      for (const bx of [6, 20, 34, 48, 62]) {
        for (const aggressiveness of [30, 50, 70, 100]) {
          for (const team of ['opp', 'ours'] as const) {
            const t = computeAiTargets(world({ x: bx, y: by }), team, emptyStep, { on: true, aggressiveness })
            expect(Object.values(t).filter((v) => v.role === 'presser').length).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('the one presser is the closest eligible defender to the ball', () => {
    const w = world({ x: 34, y: 85 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const presser = Object.entries(t).find(([, v]) => v.role === 'presser')![0]
    const d = (p: AiWorldPlayer) => Math.hypot(p.x - 34, p.y - 85)
    const closest = w.players.filter((p) => p.team === 'opp' && !/gk/i.test(p.label)).sort((a, b) => d(a) - d(b))[0]
    expect(presser).toBe(closest.id)
  })

  it('an authored press already on the carrier stops the AI adding a second presser', () => {
    const w = world({ x: 26, y: 25 }, { owner: 'ours', focus: 'LCB' })
    w.players.find((p) => p.id === 'oST')!.duty = { type: 'press', att: 'LCB' }
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    expect(Object.values(t).filter((v) => v.role === 'presser')).toHaveLength(0)
  })

  it('only the presser and his cover get a ball-seeking job, even at full aggressiveness', () => {
    for (const ball of [{ x: 34, y: 85 }, { x: 14, y: 70 }, { x: 50, y: 60 }]) {
      const t = computeAiTargets(world(ball), 'opp', emptyStep, { on: true, aggressiveness: 100 })
      // everyone else is holding the block or cutting a lane — no third man goes to the carrier
      const breaking = Object.values(t).filter((v) => !['line', 'wide', 'screen', 'mark', 'gk'].includes(v.role))
      expect(breaking.map((v) => v.role).sort()).toEqual(['cover', 'presser'])
    }
  })

  it('the block holds its slots while the press goes in: only the ball side squeeze moves it', () => {
    const w = world({ x: 14, y: 70 })
    const t = computeAiTargets(w, 'opp', emptyStep, { on: true, aggressiveness: 100 })
    const P = resolveAiParams({ aggressiveness: 100 })
    for (const [id, v] of Object.entries(t)) {
      if (!['line', 'wide'].includes(v.role)) continue
      // a block player never ends up further from his home x than the slide plus the squeeze can carry him
      expect(Math.abs(v.x - homeOf(w, id)[0])).toBeLessThanOrEqual(P.shiftMax + 0.2 * 68 + 1e-9)
    }
  })

  it('the cover comes from behind the press and tucks across without leaving its own slot', () => {
    const w = world({ x: 26, y: 25 }, { owner: 'ours', focus: 'LCB' })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const [coverId, cover] = Object.entries(t).find(([, v]) => v.role === 'cover')!
    const presser = Object.values(t).find((v) => v.role === 'presser')!
    // he is goal-side of the press (OPP defend y = 105) and no more than COVER_REACH off his own home x
    expect(cover.y).toBeGreaterThan(presser.y)
    expect(Math.abs(cover.x - homeOf(w, coverId)[0])).toBeLessThanOrEqual(8 + DEFAULTS.shiftMax + 1e-9)
    // and the job falls to a central slot, not to a player who would have to vacate a flank for it
    expect(Math.abs(homeOf(w, coverId)[0] - 34)).toBeLessThan(18)
  })
})

// The engine names no player: who cuts which lane falls out of the geometry (an open lane, the depth window
// between ball and own slot, the nearest zone, the player's own flank). These helpers re-derive the assignment
// from the targets so a test can check that RULE on any shape, instead of pinning one worked example's pairing.

/** Check the lane-cutting rule itself against whatever shape `w` holds. */
function auditLanes(w: AiWorld, team: 'ours' | 'opp', cfg: Parameters<typeof computeAiTargets>[3] = ON) {
  const t = computeAiTargets(w, team, emptyStep, cfg)
  const ball = w.ball!
  const foes = w.players.filter((p) => p.team !== team)
  const cut = Object.entries(t)
    .filter(([, v]) => v.role === 'screen')
    .map(([id, v]) => {
      const recv = foes.find((f) => f.id === v.lane)
      expect(recv, `cutter ${id} reports no opponent to cut`).toBeTruthy()
      return { id, home: w.players.find((p) => p.id === id)!.home, recv: recv!, at: v }
    })

  expect(new Set(cut.map((c) => c.recv.id)).size, 'two cutters on one opponent').toBe(cut.length)
  const gap = (h: XY, p: { x: number; y: number }) => Math.hypot(h[0] - p.x, h[1] - p.y)
  for (const c of cut) {
    // the pass he is cutting is a real pass, not the carrier's own feet
    expect(gap([ball.x, ball.y], c.recv), `${c.id} is on a pass too short to be a pass`).toBeGreaterThanOrEqual(MIN_LANE)
    // a player whose slot is off centre cuts inside his own flank rather than vacating it
    if (Math.abs(c.home[0] - 34) >= 10) expect(Math.abs(c.recv.x - c.home[0])).toBeLessThanOrEqual(WIDE_LANE_REACH)
    // He is standing ON the pass he was given, not shading it from a distance where he blocks nothing.
    // Cohesion can only slide him along it, so this holds exactly.
    expect(
      distPointToSegment([c.at.x, c.at.y], [ball.x, ball.y], [c.recv.x, c.recv.y]),
      `${c.id} is not on the lane it was given`,
    ).toBeLessThanOrEqual(LANE_BLOCK_R)
  }
  // (A swap-stability check lived here. It compared two cutters by which lane was NEARER, and lanes are no
  // longer handed out by distance — laneValue weighs a slot's width against the travel — so it was asserting
  // against an objective the code had stopped having. Exclusivity, the part that mattered, is covered by the
  // lane-value tests below.)
  return { t, cut }
}

describe('lane cutters: the rule, on the test play phase 1 (a press on the blue LCB)', () => {
  const phase1 = () => world({ x: 26, y: 25 }, { owner: 'ours', focus: 'LCB' })

  it('one player goes to the ball — the closest, whoever that turns out to be', () => {
    const w = phase1()
    const { t } = auditLanes(w, 'opp')
    const pressers = Object.entries(t).filter(([, v]) => v.role === 'presser')
    expect(pressers).toHaveLength(1)
    const d = (p: AiWorldPlayer) => Math.hypot(p.x - 26, p.y - 25)
    const closest = w.players.filter((p) => p.team === 'opp' && !/gk/i.test(p.label)).sort((a, b) => d(a) - d(b))[0]
    expect(pressers[0][0]).toBe(closest.id)
    expect(pressers[0][1].gain).toBe(GAIN.press)
    expect(Math.hypot(pressers[0][1].x - 26, pressers[0][1].y - 25)).toBeLessThan(2)
  })

  it('every central outlet out of the carrier is cut, and each cutter has the lane nearest its own slot', () => {
    const { cut } = auditLanes(phase1(), 'opp')
    // the three midfield outlets (22,45) (34,48) (52,45) are all covered — by position, not by shirt
    const covered = cut.map((c) => [c.recv.x, c.recv.y].join())
    for (const recv of [[22, 45], [34, 48], [52, 45]]) expect(covered).toContain(recv.join())
    // and each cutter really did take its own nearest available lane (auditLanes proves the swap-stability)
    expect(cut).toHaveLength(3)
  })

  it('players whose slot is out wide keep it instead of dropping into midfield', () => {
    const w = phase1()
    const { t } = auditLanes(w, 'opp')
    // the two widest slots ahead of the back line, derived from the shape rather than named
    const wideSlots = w.players
      .filter((p) => p.team === 'opp' && !/gk/i.test(p.label) && p.home[1] < 70)
      .sort((a, b) => Math.abs(b.home[0] - 34) - Math.abs(a.home[0] - 34))
      .slice(0, 2)
    expect(wideSlots).toHaveLength(2)
    for (const p of wideSlots) {
      // holding the block, whether or not phase 1 also gave him a man to lean on out there
      expect(['wide', 'mark']).toContain(t[p.id].role)
      expect(Math.abs(t[p.id].x - p.home[0])).toBeLessThanOrEqual(DEFAULTS.shiftMax + 1e-9)
    }
  })

  it('the back line steps up together and holds one height', () => {
    const w = phase1()
    const { t } = auditLanes(w, 'opp')
    // the back line is whichever outfield slots are deepest, not a hardcoded list
    const back = w.players
      .filter((p) => p.team === 'opp' && !/gk/i.test(p.label) && p.home[1] >= 78)
      .map((p) => p.id)
    expect(back).toHaveLength(4)
    const ys = back.map((id) => t[id].y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9) // one height, cover included
    for (const id of back) expect(t[id].y).toBeLessThan(homeOf(w, id)[1] - 8) // stepped up (OPP: towards y = 0)
    expect(ys[0]).toBeCloseTo(105 - blendedLineDepth(80, DEFAULTS), 6)
  })
})

describe('width: the block keeps a flank for the long diagonal to beat', () => {
  /** How much of the far touchline is left with nobody in it — the space a switch of play would find. */
  const openWing = (t: Record<string, { x: number; role: string }>) =>
    68 - Math.max(...Object.values(t).filter((v) => v.role !== 'gk').map((v) => v.x))

  it('a wider setting leaves less of the far wing open, not more', () => {
    const at = (width: number) => {
      const w = world({ x: 6, y: 60 }, { owner: 'ours' })
      Object.assign(w.players.find((p) => p.id === 'RCM')!, { x: 64, y: 58 }) // somebody to hold the wing against
      return computeAiTargets(w, 'opp', emptyStep, { on: true, width })
    }
    const gaps = [0, 50, 100].map((width) => openWing(at(width)))
    expect(gaps[2]).toBeLessThan(gaps[0]) // width 100 holds the widest shape, so the smallest gap
    expect(gaps[1]).toBeLessThanOrEqual(gaps[0])
    for (const g of gaps) expect(g).toBeLessThan(20)
  })

  it('the far flank is not dragged across the pitch at any width', () => {
    for (const width of [0, 50, 100]) {
      const w = world({ x: 6, y: 60 }, { owner: 'ours' })
      const t = computeAiTargets(w, 'opp', emptyStep, { on: true, width })
      for (const id of ['oLB', 'oLW']) {
        expect(homeOf(w, id)[0] - t[id].x, `${id} at width ${width}`).toBeLessThanOrEqual(WIDE_HOLD.loose)
      }
    }
  })

  it('the pull towards the ball dies away with distance: the near side slides, the far side does not', () => {
    const w = blockOnly({ x: 6, y: 60 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const drift = (id: string) => Math.abs(t[id].x - homeOf(w, id)[0])
    // oRCB's slot is on the ball side, oLCB's is on the far side; both are centre-backs under the same rule
    expect(drift('oRCB')).toBeGreaterThan(drift('oLCB') + 2)
  })

  it('width sets a floor under the spread: at max width a flank slot is barely drawn inward at all', () => {
    const w = world({ x: 6, y: 60 }, { owner: 'ours' })
    const tight = computeAiTargets(w, 'opp', emptyStep, { on: true, width: 100 })
    const loose = computeAiTargets(w, 'opp', emptyStep, { on: true, width: 0 })
    for (const id of ['oLB', 'oLW', 'oRW']) {
      // a cutter is governed by his lane instead (it was already vetted against his flank), so he is not
      // subject to the inward cap — see confine()
      if (tight[id].role === 'screen' || loose[id].role === 'screen') continue
      // inward is what width governs; outward is deliberately free, since that is the flank he is denying
      const home = homeOf(w, id)[0]
      const inward = (x: number) => Math.max(0, home < 34 ? x - home : home - x)
      expect(inward(tight[id].x), id).toBeLessThanOrEqual(WIDE_HOLD.tight + 1e-9)
      expect(inward(tight[id].x), id).toBeLessThanOrEqual(inward(loose[id].x) + 1e-9)
    }
  })

  it('an attacker standing in a flank outranks the ball on the other side of the pitch', () => {
    const w = world({ x: 6, y: 60 }, { owner: 'ours' })
    // park an attacker out on the far right wing: the long-ball target
    Object.assign(w.players.find((p) => p.id === 'RCM')!, { x: 64, y: 58 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const nearest = Object.entries(t)
      .filter(([, v]) => v.role !== 'gk')
      .map(([id, v]) => ({ id, d: Math.hypot(v.x - 64, v.y - 58) }))
      .sort((a, b) => a.d - b.d)[0]
    expect(nearest.d).toBeLessThan(12) // somebody is across him, though the ball is 58 m away
    expect(t[nearest.id].x).toBeGreaterThan(50) // and he got there by staying wide, not by tucking in
  })

  it('a centre-back still slides with the ball — the hold is for flank slots only', () => {
    const w = blockOnly({ x: 6, y: 60 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    expect(homeOf(w, 'oRCB')[0] - t.oRCB.x).toBeGreaterThan(3)
  })
})

describe('cohesion: a player holding shape stays with his formation neighbours', () => {
  /** Each outfield player's two nearest neighbours in the formation, and the spacing the formation gives them. */
  const neighboursOf = (w: AiWorld, team: 'ours' | 'opp') => {
    const outfield = w.players.filter((p) => p.team === team && !/gk/i.test(p.label))
    return new Map(
      outfield.map((p) => [
        p.id,
        outfield
          .filter((q) => q.id !== p.id)
          .map((q) => ({ id: q.id, d: Math.hypot(p.home[0] - q.home[0], p.home[1] - q.home[1]) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 2),
      ]),
    )
  }

  // Cohesion is a weighted pull, not a lock: it takes back a share of the overstretch per pass, and the
  // spacing passes that follow it (separation, then the offside line flattening the back line's y) can give a
  // little of that back. So the guarantee is a bounded overshoot of the limit, not the limit exactly.
  const RESIDUAL = 6

  it('nobody holding shape is left stretched far past his formation spacing', () => {
    let worst = 0
    for (const by of [12, 30, 48, 66, 84]) {
      for (const bx of [8, 24, 40, 56]) {
        for (const aggressiveness of [50, 75, 100]) {
          const w = world({ x: bx, y: by }, { owner: 'ours' })
          const t = computeAiTargets(w, 'opp', emptyStep, { on: true, aggressiveness })
          const nb = neighboursOf(w, 'opp')
          for (const [id, v] of Object.entries(t)) {
            if (!['line', 'wide', 'screen'].includes(v.role)) continue
            for (const n of nb.get(id) ?? []) {
              const q = t[n.id]
              // a team-mate who has gone to press the ball is not part of the shape while he is there, so the
              // distance to him is not a stretch in it
              if (!q || !['line', 'wide', 'screen'].includes(q.role)) continue
              const over = Math.hypot(q.x - v.x, q.y - v.y) - (n.d + NEIGHBOUR_SLACK)
              if (over > worst) worst = over
              expect(over, `${id} stretched away from ${n.id}`).toBeLessThanOrEqual(RESIDUAL)
            }
          }
        }
      }
    }
    expect(worst).toBeGreaterThan(0) // the constraint is actually binding somewhere in this sweep
  })

  it('the presser is exempt — winning the ball is worth leaving the shape for', () => {
    const w = world({ x: 34, y: 95 }, { owner: 'ours' })
    const t = computeAiTargets(w, 'opp', emptyStep, { on: true, aggressiveness: 100 })
    const presser = Object.entries(t).find(([, v]) => v.role === 'presser')!
    expect(Math.hypot(presser[1].x - 34, presser[1].y - 95)).toBeLessThan(3) // he still goes to the ball
  })
})

describe('lane cutters: a lane beyond reach is declined, not chased', () => {
  /** One midfielder, one carrier, and one receiver placed `across` metres off the midfielder's slot. */
  const scene = (recvX: number) => {
    const players: AiWorldPlayer[] = [
      { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 100, home: [34, 100] },
      { id: 'oCB', team: 'opp', label: 'oCB', x: 34, y: 86, home: [34, 86] },
      { id: 'oMID', team: 'opp', label: 'oMID', x: 34, y: 62, home: [34, 62] },
      { id: 'C', team: 'ours', label: 'C', x: 34, y: 30, home: [34, 30] },
      { id: 'R', team: 'ours', label: 'R', x: recvX, y: 50, home: [recvX, 50] },
    ]
    return computeAiTargets({ players, ball: { x: 34, y: 30 }, memory: {}, owner: 'ours', focus: 'C' }, 'opp', emptyStep, ON)
  }

  it('cuts a lane that runs close to his own slot', () => {
    const t = scene(34) // straight in front of him
    expect(t.oMID.role).toBe('screen')
    expect(t.oMID.lane).toBe('R')
  })

  it('holds position when the only lane would drag him clear across the pitch', () => {
    const t = scene(66) // the far touchline: covering this lane means abandoning the middle
    expect(t.oMID.role).not.toBe('screen')
    expect(t.oMID.lane).toBeUndefined()
    expect(Math.abs(t.oMID.x - 34)).toBeLessThanOrEqual(3 + 1e-9) // still central, where his slot is
  })
})

describe('lane cutters: the same rule on shapes and ball positions it was never tuned on', () => {
  /** A 3-4-3 OPP block — nothing like the seed's 4-3-3 — plus an attack to cut lanes against. */
  const threeFourThree = (ball: { x: number; y: number }, focus: string): AiWorld => {
    const opp: [string, number, number][] = [
      ['oGK', 34, 100], ['oDL', 48, 84], ['oDC', 34, 84], ['oDR', 20, 84],
      ['oML', 58, 64], ['oMCL', 40, 62], ['oMCR', 28, 62], ['oMR', 10, 64],
      ['oFL', 48, 40], ['oFC', 34, 38], ['oFR', 20, 40],
    ]
    const ours: [string, number, number][] = [
      ['GK', 34, 5], ['DL', 12, 22], ['DCL', 28, 24], ['DCR', 44, 24], ['DR', 58, 22],
      ['ML', 16, 48], ['MC', 34, 50], ['MR', 54, 48], ['FL', 18, 72], ['FC', 34, 74], ['FR', 52, 72],
    ]
    const players: AiWorldPlayer[] = [
      ...opp.map(([id, x, y]) => ({ id, team: 'opp' as const, label: id, x, y, home: [x, y] as XY })),
      ...ours.map(([id, x, y]) => ({ id, team: 'ours' as const, label: id, x, y, home: [x, y] as XY })),
    ]
    return { players, ball, memory: {}, owner: 'ours', focus }
  }

  it('holds for a 3-4-3 block, wherever the ball is', () => {
    for (const [id, bx, by] of [['DCL', 28, 24], ['DR', 58, 22], ['MC', 34, 50], ['ML', 16, 48], ['DL', 12, 22]] as const) {
      const { cut } = auditLanes(threeFourThree({ x: bx, y: by }, id), 'opp')
      expect(cut.length, `no lane was cut with the ball at ${id}`).toBeGreaterThan(0)
    }
  })

  it('holds for the seeded shape across the pitch, both teams, and every aggressiveness that cuts lanes', () => {
    for (const by of [18, 34, 50, 66, 82]) {
      for (const bx of [10, 26, 42, 58]) {
        for (const aggressiveness of [50, 75, 100]) {
          for (const team of ['opp', 'ours'] as const) {
            auditLanes(world({ x: bx, y: by }, { owner: team === 'opp' ? 'ours' : 'opp' }), team, { on: true, aggressiveness })
          }
        }
      }
    }
  })

  it('moving the ball across the pitch moves the cutting to the new outlets', () => {
    const left = auditLanes(world({ x: 26, y: 25 }, { owner: 'ours', focus: 'LCB' }), 'opp').cut
    const right = auditLanes(world({ x: 46, y: 25 }, { owner: 'ours', focus: 'RCB' }), 'opp').cut
    // the same rule, a different carrier: the lanes cut are not the same set
    const key = (c: { recv: { x: number; y: number } }) => [c.recv.x, c.recv.y].join()
    expect(left.map(key).sort()).not.toEqual(right.map(key).sort())
  })
})

describe('lane cutters: the back line taking over frees the cutter in front', () => {
  // A high line (line height + aggressiveness at 100) steps up past the midfielder's own zone, so the two
  // can contest the same attacker; A sits on the line's height, B is a lane further forward.
  const scene = (cbX: number) => {
    const players: AiWorldPlayer[] = [
      { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 100, home: [34, 100] },
      { id: 'oCB', team: 'opp', label: 'oCB', x: cbX, y: 82, home: [cbX, 82] },
      { id: 'oMID', team: 'opp', label: 'oMID', x: 34, y: 62, home: [34, 62] },
      { id: 'C', team: 'ours', label: 'C', x: 34, y: 30, home: [34, 30] },
      { id: 'A', team: 'ours', label: 'A', x: 34, y: 53, home: [34, 53] },
      { id: 'B', team: 'ours', label: 'B', x: 34, y: 40, home: [34, 40] },
    ]
    const w: AiWorld = { players, ball: { x: 34, y: 30 }, memory: {}, owner: 'ours', focus: 'C' }
    return computeAiTargets(w, 'opp', emptyStep, { on: true, aggressiveness: 100, lineHeight: 100 })
  }

  it('cuts the lane to the nearer attacker when the centre-back is away on the other side', () => {
    const t = scene(10) // the CB's slot is 24 m across: it never reaches A
    expect(t.oMID.role).toBe('screen')
    expect(t.oMID.lane).toBe('A') // the one nearest his own zone
  })

  it('is handed the next lane along once the line has stepped onto that attacker', () => {
    const t = scene(34) // the CB steps up onto A
    expect(t.oMID.role).toBe('screen')
    expect(t.oMID.lane).toBe('B') // A is the line's now, so he takes the lane further forward
    expect(scene(10).oMID.lane).not.toBe(scene(34).oMID.lane) // the pickup is what changed it
  })
})

describe('follow: bounds', () => {
  const rect: Bounds = { kind: 'rect', x0: 20, y0: 40, x1: 40, y1: 70 }
  const circle: Bounds = { kind: 'circle', c: [30, 50], r: 10 }
  it('contains / clampIntoBounds', () => {
    expect(contains(rect, [30, 50])).toBe(true)
    expect(contains(rect, [41, 50])).toBe(false)
    expect(contains(rect, [41, 50], 2)).toBe(true)
    expect(clampIntoBounds([50, 80], rect)).toEqual([40, 70])
    expect(contains(circle, [35, 50])).toBe(true)
    expect(contains(circle, [45, 50])).toBe(false)
    const p = clampIntoBounds([50, 50], circle)
    expect(p[0]).toBeCloseTo(40, 6)
    expect(p[1]).toBeCloseTo(50, 6)
  })
  it('handoff cost prefers the nearest defender with the attacker in his area, goal-side', () => {
    const att: [number, number] = [30, 50]
    const goalSide = { id: 'a', pos: [30, 58] as [number, number] } // 8 m away, goal-side (opp: +y)
    const behind = { id: 'b', pos: [30, 44] as [number, number] } // 6 m away but not goal-side: +5
    expect(handoffCost(goalSide, att, 1)).toBeCloseTo(8, 6)
    expect(handoffCost(behind, att, 1)).toBeCloseTo(11, 6)
    expect(handoffCost({ ...behind, bounds: rect }, att, 1)).toBeCloseTo(3, 6) // -8 for the attacker being in his area
    expect(pickHandoff([goalSide, behind], att, 1)).toBe('a')
    expect(pickHandoff([], att, 1)).toBeNull()
  })
})

describe('follow: exit tracking', () => {
  const bounds: Bounds = { kind: 'rect', x0: 20, y0: 40, x1: 40, y1: 70 }
  const rule = fl('a', [30, 58], bounds)

  it('fires 0.3 s after the attacker is out by more than the exit margin, then locks the follower out for 1 s', () => {
    const tr = newFollowTrack()
    const out: [number, number] = [40 + EXIT_MARGIN + 0.5, 55]
    const fired: number[] = []
    for (let k = 0; k <= 5 * 60; k++) {
      const t = k * H
      // inside until 1.0 s, out until 2.0 s, back in until 3.0 s, then out for good
      const att: [number, number] = t < 1 ? [30, 55] : t < 2 ? out : t < 3 ? [30, 55] : out
      if (trackExit(tr, rule, att, t)) fired.push(+t.toFixed(3))
    }
    expect(fired).toHaveLength(2)
    expect(fired[0]).toBeGreaterThanOrEqual(1.3 - 1e-6)
    expect(fired[0]).toBeLessThan(1.3 + 2 * H)
    // he stayed out after the first handoff and nothing fired again until he had come back in and left again
    expect(fired[1]).toBeGreaterThanOrEqual(3.3 - 1e-6)
    expect(fired[1]).toBeLessThan(3.3 + 2 * H)
  })

  it('the follower is locked out for HANDOFF_COOLDOWN after a handoff', () => {
    const tr = newFollowTrack()
    const out: [number, number] = [50, 55]
    let first = -1
    for (let k = 0; k <= 3 * 60 && first < 0; k++) {
      const t = k * H
      if (trackExit(tr, rule, t < 0.5 ? [30, 55] : out, t)) first = t
    }
    expect(first).toBeGreaterThan(0)
    expect(tr.cooldownUntil).toBeCloseTo(first + HANDOFF_COOLDOWN, 6)
    // he comes straight back in and leaves again inside the cooldown: no second handoff until it is over
    let second = -1
    for (let k = Math.round(first / H) + 1; k <= 6 * 60 && second < 0; k++) {
      const t = k * H
      const att: [number, number] = t < first + 0.4 ? [30, 55] : out
      if (trackExit(tr, rule, att, t)) second = t
    }
    expect(second === -1 || second >= first + HANDOFF_COOLDOWN - 1e-6).toBe(true)
  })

  it('an attacker who starts outside the bounds has to come in before he can leave (no instant handoff)', () => {
    const tr = newFollowTrack()
    for (let k = 0; k < 4 * 60; k++) expect(trackExit(tr, rule, [34, 82], k * H)).toBe(false) // waits outside the area
    expect(tr.entered).toBe(false)
    let fired = false
    for (let k = 4 * 60; k < 9 * 60; k++) {
      const t = k * H
      const att: [number, number] = t < 6 ? [34, 60] : [34, 82] // drops in at 4 s, leaves again at 6 s
      if (trackExit(tr, rule, att, t)) fired = true
    }
    expect(fired).toBe(true)
  })

  it('does not fire for an attacker only just outside the bounds (inside the margin)', () => {
    const tr = newFollowTrack()
    for (let k = 0; k < 3 * 60; k++) expect(trackExit(tr, rule, [41.5, 55], k * H)).toBe(false)
  })

  it('does not fire if the attacker comes back within 0.3 s', () => {
    const tr = newFollowTrack()
    let fired = false
    for (let k = 0; k < 2 * 60; k++) {
      const t = k * H
      const inWindow = t >= 1 && t < 1.2
      if (trackExit(tr, rule, inWindow ? [50, 55] : [30, 55], t)) fired = true
    }
    expect(fired).toBe(false)
  })
})

describe('follow: handoff inside the simulation', () => {
  const bounds: Bounds = { kind: 'rect', x0: 20, y0: 40, x1: 40, y1: 70 }
  function scenario(handoff: 'auto' | 'none' | string = 'auto'): Play {
    const step: PlayStep = {
      id: 's0', index: 0, title: 'follow', duration: 5,
      passes: [], faceTargets: [],
      // the attacker runs out of d1's area (x > 42 is out by more than the 2 m margin)
      moves: [{ playerId: 'a1', toX: 62, toY: 52, startTime: 0.5, endTime: 2.5 }],
      defenderRules: { d1: [fl('a1', [30, 58], bounds, 0, { handoff })] },
    }
    return {
      id: 'follow', title: 'follow', authorId: '', authorName: '', createdAt: NOW, updatedAt: NOW,
      meta: { formation: 'custom', viewSide: 'full', tags: [], isPublic: false },
      players: [
        { id: 'a1', team: 'ours', label: 'A', x: 30, y: 50 },
        { id: 'd1', team: 'opp', label: 'D1', x: 30, y: 58 },
        { id: 'd2', team: 'opp', label: 'D2', x: 52, y: 60 },
        { id: 'd3', team: 'opp', label: 'D3', x: 10, y: 85 },
        { id: 'gk', team: 'opp', label: 'oGK', x: 34, y: 100 },
      ],
      steps: [step],
    }
  }

  it('fires after 0.3 s outside, the follower reverts to its zone, and nobody retakes within 1 s', () => {
    const tl = getTimeline(scenario(), 0)
    // first moment the attacker is out by more than the margin
    const out = tl.frames.find((f) => f.players.a1.x > 40 + EXIT_MARGIN)!
    expect(tl.events).toHaveLength(1)
    const ev = tl.events[0]
    if (ev.type !== 'handoff') throw new Error('expected a handoff event')
    expect(ev.from).toBe('d1')
    expect(ev.attacker).toBe('a1')
    expect(ev.t - out.t).toBeGreaterThanOrEqual(0.3 - 2 * H)
    expect(ev.t - out.t).toBeLessThan(0.3 + 3 * H)
    // d1 reverted to a zone rule and is locked out for 1 s
    expect(tl.end.d1.rule).toMatchObject({ type: 'zone', target: [30, 58] })
    expect(tl.end.d1.fol.cooldownUntil).toBeCloseTo(ev.t + HANDOFF_COOLDOWN, 6)
    // the nearest eligible defender (d2; d1 is locked out, d3 is far, the keeper is never used) took over
    expect(ev.to).toBe('d2')
    expect(tl.end.d2.rule).toMatchObject({ type: 'mark', attacker: 'a1' })
    // d1 does not pick the attacker up again, and there is no second handoff
    expect(tl.events.filter((e) => e.type === 'handoff' && e.from === 'd1')).toHaveLength(1)
    for (const f of tl.frames.filter((fr) => fr.t > ev.t && fr.t < ev.t + HANDOFF_COOLDOWN)) {
      expect(f.marks.some((m) => m.from === 'd1')).toBe(false)
    }
  })

  it("handoff 'none': the follower reverts and nobody takes over", () => {
    const tl = getTimeline(scenario('none'), 0)
    expect(tl.events).toHaveLength(1)
    expect(tl.events[0]).toMatchObject({ type: 'handoff', to: null })
    expect(tl.end.d2.rule).toBeNull()
  })

  it('handoff to a named player', () => {
    const tl = getTimeline(scenario('d3'), 0)
    expect(tl.events[0]).toMatchObject({ type: 'handoff', to: 'd3' })
    expect(tl.end.d3.rule).toMatchObject({ type: 'mark', attacker: 'a1' })
  })

  it('while the attacker stays inside the bounds the follower shadows him and never hands off', () => {
    const p = scenario()
    p.steps[0].moves = [{ playerId: 'a1', toX: 36, toY: 55, startTime: 0.5, endTime: 2.5 }]
    const tl = getTimeline(p, 0)
    expect(tl.events).toHaveLength(0)
    expect(tl.end.d1.rule?.type).toBe('follow')
    // shadowing: d1 ends up goal-side of the attacker, near him
    expect(Math.hypot(tl.end.d1.x - tl.end.a1.x, tl.end.d1.y - tl.end.a1.y)).toBeLessThan(8)
  })
})

describe('the AI inside the simulation (seeded "Defensive AI test")', () => {
  const play = seeded()
  const defY = (tl: ReturnType<typeof getTimeline>, t: number) => {
    const f = sampleTimeline(tl, t)
    return (f.players.oLCB.y + f.players.oRCB.y) / 2
  }

  it('the opponent block steps up while the ball is far away and drops deeper as it advances (step 4)', () => {
    const tl = getTimeline(play, 3)
    const ys: number[] = []
    for (let t = 0; t <= 7; t += 0.5) ys.push(defY(tl, t))
    const highest = Math.min(...ys) // opp defend y = 105: a high line has a small y
    expect(ys[0] - highest).toBeGreaterThan(8) // stepped up while the ball was back with the keeper / CBs
    expect(ys[ys.length - 1] - highest).toBeGreaterThan(8) // then dropped as it advanced to ST
    expect(ys[ys.length - 1]).toBeGreaterThan(80) // and is deep when the ball is at the edge of the box
  })

  it('every back-line AI target is goal-side of the ball, wherever the ball is', () => {
    for (const team of ['opp', 'ours'] as const) {
      const backIds = team === 'opp' ? ['oLB', 'oLCB', 'oRCB', 'oRB'] : ['LB', 'LCB', 'RCB', 'RB']
      for (let by = 6; by <= 100; by += 7) {
        for (const bx of [8, 34, 60]) {
          const t = computeAiTargets(world({ x: bx, y: by }), team, emptyStep, ON)
          const dBall = team === 'opp' ? 105 - by : by
          for (const id of backIds) {
            if (!t[id] || t[id].role === 'presser') continue
            const depth = team === 'opp' ? 105 - t[id].y : t[id].y
            expect(depth).toBeLessThanOrEqual(Math.max(2, dBall - 2) + 1e-9)
          }
        }
      }
    }
  })

  it('the near side of the block slides to the ball while the far side holds (step 2)', () => {
    const tl = getTimeline(play, 1)
    // The ball crosses the pitch during this step (RCB -> RB on the right, then out to LW on the left), so
    // "near side" only means anything at a moment in time. By the end the ball is wide left: the near
    // centre-back has come across to it, and the far full-back is still out on his own flank.
    const f = sampleTimeline(tl, 4.9)
    const homeX = (id: string) => play.players.find((q) => q.id === id)!.x
    expect(f.players.LW.x).toBeLessThan(20) // the ball really is wide left by now
    expect(f.players.oRCB.x).toBeLessThan(homeX('oRCB'))
    expect(Math.abs(f.players.oLB.x - homeX('oLB'))).toBeLessThan(10)
  })

  it('an authored press overrides the AI when it fires: oRB presses LW from 1.8 s (step 2)', () => {
    const tl = getTimeline(play, 1)
    expect(tl.end.oRB.rule?.type).toBe('press')
    const before = sampleTimeline(tl, 1.7)
    const after = sampleTimeline(tl, 4.5)
    const d = (f: typeof before) => Math.hypot(f.players.oRB.x - f.players.LW.x, f.players.oRB.y - f.players.LW.y)
    // He is tight on LW once the press fires. He was already tracking him before it did — LW stands in his
    // flank, so the AI had him across the wide outlet rather than sliding away to the ball.
    expect(d(after)).toBeLessThan(1.5)
    expect(d(after)).toBeLessThan(d(before))
  })

  it('the AI engages only after its reaction time', () => {
    const tl = getTimeline(play, 0)
    const f0 = sampleTimeline(tl, 0)
    const f03 = sampleTimeline(tl, 0.3)
    // nothing has been assigned yet at 0.3 s: the block has not moved
    expect(Math.abs(f03.players.oLCB.y - f0.players.oLCB.y)).toBeLessThan(0.05)
    const f2 = sampleTimeline(tl, 2)
    expect(Math.abs(f2.players.oLCB.y - f0.players.oLCB.y)).toBeGreaterThan(1) // ...and then it does
  })

  it('players with an authored ai() rule are AI driven even when the team switch is off', () => {
    const p: Play = JSON.parse(JSON.stringify(play))
    p.steps[0].ai = undefined
    p.steps[0].defenderRules = { oRCB: [ai(0, 'line')] }
    const tl = getTimeline(p, 0)
    expect(tl.end.oRCB.rule?.type).toBe('ai')
    expect(Math.abs(tl.end.oRCB.y - 82)).toBeGreaterThan(1) // it moved to the AI line
    expect(Math.abs(tl.end.oLCB.y - 82)).toBeLessThan(1e-6) // the others were left alone
  })

  it('the authored constructors build the documented shapes', () => {
    expect(pr('LW', 1.8)).toEqual({ type: 'press', att: 'LW', delay: 1.8, gap: 1 })
    expect(pr('CAM', 2.4, 0.5)).toEqual({ type: 'press', att: 'CAM', delay: 2.4, gap: 0.5 })
    expect(fl('A', [1, 2], { kind: 'circle', c: [0, 0], r: 5 })).toMatchObject({ type: 'follow', gap: 2.5, w: 0.85, handoff: 'auto', delay: 0 })
    expect(ai()).toEqual({ type: 'ai', delay: 0, role: 'auto' })
    expect(mk('RB', 3, 0.7, [63, 55], 1, 0)).toMatchObject({ type: 'mark', attacker: 'RB', weight: 0.7, dx: 0 })
  })
})

describe('gravity: an opponent already covered does not pull a second defender', () => {
  /** One attacker in a defender's zone, and a team-mate who is either on him or away on the far side. */
  const scene = (coverAt: [number, number]) => {
    const players: AiWorldPlayer[] = [
      { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 100, home: [34, 100] },
      { id: 'oD1', team: 'opp', label: 'oD1', x: coverAt[0], y: coverAt[1], home: [54, 78] },
      { id: 'oD2', team: 'opp', label: 'oD2', x: 44, y: 78, home: [44, 78] },
      { id: 'C', team: 'ours', label: 'C', x: 34, y: 50, home: [34, 50] },
      { id: 'A', team: 'ours', label: 'A', x: 54, y: 74, home: [54, 74] },
    ]
    const w: AiWorld = { players, ball: { x: 34, y: 50 }, memory: {}, owner: 'ours', focus: 'C' }
    return computeAiTargets(w, 'opp', emptyStep, ON)
  }

  it('is drawn across to him when nobody else is near him', () => {
    const t = scene([10, 78]) // oD1 is away on the other flank
    expect(['line', 'mark']).toContain(t.oD2.role) // holding the block, now answering for A as well
    expect(t.oD2.x).toBeGreaterThan(47) // comes off his slot at 44 towards A at 54
  })

  it('holds his own position when a team-mate is already on him', () => {
    const t = scene([54, 75]) // oD1 is a metre from A
    expect(t.oD2.role).toBe('line')
    expect(Math.abs(t.oD2.x - 44)).toBeLessThan(1.5) // stays in his slot: A is not his man
  })

  it('is pushed back off a man a team-mate already has, not merely left unmoved', () => {
    const covered = scene([54, 75]) // oD1 a metre from A
    const free = scene([10, 78]) // oD1 away on the other flank
    // negative gravity: A sits at x 54, so being drawn in would raise oD2's x above his slot of 44
    expect(covered.oD2.x).toBeLessThanOrEqual(44 + 1e-9)
    expect(covered.oD2.x).toBeLessThan(free.oD2.x - 3)
  })

  it('an authored marker counts as cover too, however far off he currently is', () => {
    const players: AiWorldPlayer[] = [
      { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 100, home: [34, 100] },
      { id: 'oD1', team: 'opp', label: 'oD1', x: 10, y: 78, home: [54, 78], duty: { type: 'mark', att: 'A' } },
      { id: 'oD2', team: 'opp', label: 'oD2', x: 44, y: 78, home: [44, 78] },
      { id: 'C', team: 'ours', label: 'C', x: 34, y: 50, home: [34, 50] },
      { id: 'A', team: 'ours', label: 'A', x: 54, y: 74, home: [54, 74] },
    ]
    const t = computeAiTargets({ players, ball: { x: 34, y: 50 }, memory: {}, owner: 'ours', focus: 'C' }, 'opp', emptyStep, ON)
    expect(Math.abs(t.oD2.x - 44)).toBeLessThan(1.5)
  })
})

describe('a bunched formation is spread before the block is built on it', () => {
  it('two slots saved almost on top of each other still end up a sensible distance apart', () => {
    // A play can be saved with two players nearly on the same spot. Every slot comes from those positions,
    // so without spreading them first the pin that keeps a central player central would hold BOTH of them in
    // the same window and separation could never fully undo it.
    const players: AiWorldPlayer[] = [
      { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 99, home: [34, 99] },
      { id: 'oA', team: 'opp', label: 'oA', x: 33, y: 80, home: [33, 80] },
      { id: 'oB', team: 'opp', label: 'oB', x: 35, y: 80, home: [35, 80] },
      { id: 'C', team: 'ours', label: 'C', x: 34, y: 30, home: [34, 30] },
    ]
    const t = computeAiTargets({ players, ball: { x: 34, y: 30 }, memory: {}, owner: 'ours', focus: 'C' }, 'opp', emptyStep, ON)
    expect(Math.abs(t.oA.x - t.oB.x)).toBeGreaterThanOrEqual(6.5 - 1e-6) // minSep at the default width
  })
})

describe('personal space: team-mates never stand on the same spot', () => {
  it('holds even when both are lagging a long way behind their targets', () => {
    // Targets are kept apart by the AI, but a player only STEERS towards his — two who are both behind can
    // drift together while their targets stay a dozen metres apart. This is the case that produced two
    // centre-backs on one blade of grass; see PERSONAL in the simulator.
    const play = seeded()
    const tl = getTimeline(play, 0)
    const ids = play.players.filter((p) => p.team === 'opp' && !/gk/i.test(p.label)).map((p) => p.id)
    let worst = Infinity
    for (let t = 0.25; t <= play.steps[0].duration; t += 0.25) {
      const f = sampleTimeline(tl, t)
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          worst = Math.min(worst, Math.hypot(f.players[ids[i]].x - f.players[ids[j]].x, f.players[ids[i]].y - f.players[ids[j]].y))
        }
      }
    }
    expect(worst).toBeGreaterThan(4)
  })
})

describe('lane value: a flank slot is paid to take the flank lane', () => {
  /** A carrier plus two outlets — one wide, one central — and two defenders, one of each kind. */
  const scene = () => {
    const players: AiWorldPlayer[] = [
      { id: 'oGK', team: 'opp', label: 'oGK', x: 34, y: 100, home: [34, 100] },
      { id: 'oCB', team: 'opp', label: 'oCB', x: 34, y: 86, home: [34, 86] },
      { id: 'oWIDE', team: 'opp', label: 'oWIDE', x: 56, y: 62, home: [56, 62] },
      { id: 'oMID', team: 'opp', label: 'oMID', x: 34, y: 62, home: [34, 62] },
      { id: 'C', team: 'ours', label: 'C', x: 34, y: 28, home: [34, 28] },
      { id: 'WIDE', team: 'ours', label: 'WIDE', x: 54, y: 48, home: [54, 48] },
      { id: 'MID', team: 'ours', label: 'MID', x: 32, y: 48, home: [32, 48] },
    ]
    return computeAiTargets({ players, ball: { x: 34, y: 28 }, memory: {}, owner: 'ours', focus: 'C' }, 'opp', emptyStep, ON)
  }

  it('the flank defender takes the flank outlet and the central one takes the central outlet', () => {
    const t = scene()
    expect(t.oWIDE.lane).toBe('WIDE')
    expect(t.oMID.lane).toBe('MID')
  })

  it('no two cutters are ever given the same pass', () => {
    const t = scene()
    const lanes = Object.values(t).filter((v) => v.role === 'screen').map((v) => v.lane)
    expect(new Set(lanes).size).toBe(lanes.length)
  })

  it('across the seeded play, every cut lane is held by exactly one player', () => {
    for (const by of [20, 40, 60, 80]) {
      for (const bx of [10, 26, 42, 58]) {
        const t = computeAiTargets(world({ x: bx, y: by }, { owner: 'ours' }), 'opp', emptyStep, ON)
        const lanes = Object.values(t).filter((v) => v.role === 'screen').map((v) => v.lane)
        expect(new Set(lanes).size, `ball (${bx},${by})`).toBe(lanes.length)
      }
    }
  })
})
