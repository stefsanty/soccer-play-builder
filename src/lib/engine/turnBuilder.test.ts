import { describe, expect, it } from 'vitest'
import {
  allowedKinds,
  buildSnapshots,
  holderAfter,
  queueAction,
  turnStep,
  MIN_TURN_S,
  MOVE_MPS,
  PASS_MPS,
  TURN_TAIL_S,
  type BuilderAction,
} from '@/lib/engine/turnBuilder'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { initialState, simulateStep } from '@/lib/engine/simulator'

type Pt = [number, number]

const id = (s: string) => s

describe('allowedKinds', () => {
  it('ball carrier may pass or dribble, never run', () => {
    expect(allowedKinds('a', 'a')).toEqual(['pass', 'dribble'])
  })
  it('everyone else may only run', () => {
    expect(allowedKinds('b', 'a')).toEqual(['run'])
    expect(allowedKinds('b', null)).toEqual(['run'])
  })
})

describe('queueAction', () => {
  it('replaces an earlier action of the same kind by the same player', () => {
    const q1 = queueAction([], { kind: 'run', playerId: 'a', toX: 10, toY: 10 })
    const q2 = queueAction(q1, { kind: 'run', playerId: 'b', toX: 5, toY: 5 })
    const q3 = queueAction(q2, { kind: 'run', playerId: 'a', toX: 20, toY: 20 })
    expect(q3).toHaveLength(2)
    const a = q3.find((x) => x.playerId === 'a')
    expect(a && a.kind === 'run' && a.toX).toBe(20)
  })
  it('lets a passer also carry a support run (pass + run coexist)', () => {
    const q1 = queueAction([], { kind: 'pass', playerId: 'a', to: 'c' })
    const q2 = queueAction(q1, { kind: 'run', playerId: 'a', toX: 10, toY: 10 })
    expect(q2).toHaveLength(2)
    expect(q2.map((x) => x.kind).sort()).toEqual(['pass', 'run'])
  })
  it('a dribble displaces both the pass and the run', () => {
    const q = queueAction(
      [
        { kind: 'pass', playerId: 'a', to: 'c' },
        { kind: 'run', playerId: 'a', toX: 10, toY: 10 },
      ],
      { kind: 'dribble', playerId: 'a', toX: 5, toY: 5 },
    )
    expect(q).toHaveLength(1)
    expect(q[0].kind).toBe('dribble')
  })
  it('a pass displaces a dribble but not a run', () => {
    const q = queueAction(
      [
        { kind: 'dribble', playerId: 'a', toX: 5, toY: 5 },
        { kind: 'run', playerId: 'b', toX: 1, toY: 1 },
      ],
      { kind: 'pass', playerId: 'a', to: 'c' },
    )
    expect(q.map((x) => x.kind).sort()).toEqual(['pass', 'run'])
  })
})

describe('holderAfter', () => {
  const run: BuilderAction = { kind: 'run', playerId: 'b', toX: 1, toY: 1 }
  const dribble: BuilderAction = { kind: 'dribble', playerId: 'a', toX: 2, toY: 2 }
  it('transfers on a pass', () => {
    expect(holderAfter('a', [run, { kind: 'pass', playerId: 'a', to: 'c' }])).toBe('c')
  })
  it('keeps the holder on runs and dribbles', () => {
    expect(holderAfter('a', [run, dribble])).toBe('a')
  })
})

describe('turnStep', () => {
  const positions: Record<string, Pt> = { a: [30, 30], b: [30, 45], c: [50, 30] }
  it('maps dribbles/runs to moves and the pass to a pass, all starting at 0', () => {
    const step = turnStep(
      [
        { kind: 'pass', playerId: 'a', to: 'c' },
        { kind: 'run', playerId: 'b', toX: 30, toY: 60 },
      ],
      positions,
      1,
    )
    expect(step.moves).toHaveLength(1)
    expect(step.passes).toHaveLength(1)
    expect(step.moves[0].startTime).toBe(0)
    expect(step.passes[0].startTime).toBe(0)
    // 20m pass and 15m run at the reference-derived paces
    expect(step.passes[0].endTime).toBeCloseTo(20 / PASS_MPS)
    expect(step.moves[0].endTime).toBeCloseTo(15 / MOVE_MPS)
    expect(step.duration).toBeCloseTo(Math.max(MIN_TURN_S, 15 / MOVE_MPS + TURN_TAIL_S))
  })
  it('switches the defensive AI on for the opponent', () => {
    const step = turnStep([{ kind: 'run', playerId: 'b', toX: 30, toY: 60 }], positions, 2)
    expect(step.ai?.opp?.on).toBe(true)
    expect(step.ai?.ours).toBeUndefined()
  })
})

