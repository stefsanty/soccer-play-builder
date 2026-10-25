import { describe, expect, it } from 'vitest'
import { SHOT_RANGE_M, rollShot, shotChance } from '@/lib/engine/shot'
import { GOAL_CENTRE_X, GOAL_LINE_Y, detectGoal } from '@/lib/engine/goal'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { initialState, simulateStep } from '@/lib/engine/simulator'
import type { PlayStep } from '@/lib/types/play'

type Pt = [number, number]
const goal: Pt = [GOAL_CENTRE_X, GOAL_LINE_Y + 0.5]
const straight = (d: number): Pt => [GOAL_CENTRE_X, GOAL_LINE_Y - d]

describe('shotChance', () => {
  it('falls with distance: ~80% at 6 m, ~55% at 11 m, ~25% at 20 m, ~14% at 30 m', () => {
    expect(shotChance(straight(6), goal, [])).toBeCloseTo(0.8, 1)
    expect(shotChance(straight(11), goal, [])).toBeCloseTo(0.54, 1)
    expect(shotChance(straight(20), goal, [])).toBeCloseTo(0.26, 1)
    expect(shotChance(straight(30), goal, [])).toBeCloseTo(0.14, 1)
  })
  it('never promises more than 95% or less than 3%', () => {
    expect(shotChance(straight(0.2), goal, [])).toBeLessThanOrEqual(0.95)
    expect(shotChance(straight(80), goal, [])).toBeGreaterThanOrEqual(0.03)
  })
  it('is lower from a tight angle than from straight on at the same distance', () => {
    const wide: Pt = [GOAL_CENTRE_X + 10, GOAL_LINE_Y - 4] // ~68° off the goal normal, ~10.8 m
    const front = straight(10.8)
    expect(shotChance(wide, goal, [])).toBeLessThan(shotChance(front, goal, []))
  })
  it('is lower with a defender standing on the shot line', () => {
    const from = straight(14)
    const blocker: Pt = [GOAL_CENTRE_X, GOAL_LINE_Y - 7]
    expect(shotChance(from, goal, [blocker])).toBeLessThan(shotChance(from, goal, []))
    // a defender well off the line changes nothing
    expect(shotChance(from, goal, [[GOAL_CENTRE_X + 8, GOAL_LINE_Y - 7]])).toBeCloseTo(shotChance(from, goal, []), 5)
  })
  it('shots are allowed from up to 35 m', () => {
    expect(SHOT_RANGE_M).toBe(35)
  })
})

describe('rollShot', () => {
  it('scores when the roll lands under the chance, is saved otherwise', () => {
    expect(rollShot(0.6, () => 0.59)).toBe('goal')
    expect(rollShot(0.6, () => 0.6)).toBe('saved')
    expect(rollShot(0.6, () => 0.99)).toBe('saved')
  })
})

describe('a pass with a point target (a shot) in the simulator', () => {
  const shotStep = (from: Pt, target: Pt): { play: ReturnType<typeof createDefaultPlay>; shooter: string } => {
    const play = createDefaultPlay()
    const shooter = 'o-LST'
    play.players = play.players.map((p) => (p.id === shooter ? { ...p, x: from[0], y: from[1] } : p))
    const step: PlayStep = {
      id: 'shot',
      index: 1,
      title: 'shot',
      duration: 3,
      moves: [],
      passes: [{ from: shooter, to: '', target, startTime: 0.2, endTime: 1.2 }],
      defenderRules: {},
      faceTargets: [],
    }
    play.steps = [...play.steps, step]
    return { play, shooter }
  }

  it('flies to the target point and rests there with nobody holding it', () => {
    const from = straight(12)
    const { play, shooter } = shotStep(from, goal)
    const tl = simulateStep(play, 1, initialState(play), shooter, [from[0], from[1] + 1])
    const mid = tl.frames[Math.round(0.7 / (1 / 60))]
    expect(mid.ball.flying).toBe(true)
    expect(mid.ball.holder).toBeNull()
    const last = tl.frames.at(-1)!
    expect(last.ball.flying).toBe(false)
    expect(last.ball.holder).toBeNull()
    expect(last.ball.x).toBeCloseTo(goal[0], 3)
    expect(last.ball.y).toBeCloseTo(goal[1], 3)
  })

  it('is a goal when the target is in the net', () => {
    const from = straight(12)
    const { play, shooter } = shotStep(from, goal)
    const tl = simulateStep(play, 1, initialState(play), shooter, [from[0], from[1] + 1])
    expect(detectGoal(tl.frames)).not.toBeNull()
  })
})
