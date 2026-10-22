// QA review of the defensive AI against the five-step "Defensive AI test" play and small constructed scenarios.
// Areas: 0 = shape and theory, 1 = press / mark / follow commands, 2 = position correctness, 3 = authored + AI interactions.

import { describe, expect, it } from 'vitest'
import { toPlayInsert } from '@/lib/seed/defensiveAiTest'
import { H, VMAX, getTimeline, sampleTimeline, type StepTimeline } from '@/lib/engine/simulator'
import { blendedLineDepth, computeAiTargets, lineDepth, resolveAiParams, type AiWorld, type AiWorldPlayer, type Team } from '@/lib/engine/ai'
import { fl, mk, pr, zn } from '@/lib/engine/rules'
import type { Play, PlayStep } from '@/lib/types/play'

const NOW = ''
const seeded = (): Play => ({ ...toPlayInsert(), id: 'qa', createdAt: NOW, updatedAt: NOW })
const emptyStep = { defenderRules: {}, moves: [] }
const ON = { on: true } as const

function world(ball: { x: number; y: number } | null, extra: Partial<AiWorld> = {}): AiWorld {
  const players: AiWorldPlayer[] = seeded().players.map((p) => ({ id: p.id, team: p.team, label: p.label, x: p.x, y: p.y, home: [p.x, p.y] }))
  return { players, ball, memory: {}, ...extra }
}
const homeOf = (w: AiWorld, id: string) => w.players.find((p) => p.id === id)!.home
const BACK = { opp: ['oLB', 'oLCB', 'oRCB', 'oRB'], ours: ['LB', 'LCB', 'RCB', 'RB'] } as const
const depthOf = (team: Team, y: number) => (team === 'opp' ? 105 - y : y)

function custom(players: Play['players'], steps: Partial<PlayStep>[]): Play {
  return {
    ...seeded(), id: 'c', players,
    steps: steps.map((s, i) => ({
      id: `s${i}`, index: i, title: 't', duration: 6, narrativeOurs: [], narrativeOpp: [], moves: [], passes: [], defenderRules: {}, faceTargets: [], ...s,
    })) as PlayStep[],
  }
}
const backLineY = (tl: StepTimeline, t: number) => {
  const f = sampleTimeline(tl, t)
  return (f.players.oLCB.y + f.players.oRCB.y) / 2
}