describe('buildSnapshots', () => {
  const start: Record<string, Pt> = { a: [10, 10], b: [20, 20], d: [30, 30] }
  const end: Record<string, Pt> = { a: [10, 20], b: [20, 30], d: [30, 40] } // d = defender moved by the AI
  const actions: BuilderAction[] = [
    { kind: 'run', playerId: 'a', toX: 10, toY: 20 },
    { kind: 'pass', playerId: 'b', to: 'a' },
  ]
  const snaps = buildSnapshots(3, actions, start, end, 'b', id)

  it('one snapshot per action, last one equal to the turn end state', () => {
    expect(snaps).toHaveLength(2)
    expect(snaps[1].positions).toEqual(end)
  })
  it('earlier snapshots land only the earlier movers and interpolate the rest', () => {
    expect(snaps[0].positions.a).toEqual([10, 20]) // action 1 landed
    expect(snaps[0].positions.b).toEqual([20, 20]) // action 2 not yet
    expect(snaps[0].positions.d).toEqual([30, 35]) // defender halfway (1/2)
  })
  it('the holder flips on the pass snapshot', () => {
    expect(snaps[0].holder).toBe('b')
    expect(snaps[1].holder).toBe('a')
  })
  it('labels and turn metadata are carried', () => {
    expect(snaps[0]).toMatchObject({ turn: 3, actionIndex: 1, actionCount: 2, label: 'a runs' })
    expect(snaps[1].label).toBe('b → a')
  })
})

describe('turn resolution through the simulator', () => {
  it('runs land, the pass transfers the ball, and the AI moves the defenders', () => {
    const play = createDefaultPlay()
    const holder = 'o-LCM'
    const receiver = 'o-RST'
    const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
    const step = turnStep(
      [
        { kind: 'pass', playerId: holder, to: receiver },
        { kind: 'run', playerId: 'o-LM', toX: 12, toY: 55 },
      ],
      positions,
      1,
    )
    play.steps.push({ ...step, index: 1 })

    const start = initialState(play)
    const hp = positions[holder]
    const tl = simulateStep(play, 1, start, holder, hp)
    const last = tl.frames.at(-1)!

    // pass completed: holder is the receiver, ball at their feet
    expect(last.ball.holder).toBe(receiver)
    expect(Math.hypot(last.ball.x - last.players[receiver].x, last.ball.y - last.players[receiver].y)).toBeLessThan(3)
    // the run arrived
    expect(last.players['o-LM'].x).toBeCloseTo(12, 0)
    expect(last.players['o-LM'].y).toBeCloseTo(55, 0)
    // the defensive AI moved the opposition block
    const oppMoved = play.players
      .filter((p) => p.team === 'opp')
      .map((p) => Math.hypot(last.players[p.id].x - p.x, last.players[p.id].y - p.y))
    expect(Math.max(...oppMoved)).toBeGreaterThan(2)
  })

  it('a dribble carries the ball with the holder even with no pass in the play', () => {
    const play = createDefaultPlay()
    const holder = 'o-RCM'
    const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
    const step = turnStep([{ kind: 'dribble', playerId: holder, toX: 43, toY: 50 }], positions, 1)
    play.steps.push({ ...step, index: 1 })

    const tl = simulateStep(play, 1, initialState(play), holder, positions[holder])
    const last = tl.frames.at(-1)!
    expect(last.players[holder].y).toBeCloseTo(50, 0)
    expect(last.ball.holder).toBe(holder)
    expect(Math.hypot(last.ball.x - last.players[holder].x, last.ball.y - last.players[holder].y)).toBeLessThan(3)
  })
})
