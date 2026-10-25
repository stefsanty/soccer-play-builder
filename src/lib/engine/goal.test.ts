import { describe, expect, it } from 'vitest'
import { GOAL_HALF_W, detectGoal, inGoal } from '@/lib/engine/goal'
import { turnStep } from '@/lib/engine/turnBuilder'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { initialState, simulateStep } from '@/lib/engine/simulator'
import { PITCH_H, PITCH_W } from '@/lib/engine/pitch'

const ball = (x: number, y: number) => ({ ball: { x, y } })

describe('inGoal', () => {
  it('is true for a ball over the opponent goal line between the posts', () => {
    expect(inGoal({ x: PITCH_W / 2, y: PITCH_H + 0.1 })).toBe(true)
    expect(inGoal({ x: PITCH_W / 2 + GOAL_HALF_W - 0.01, y: PITCH_H + 1 })).toBe(true)
  })
  it('is false on the pitch, and false over the line but wide of the posts', () => {
    expect(inGoal({ x: PITCH_W / 2, y: PITCH_H - 0.5 })).toBe(false)
    expect(inGoal({ x: PITCH_W / 2 + GOAL_HALF_W + 0.5, y: PITCH_H + 1 })).toBe(false)
  })
})

describe('detectGoal', () => {
  it('reports the first frame where the ball crosses into the goal', () => {
    const frames = [ball(34, 100), ball(34, 104), ball(34, 105.2), ball(34, 106)]
    expect(detectGoal(frames)).toEqual({ frameIndex: 2 })
  })
  it('does not count a ball that already sat in the goal at the start of the turn', () => {
    const frames = [ball(34, 106), ball(34, 106), ball(34, 106.5)]
    expect(detectGoal(frames)).toBeNull()
  })
  it('does not count a ball that goes over the line wide of the posts', () => {
    const frames = [ball(10, 100), ball(10, 106)]
    expect(detectGoal(frames)).toBeNull()
  })
  it('counts a ball that leaves the goal and comes back in during the same turn only once', () => {
    const frames = [ball(34, 104), ball(34, 106), ball(34, 103), ball(34, 106)]
    expect(detectGoal(frames)).toEqual({ frameIndex: 1 })
  })
})

describe('a dribble into the net is a goal in the simulator', () => {
  it('detects the goal from the simulated frames', () => {
    const play = createDefaultPlay()
    const carrier = 'o-LST'
    const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as [number, number]]))
    positions[carrier] = [PITCH_W / 2, 100]
    const step = turnStep([{ kind: 'dribble', playerId: carrier, toX: PITCH_W / 2, toY: 106 }], positions, 1)
    const next = { ...play, players: play.players.map((p) => (p.id === carrier ? { ...p, x: PITCH_W / 2, y: 100 } : p)), steps: [...play.steps, step] }
    const tl = simulateStep(next, 1, initialState(next), carrier, [PITCH_W / 2, 101])
    const goal = detectGoal(tl.frames)
    expect(goal).not.toBeNull()
    expect(tl.frames[goal!.frameIndex].ball.y).toBeGreaterThanOrEqual(PITCH_H)
  })
  it('a dribble that stops short of the line is not a goal', () => {
    const play = createDefaultPlay()
    const carrier = 'o-LST'
    const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as [number, number]]))
    positions[carrier] = [PITCH_W / 2, 90]
    const step = turnStep([{ kind: 'dribble', playerId: carrier, toX: PITCH_W / 2, toY: 100 }], positions, 1)
    const next = { ...play, players: play.players.map((p) => (p.id === carrier ? { ...p, x: PITCH_W / 2, y: 90 } : p)), steps: [...play.steps, step] }
    const tl = simulateStep(next, 1, initialState(next), carrier, [PITCH_W / 2, 91])
    expect(detectGoal(tl.frames)).toBeNull()
  })
})
