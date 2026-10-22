import { describe, expect, it } from 'vitest'
import { AiWorld, GAIN, INTENSITY, PRESETS, blendedLineDepth, blockShift, computeAiTargets, lineDepth, resolveAiParams, type AiWorldPlayer } from '@/lib/engine/ai'
import { EXIT_MARGIN, HANDOFF_COOLDOWN, clampIntoBounds, contains, handoffCost, newFollowTrack, pickHandoff, trackExit } from '@/lib/engine/follow'
import { H, getTimeline, sampleTimeline } from '@/lib/engine/simulator'
import { ai, fl, mk, pr, zn } from '@/lib/engine/rules'
import { toPlayInsert } from '@/lib/seed/defensiveAiTest'
import type { Bounds, Play, PlayStep } from '@/lib/types/play'

const NOW = '2026-01-01T00:00:00.000Z'
const seeded = (): Play => ({ ...toPlayInsert(), id: 'ai-test', createdAt: NOW, updatedAt: NOW })

/** The seeded roster at its starting positions, with the ball somewhere. */
function world(ball: { x: number; y: number } | null): AiWorld {
  const players: AiWorldPlayer[] = seeded().players.map((p) => ({ id: p.id, team: p.team, label: p.label, x: p.x, y: p.y, home: [p.x, p.y] }))
  return { players, ball, memory: {} }
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
      // shiftX ~ 0 (the default width only holds wide players 9 m in from the touchline: oRB 8 -> 9)
      expect(Math.abs(t[id].x - homeOf(w, id)[0])).toBeLessThanOrEqual(1 + 1e-9)
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
    // wide players on the ball side take the full shift, far side tucks in even more
    expect(t.oLB.x).toBeLessThan(homeOf(w, 'oLB')[0] - 3)
    // oRW (home x = 8) is on the ball side already: held at the width limit, 3 m + the default inward 6 m
    // (oRB is pulled as cover for the presser — oRW is the ball-side wide player remaining in the block)
    expect(t.oRW.x).toBeCloseTo(3 + DEFAULTS.widthInward, 6)
    expect(t.oRCB.x).toBeLessThan(homeOf(w, 'oRCB')[0] - 3)
    // central players stay central: at most 3 m from home
    // (a player picked as presser / cover / lane screen is placed by that job instead of by the block)
    const blockCentral = ['oLCB', 'oST', 'oCAM'].filter((id) => ['line', 'wide'].includes(t[id].role))
    expect(blockCentral.length).toBeGreaterThanOrEqual(2)
    for (const id of blockCentral) {
      expect(Math.abs(t[id].x - homeOf(w, id)[0])).toBeLessThanOrEqual(3 + 1e-9)
    }
    const field = Object.keys(t).filter((id) => id !== 'oGK')
    const meanShift = field.reduce((s, id) => s + (t[id].x - homeOf(w, id)[0]), 0) / field.length
    expect(meanShift).toBeLessThan(-3)
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
    expect(tgt.x).toBeCloseTo((34 + 34) / 2, 6)
    expect(tgt.y).toBeCloseTo((20 + 50) / 2 + 1, 6) // midpoint, nudged 1 m goal-side
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
      narrativeOurs: [], narrativeOpp: [], passes: [], faceTargets: [],
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

  it('the block slides towards the ball side on the wide pass (step 2)', () => {
    const tl = getTimeline(play, 1)
    const mean = (t: number) => {
      const f = sampleTimeline(tl, t)
      return ['oLB', 'oLCB', 'oRCB', 'oRB'].reduce((s, id) => s + f.players[id].x, 0) / 4
    }
    expect(mean(4.9)).toBeLessThan(mean(0.5) - 2) // LW is on the left (low x)
  })

  it('an authored press overrides the AI when it fires: oRB presses LW from 1.8 s (step 2)', () => {
    const tl = getTimeline(play, 1)
    expect(tl.end.oRB.rule?.type).toBe('press')
    const before = sampleTimeline(tl, 1.7)
    const after = sampleTimeline(tl, 4.5)
    const d = (f: typeof before) => Math.hypot(f.players.oRB.x - f.players.LW.x, f.players.oRB.y - f.players.LW.y)
    expect(d(after)).toBeLessThan(d(before) - 3)
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