describe('QA 0 — defensive shape and theory', () => {
  const play = seeded()

  it('step 5 (OPP recycle the ball at their own back): the lines stay high instead of collapsing into their box', () => {
    const tl = getTimeline(play, 4)
    // the carrier is oRCB / oGK / oLCB, 3 to 23 m from their own goal: a defending shape would sit at y ~ 97-103
    const ys = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => backLineY(tl, t))
    // (a few metres of momentum from the end of step 4, where the block was still dropping to the ball at ST)
    expect(Math.max(...ys)).toBeLessThanOrEqual(ys[0] + 4)
    expect(ys[0] - ys[8]).toBeGreaterThan(12) // ...then it climbs a long way (to the in-possession line, ~68)
    expect(ys[8]).toBeLessThan(70) // and steps up to the (mid) maximum line, y = 105 - 42 = 63
  })

  it('step 5: the back line tracks the ball, not the dropping striker', () => {
    const tl = getTimeline(play, 4)
    const late = sampleTimeline(tl, 7.5)
    // ST has dropped to y = 55 (depth 50): the back line is nowhere near him
    expect(late.players.ST.y).toBeCloseTo(55, 0)
    expect(backLineY(tl, 7.5)).toBeGreaterThan(late.players.ST.y + 5)
    // the two centre-backs hold one height
    expect(Math.abs(late.players.oLCB.y - late.players.oRCB.y)).toBeLessThan(1.5)
  })

  it('no gaps: neighbours in a line stay within their formation spacing (+ slack), whatever the ball does', () => {
    for (const team of ['opp', 'ours'] as const) {
      const w = world(null)
      for (let by = 10; by <= 95; by += 17) {
        for (const bx of [4, 20, 34, 48, 64]) {
          const t = computeAiTargets({ ...w, ball: { x: bx, y: by } }, team, emptyStep, ON)
          const block = BACK[team].filter((id) => t[id] && !['presser', 'cover'].includes(t[id].role)).sort((a, b) => homeOf(w, a)[0] - homeOf(w, b)[0])
          for (let i = 0; i + 1 < block.length; i++) {
            const gap = t[block[i + 1]].x - t[block[i]].x
            const allowed = homeOf(w, block[i + 1])[0] - homeOf(w, block[i])[0] + 4
            expect(gap).toBeLessThanOrEqual(allowed + 1e-6)
          }
        }
      }
    }
  })

  it('the central zone is always covered by at least two outfield defenders', () => {
    for (const team of ['opp', 'ours'] as const) {
      const w = world(null)
      for (let by = 10; by <= 95; by += 17) {
        for (const bx of [4, 20, 34, 48, 64]) {
          const t = computeAiTargets({ ...w, ball: { x: bx, y: by } }, team, emptyStep, ON)
          const central = Object.entries(t).filter(([id, v]) => v.role !== 'gk' && Math.abs(v.x - 34) <= 14)
          expect(central.length).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it('the block always has a player goal-side of the ball (invariant)', () => {
    for (const team of ['opp', 'ours'] as const) {
      const w = world(null)
      for (let by = 6; by <= 100; by += 7) {
        for (const bx of [4, 34, 64]) {
          const t = computeAiTargets({ ...w, ball: { x: bx, y: by }, owner: team === 'opp' ? 'ours' : 'opp' }, team, emptyStep, ON)
          const dBall = depthOf(team, by)
          const goalSide = Object.values(t).filter((v) => depthOf(team, v.y) < dBall - 0.5)
          expect(goalSide.length, `ball (${bx},${by}) ${team}`).toBeGreaterThanOrEqual(dBall > 12 ? 4 : 1)
        }
      }
    }
  })

  it('...and in the simulation: whenever OURS carry the ball, OPP always has outfield players between the ball and their goal', () => {
    for (let i = 0; i < 4; i++) {
      const tl = getTimeline(play, i)
      let heldSince = 0
      let holder: string | null = null
      for (let k = 0; k < tl.frames.length; k += 6) {
        const f = tl.frames[k]
        if (f.ball.holder !== holder) {
          holder = f.ball.holder
          heldSince = f.t
        }
        // once the ball has settled with a player for a second (a fast pass over the top can beat the block for a
        // moment: it needs time to drop, limited by VMAX and the acceleration limit)
        if (f.t < 1.2 || !f.ball.holder || f.t - heldSince < 1.0) continue
        // level with the ball (within 2 m) counts: ST is carrying it inside the area, practically on the back line
        const goalSide = ['oLB', 'oLCB', 'oRCB', 'oRB', 'oGK'].filter((id) => f.players[id].y > f.ball.y - 2)
        expect(goalSide.length, `step ${i + 1} t=${f.t.toFixed(1)}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('QA 1 — core commands: press, mark, follow', () => {
  const roster: Play['players'] = [
    { id: 'a', team: 'ours', label: 'A', x: 30, y: 40 },
    { id: 'd', team: 'opp', label: 'D', x: 30, y: 55 },
    { id: 'gk', team: 'opp', label: 'oGK', x: 34, y: 100 },
  ]

  it('press: reaches a static attacker 14 m away in a natural time, without running past him', () => {
    const tl = getTimeline(custom(roster, [{ defenderRules: { d: [pr('a', 0, 1.0)] } }]), 0)
    const target = 41 // 1 m goal-side of the attacker
    const reach = tl.frames.find((f) => Math.abs(f.players.d.y - target) < 0.5)!
    expect(reach.t).toBeGreaterThan(2.0) // not a teleport: VMAX 6.8 m/s with a 5.5 m/s^2 build-up
    expect(reach.t).toBeLessThan(3.5)
    expect(Math.min(...tl.frames.map((f) => f.players.d.y - target))).toBeGreaterThan(-0.5) // no overshoot
    let peak = 0
    for (let k = 1; k < tl.frames.length; k++) peak = Math.max(peak, Math.abs(tl.frames[k].players.d.y - tl.frames[k - 1].players.d.y) / H)
    expect(peak).toBeLessThanOrEqual(VMAX + 0.05)
    // it arrives and stays arrived
    expect(Math.abs(tl.end.d.y - target)).toBeLessThan(0.3)
  })

  it('zone moves also stop on their target', () => {
    const tl = getTimeline(custom(roster, [{ defenderRules: { d: [zn(30, 45, 0)] } }]), 0)
    expect(Math.min(...tl.frames.map((f) => f.players.d.y))).toBeGreaterThan(44.5)
    expect(Math.abs(tl.end.d.y - 45)).toBeLessThan(0.2)
  })

  it('press (gain 4.0) is quicker than a mark (gain 2.2) over the same ground, but neither starts instantly', () => {
    const timeTo = (rule: PlayStep['defenderRules'][string][number]) => {
      const tl = getTimeline(custom(roster, [{ defenderRules: { d: [rule] } }]), 0)
      return tl.frames.find((f) => Math.hypot(f.players.d.x - 30, f.players.d.y - 41) < 1)?.t ?? Infinity
    }
    const press = timeTo(pr('a', 0, 1.0))
    const mark = timeTo(mk('a', 1.0, 1, [30, 55], 0))
    expect(press).toBeLessThanOrEqual(mark + 1e-9)
    expect(press).toBeGreaterThan(1.5)
  })

  describe('follow (step 5: oCAM follows ST from the penalty area into midfield)', () => {
    const play = seeded()
    const tl = getTimeline(play, 4)

    it('waits at the edge of the area while ST is still outside it, and does not hand him off', () => {
      expect(tl.events.filter((e) => e.type === 'handoff')).toHaveLength(0)
      const f = sampleTimeline(tl, 0.9) // ST is still at y ~ 79-80, outside the area (y <= 75)
      expect(f.players.ST.y).toBeGreaterThan(75)
      expect(f.players.oCAM.y).toBeGreaterThan(66) // standing between his zone and the edge nearest ST
    })

    it('follows ST into midfield and stays on him', () => {
      const f = sampleTimeline(tl, 7)
      expect(Math.hypot(f.players.oCAM.x - f.players.ST.x, f.players.oCAM.y - f.players.ST.y)).toBeLessThan(6)
      expect(tl.end.oCAM.rule?.type).toBe('follow')
    })
  })

  describe('follow handoff when the attacker goes back towards the box (two steps)', () => {
    const players: Play['players'] = [
      { id: 'a', team: 'ours', label: 'A', x: 34, y: 80 },
      { id: 'gk', team: 'opp', label: 'oGK', x: 34, y: 100 },
      { id: 'd', team: 'opp', label: 'D', x: 34, y: 62 },
      { id: 'e', team: 'opp', label: 'E', x: 52, y: 64 },
    ]
    const bounds = { kind: 'rect', x0: 18, y0: 48, x1: 50, y1: 75 } as const
    const p = custom(players, [
      { duration: 6, moves: [{ playerId: 'a', toX: 34, toY: 55, startTime: 0.3, endTime: 3.3 }], defenderRules: { d: [fl('a', [34, 62], bounds, 0.3)] } },
      { duration: 9, moves: [{ playerId: 'a', toX: 34, toY: 84, startTime: 0.5, endTime: 3.5 }] }, // back up towards the box
    ])

    it('fires once, cleanly: 0.3 s after he is out by more than the margin, never while he was dropping in', () => {
      const first = getTimeline(p, 0)
      expect(first.events.filter((e) => e.type === 'handoff')).toHaveLength(0)
      const tl = getTimeline(p, 1)
      const hand = tl.events.filter((e) => e.type === 'handoff')
      expect(hand).toHaveLength(1)
      // first moment he is more than 2 m beyond the area edge (y = 75)
      const out = tl.frames.find((f) => f.players.a.y > 77)!
      expect(hand[0].t - out.t).toBeGreaterThanOrEqual(0.3 - 2 * H)
      expect(hand[0].t - out.t).toBeLessThan(0.3 + 3 * H)
      expect(hand[0]).toMatchObject({ from: 'd', to: 'e' }) // the only other outfield defender
    })

    it('the original follower returns to his zone without drifting or oscillating', () => {
      const tl = getTimeline(p, 1)
      expect(tl.end.d.rule).toMatchObject({ type: 'zone', target: [34, 62] })
      expect(Math.hypot(tl.end.d.x - 34, tl.end.d.y - 62)).toBeLessThan(1.5)
      const tail = tl.frames.filter((f) => f.t > tl.duration - 2)
      const ds = tail.map((f) => Math.hypot(f.players.d.x - 34, f.players.d.y - 62))
      expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(0.5) // settled
      // and he is not hounded by an AI target in between: he never moves away from the zone after the handoff
      const after = tl.frames.filter((f) => f.t > tl.events[0].t + 0.5)
      const dz = after.map((f) => Math.hypot(f.players.d.x - 34, f.players.d.y - 62))
      for (let k = 1; k < dz.length; k++) expect(dz[k]).toBeLessThanOrEqual(dz[k - 1] + 0.05)
    })

    it('the new marker keeps the job (the AI does not clobber a handoff)', () => {
      const withAi = JSON.parse(JSON.stringify(p)) as Play
      withAi.steps[1].ai = { opp: { on: true } }
      const tl = getTimeline(withAi, 1)
      expect(tl.end.e.rule).toMatchObject({ type: 'mark', attacker: 'a' })
    })
  })

  describe('mark rules next to the AI', () => {
    it('an authored mark takes its player out of the AI pool once it has taken effect', () => {
      const w = world({ x: 34, y: 40 }, { t: 3 })
      const step = { defenderRules: { oRW: [mk('RCM', 3, 0.8, [60, 72], 2.4)] }, moves: [] }
      expect(computeAiTargets({ ...w, t: 3 }, 'opp', step, ON).oRW).toBeUndefined() // active: authored wins
      expect(computeAiTargets({ ...w, t: 1 }, 'opp', step, ON).oRW).toBeDefined() // not yet: the AI drives him meanwhile
    })

    it('...instead of leaving him on a stale target until it fires (delayed authored press, step 3)', () => {
      const tl = getTimeline(seeded(), 2) // oCMR presses CAM from 2.4 s
      const rule = tl.end.oCMR.rule
      expect(rule?.type).toBe('press')
      // before 2.4 s he is working for the AI: his target follows the ball, so he is not simply continuing to
      // the old step-2 target. Compare with a copy of the play where he has no authored rule at all.
      const free = JSON.parse(JSON.stringify(seeded())) as Play
      free.steps[2].defenderRules = {}
      const base = getTimeline(free, 2)
      const a = sampleTimeline(tl, 2.2).players.oCMR
      const b = sampleTimeline(base, 2.2).players.oCMR
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.05) // identical until the authored rule fires
    })
  })
})

describe('QA 2 — theoretical correctness of the positions', () => {
  it('ball at y = 30 (back of OURS): ball-driven lineD is 39.9 (y 65); blended with the default line-height target (31.5) the OPP line is y ≈ 69', () => {
    const t = computeAiTargets(world({ x: 34, y: 30 }, { owner: 'ours' }), 'opp', emptyStep, ON)
    expect(lineDepth(75)).toBeCloseTo(39.9, 1)
    expect(t.oLB.y).toBeCloseTo(105 - blendedLineDepth(75, resolveAiParams({})), 6)
    expect(t.oLB.y).toBeGreaterThan(68.5)
    expect(t.oLB.y).toBeLessThan(70)
    // the same ball at the other aggressiveness presets (higher aggressiveness = the ball weighs more and the max line rises)
    const y = (i: 'low' | 'high') => computeAiTargets(world({ x: 34, y: 30 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, intensity: i }).oLB.y
    expect(y('low')).toBeCloseTo(105 - blendedLineDepth(75, resolveAiParams({ intensity: 'low' })), 6)
    expect(y('high')).toBeCloseTo(105 - blendedLineDepth(75, resolveAiParams({ intensity: 'high' })), 6)
    expect(y('high')).toBeLessThan(y('low')) // a higher line
  })

  it('ball at y = 80 (in front of the OPP box): deep at the defaults (y ~ 83), very deep (y >= 90) with a low line height', () => {
    const t = computeAiTargets(world({ x: 34, y: 80 }, { owner: 'ours' }), 'opp', emptyStep, ON)
    for (const id of ['oLB', 'oRB']) expect(t[id].y).toBeGreaterThanOrEqual(82)
    const deep = computeAiTargets(world({ x: 34, y: 80 }, { owner: 'ours' }), 'opp', emptyStep, { on: true, lineHeight: 0 })
    for (const id of ['oLB', 'oRB']) expect(deep[id].y).toBeGreaterThanOrEqual(90)
    expect(Math.max(...['oLB', 'oLCB', 'oRCB', 'oRB'].map((id) => t[id].y))).toBeLessThan(100) // and off the goal line
  })

  it('lane screening really happens: central midfielders drop onto the passing lane in the seeded build-up', () => {
    const play = seeded()
    let screens = 0
    let samples = 0
    for (const stepIdx of [0, 3]) {
      const tl = getTimeline(play, stepIdx)
      for (let k = 0; k < tl.frames.length; k += 15) {
        const f = tl.frames[k]
        if (f.t < 0.8 || !f.ball.holder) continue
        const players: AiWorldPlayer[] = play.players.map((p) => ({ id: p.id, team: p.team, label: p.label, x: f.players[p.id].x, y: f.players[p.id].y, home: [p.x, p.y] }))
        const t = computeAiTargets({ players, ball: { x: f.ball.x, y: f.ball.y }, memory: {}, owner: 'ours', focus: f.ball.holder, t: f.t }, 'opp', play.steps[stepIdx], ON)
        samples++
        screens += Object.values(t).filter((v) => v.role === 'screen').length
      }
    }
    expect(samples).toBeGreaterThan(5)
    expect(screens).toBeGreaterThan(0)
  })

  it('a screener stands between the ball and the open attacker, a metre goal-side of their midpoint', () => {
    const w = world({ x: 34, y: 20 }, { owner: 'ours' })
    w.players = w.players.filter((p) => p.team === 'opp' || p.id === 'GK' || p.id === 'CAM')
    Object.assign(w.players.find((p) => p.id === 'GK')!, { x: 34, y: 20 })
    Object.assign(w.players.find((p) => p.id === 'CAM')!, { x: 34, y: 50 })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    const screen = Object.values(t).find((v) => v.role === 'screen')!
    expect(screen.x).toBeCloseTo(34, 6)
    expect(screen.y).toBeCloseTo(36, 6)
  })

  it('ball far to the left: the right side of the block narrows a long way in', () => {
    const w = world({ x: 8, y: 60 }, { owner: 'ours' })
    const t = computeAiTargets(w, 'opp', emptyStep, ON)
    for (const id of ['oLB', 'oLW']) { // the far side from a ball on the left (OPP face down: their left is screen right)
      expect(homeOf(w, id)[0] - t[id].x).toBeGreaterThan(15)
    }
    // ...and the whole block shifts towards the ball
    const field = Object.keys(t).filter((id) => t[id].role !== 'gk')
    const mean = field.reduce((s, id) => s + (t[id].x - homeOf(w, id)[0]), 0) / field.length
    expect(mean).toBeLessThan(-5)
  })
})

describe('QA 3 — authored rules mixed with the AI', () => {
  const play = seeded()

  it('follow + AI: oCAM is never double-assigned (the follow rule is untouched by the AI from its first frame)', () => {
    const tl = getTimeline(play, 4)
    expect(tl.end.oCAM.rule?.type).toBe('follow')
    // authored from 0.3 s: the AI no longer lists him from then on
    const w = world({ x: 34, y: 99 }, { owner: 'opp', t: 0.31 })
    const t = computeAiTargets(w, 'opp', play.steps[4], ON)
    expect(t.oCAM).toBeUndefined()
    expect(computeAiTargets({ ...w, t: 0.1 }, 'opp', play.steps[4], ON).oCAM).toBeDefined() // until then he is AI-driven
  })

  it('authored press on LW (step 2): the AI does not send a second player at the ball', () => {
    // oRCB is the nearest free defender to the carrier; with oRB already pressing LW he must not also press
    const w = world({ x: 12, y: 65 }, { owner: 'ours', focus: 'LW', t: 3 })
    for (const p of w.players) {
      if (p.id === 'oRB') Object.assign(p, { x: 14, y: 66, duty: { type: 'press', att: 'LW' } })
      if (p.id === 'oRCB') Object.assign(p, { x: 14, y: 72 })
      if (p.id === 'LW') Object.assign(p, { x: 12, y: 65 })
    }
    const t = computeAiTargets(w, 'opp', play.steps[1], ON)
    expect(t.oRB).toBeUndefined() // authored and active
    expect(Object.values(t).filter((v) => v.role === 'presser')).toHaveLength(0) // nobody doubles up
    expect(Object.values(t).filter((v) => v.role === 'cover')).toHaveLength(1) // but someone covers the presser
    // without the authored job the nearest free defender would have pressed
    for (const p of w.players) if (p.id === 'oRB') p.duty = null
    const free = computeAiTargets(w, 'opp', emptyStep, ON)
    expect(Object.values(free).filter((v) => v.role === 'presser')).toHaveLength(1)
  })

  it('in the simulation no more than one OPP player is on LW at the end of step 2', () => {
    const tl = getTimeline(play, 1)
    const f = sampleTimeline(tl, 4.9)
    const dist = (id: string) => Math.hypot(f.players[id].x - f.players.LW.x, f.players[id].y - f.players.LW.y)
    // the back line (the winger oRW on that flank is a midfielder and not part of the press)
    const opp = ['oLB', 'oLCB', 'oRCB', 'oRB'].sort((a, b) => dist(a) - dist(b))
    expect(opp[0]).toBe('oRB') // the authored presser is on him (he arrives ~5.4 s: 20 m from a standing start at VMAX)
    expect(dist('oRB')).toBeLessThan(11)
    expect(dist(opp[1])).toBeGreaterThan(9) // nobody doubles up
    // and he is closing steadily
    expect(dist('oRB')).toBeLessThan(Math.hypot(sampleTimeline(tl, 3.5).players.oRB.x - 12, sampleTimeline(tl, 3.5).players.oRB.y - 65) - 5)
  })

  it('an attacker already pressed / marked by an authored rule is not also lane-screened', () => {
    const w = world({ x: 34, y: 20 }, { owner: 'ours', t: 3 })
    w.players = w.players.filter((p) => p.team === 'opp' || p.id === 'GK' || p.id === 'CAM')
    Object.assign(w.players.find((p) => p.id === 'GK')!, { x: 34, y: 20 })
    Object.assign(w.players.find((p) => p.id === 'CAM')!, { x: 34, y: 50 })
    // oRW (far from CAM, so not "marking" him by distance) has an authored mark on him
    Object.assign(w.players.find((p) => p.id === 'oRW')!, { duty: { type: 'mark', att: 'CAM' } })
    const t = computeAiTargets(w, 'opp', { defenderRules: { oRW: [mk('CAM', 2, 0.8, [60, 72], 0)] }, moves: [] }, ON)
    expect(Object.values(t).filter((v) => v.role === 'screen')).toHaveLength(0)
  })

  it('a follow handoff receiver keeps the new job even with the AI running', () => {
    const players: Play['players'] = [
      { id: 'a', team: 'ours', label: 'A', x: 30, y: 50 },
      { id: 'gk', team: 'opp', label: 'oGK', x: 34, y: 100 },
      { id: 'd', team: 'opp', label: 'D', x: 30, y: 58 },
      { id: 'e', team: 'opp', label: 'E', x: 52, y: 60 },
      { id: 'f', team: 'opp', label: 'F', x: 10, y: 80 },
    ]
    const p = custom(players, [{
      duration: 6,
      moves: [{ playerId: 'a', toX: 62, toY: 52, startTime: 0.5, endTime: 2.5 }],
      passes: [],
      ai: { opp: { on: true } },
      defenderRules: { d: [fl('a', [30, 58], { kind: 'rect', x0: 20, y0: 40, x1: 40, y1: 70 }, 0)] },
    }])
    const tl = getTimeline(p, 0)
    const hand = tl.events.find((e) => e.type === 'handoff')!
    expect(hand).toBeTruthy()
    const receiver = (hand as { to: string }).to
    expect(tl.end[receiver].rule?.type).toBe('mark') // not overwritten by an AI rule
    expect(tl.end.d.rule?.type).toBe('zone')
  })

  it('the presser does not flicker between near-equal candidates (3 m hysteresis)', () => {
    for (let i = 0; i < play.steps.length; i++) {
      const presser = getTimeline(play, i).events.filter((e) => e.type === 'presser')
      // no A -> B -> A bounce inside a second
      for (let k = 2; k < presser.length; k++) {
        const [x, y, z] = [presser[k - 2], presser[k - 1], presser[k]]
        if (x.type === 'presser' && y.type === 'presser' && z.type === 'presser' && z.to === x.to && z.to !== y.to) {
          expect(z.t - x.t, `step ${i + 1} ${x.to}/${y.to}`).toBeGreaterThan(1)
        }
      }
      expect(presser.length, `step ${i + 1}`).toBeLessThanOrEqual(8)
    }
  })

  it('hysteresis: a rival only 1 m closer does not steal the press; one clearly closer (> 3 m) does', () => {
    const w = world({ x: 34, y: 78 }, { owner: 'ours' })
    const a = computeAiTargets(w, 'opp', emptyStep, ON)
    const incumbent = Object.entries(a).find(([, v]) => v.role === 'presser')![0]
    const inc = w.players.find((p) => p.id === incumbent)!
    const rival = w.players.find((p) => p.team === 'opp' && p.id !== incumbent && !/gk/i.test(p.label) && Math.hypot(p.x - 34, p.y - 78) < 14)!
    const d0 = Math.hypot(inc.x - 34, inc.y - 78)
    const place = (p: AiWorldPlayer, d: number) => { p.x = 34 + d; p.y = 78 } // on a line from the ball
    place(rival, d0 - 1)
    expect(Object.entries(computeAiTargets(w, 'opp', emptyStep, ON)).find(([, v]) => v.role === 'presser')![0]).toBe(incumbent)
    place(rival, Math.max(0.5, d0 - 4))
    expect(Object.entries(computeAiTargets(w, 'opp', emptyStep, ON)).find(([, v]) => v.role === 'presser')![0]).toBe(rival.id)
  })
})

describe('OPP orientation: the mirror lives in the data, the engine uses x as-is and defends the right way up', () => {
  const x = (p: Play, id: string) => p.players.find((q) => q.id === id)!.x

  it('OPP face down the pitch: their right-hand players are on the screen-LEFT of their left-hand players (all seeded plays + the 4-4-2 builder)', async () => {
    const { createDefaultPlay } = await import('@/lib/engine/defaultPlay')
    const { toPlayInsert: pattern } = await import('@/lib/seed/rightSideBuildUp')
    const test = seeded()
    // Defensive AI test: every OPP x is 68 - (the x it had before the fix), so each right-hand player is left of his left-hand pair
    const before: Record<string, number> = { oLB: 14, oRB: 60, oLCB: 28, oRCB: 48, oLW: 14, oRW: 60, oCML: 22, oCMR: 52 }
    for (const [id, old] of Object.entries(before)) expect(x(test, id)).toBe(68 - old)
    for (const [r, l] of [['oRB', 'oLB'], ['oRCB', 'oLCB'], ['oRW', 'oLW'], ['oCMR', 'oCML']]) expect(x(test, r)).toBeLessThan(x(test, l))
    for (const id of ['oGK', 'oCAM', 'oST']) expect(x(test, id)).toBe(34) // symmetric
    // the pattern-of-play data was authored mirrored already (oRB at x = 21 is on the screen left)
    const pat = { ...pattern(), id: 'p', createdAt: '', updatedAt: '' } as Play
    expect(x(pat, 'oRB')).toBeLessThan(x(pat, 'oLB'))
    expect(x(pat, 'oRM')).toBeLessThan(x(pat, 'oLM'))
    // the 4-4-2 builder mirrors OPP (x -> 68 - x): p-RB is on the screen left
    const d = createDefaultPlay()
    expect(x(d, 'p-RB')).toBeLessThan(x(d, 'p-LB'))
    expect(x(d, 'p-RB') + x(d, 'p-LB')).toBe(68)
  })

  it('ST starts inside the OPP penalty area, the most advanced player on the pitch', () => {
    const p = seeded()
    const st = p.players.find((q) => q.id === 'ST')!
    expect(st).toMatchObject({ x: 34, y: 88 })
    const mostAdvancedOurs = Math.max(...p.players.filter((q) => q.team === 'ours').map((q) => q.y))
    expect(st.y).toBe(mostAdvancedOurs)
  })

  it('a press by OPP stands goal-side of the attacker: HIGHER y (towards their goal at y = 105)', () => {
    const roster: Play['players'] = [
      { id: 'a', team: 'ours', label: 'A', x: 30, y: 40 },
      { id: 'd', team: 'opp', label: 'D', x: 30, y: 60 },
      { id: 'gk', team: 'opp', label: 'oGK', x: 34, y: 100 },
    ]
    const tl = getTimeline(custom(roster, [{ defenderRules: { d: [pr('a', 0, 1.5)] } }]), 0)
    expect(tl.end.d.y).toBeCloseTo(41.5, 0) // att.y + gap
    expect(tl.end.d.y).toBeGreaterThan(40)
  })

  it('...and a press by OURS stands goal-side of THEIR attacker: LOWER y (towards their goal at y = 0)', () => {
    const roster: Play['players'] = [
      { id: 'a', team: 'opp', label: 'oA', x: 30, y: 60 },
      { id: 'd', team: 'ours', label: 'D', x: 30, y: 40 },
      { id: 'gk', team: 'ours', label: 'GK', x: 34, y: 5 },
    ]
    const tl = getTimeline(custom(roster, [{ defenderRules: { d: [pr('a', 0, 1.5)] } }]), 0)
    expect(tl.end.d.y).toBeCloseTo(58.5, 0) // att.y - gap
    expect(tl.end.d.y).toBeLessThan(60)
  })

  it('the AI presser stands goal-side of the ball: ball.y + 1.2 for OPP, ball.y - 1.2 for OURS', () => {
    const o = computeAiTargets(world({ x: 34, y: 60 }, { owner: 'ours', focus: 'CAM' }), 'opp', emptyStep, ON)
    const oPresser = Object.values(o).find((v) => v.role === 'presser')!
    expect(oPresser.y).toBeCloseTo(61.2, 6)
    const u = computeAiTargets(world({ x: 34, y: 60 }, { owner: 'opp', focus: 'oCAM' }), 'ours', emptyStep, ON)
    const uPresser = Object.values(u).find((v) => v.role === 'presser')!
    expect(uPresser.y).toBeCloseTo(58.8, 6)
  })

  it('positions are used as authored: frame 0 of a step holds the data coordinates (no hidden mirroring)', () => {
    const p = seeded()
    const f = sampleTimeline(getTimeline(p, 0), 0)
    for (const q of p.players) {
      if (q.id === 'oGK') continue
      expect(f.players[q.id].x).toBeCloseTo(q.x, 1)
    }
  })
})
