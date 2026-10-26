import { describe, expect, it } from 'vitest'
import {
  actionInRange,
  allowedKinds,
  buildSnapshots,
  holderAfter,
  queueAction,
  removeAction,
  sanitizeQueue,
  shortLabel,
  scheduleTurn,
  turnStep,
  ACTION_MAX_S,
  MOVE_MPS,
  PASS_MPS,
  PASS_RANGE_M,
  RUN_RANGE_M,
  type BuilderAction,
} from '@/lib/engine/turnBuilder'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { initialState, simulateStep } from '@/lib/engine/simulator'

type Pt = [number, number]

const id = (s: string) => s

describe('allowedKinds', () => {
  it('the (projected) ball carrier may pass, dribble or shoot, never run', () => {
    expect(allowedKinds('a', 'a')).toEqual(['pass', 'dribble', 'shot'])
  })
  it('everyone else may only run', () => {
    expect(allowedKinds('b', 'a')).toEqual(['run'])
    expect(allowedKinds('b', null)).toEqual(['run'])
  })
})

describe('queueAction + chaining', () => {
  it('appends — a player may chain several actions', () => {
    const q1 = queueAction([], { kind: 'run', playerId: 'a', toX: 10, toY: 10 })
    const q2 = queueAction(q1, { kind: 'run', playerId: 'a', toX: 20, toY: 20 })
    expect(q2).toHaveLength(2)
    expect(q2.every((x) => x.playerId === 'a')).toBe(true)
  })
})

describe('sanitizeQueue', () => {
  it('drops ball actions whose owner would not hold the ball at that point', () => {
    const q: BuilderAction[] = [
      { kind: 'pass', playerId: 'a', to: 'b' },
      { kind: 'run', playerId: 'c', toX: 1, toY: 1 },
      { kind: 'pass', playerId: 'b', to: 'c' },
      { kind: 'dribble', playerId: 'c', toX: 2, toY: 2 },
    ]
    // removing the first pass leaves b never receiving: b's pass and c's dribble fall away, runs stay
    const withoutFirst = sanitizeQueue(q.slice(1), 'a')
    expect(withoutFirst).toEqual([{ kind: 'run', playerId: 'c', toX: 1, toY: 1 }])
    // the intact chain is untouched
    expect(sanitizeQueue(q, 'a')).toEqual(q)
  })
})

describe('removeAction', () => {
  const q: BuilderAction[] = [
    { kind: 'pass', playerId: 'a', to: 'b' },
    { kind: 'run', playerId: 'c', toX: 1, toY: 1 },
    { kind: 'pass', playerId: 'b', to: 'c' },
    { kind: 'dribble', playerId: 'c', toX: 2, toY: 2 },
  ]
  it('reports the dependents that fall away with the removed action, so the UI can say so and offer Undo', () => {
    const r = removeAction(q, 0, 'a')
    expect(r.queue).toEqual([{ kind: 'run', playerId: 'c', toX: 1, toY: 1 }])
    expect(r.dropped).toEqual([
      { kind: 'pass', playerId: 'b', to: 'c' },
      { kind: 'dribble', playerId: 'c', toX: 2, toY: 2 },
    ])
  })
  it('removing a run drops nothing else', () => {
    const r = removeAction(q, 1, 'a')
    expect(r.queue).toEqual([q[0], q[2], q[3]])
    expect(r.dropped).toEqual([])
  })
})

describe('holderAfter', () => {
  it('follows the last pass through a chain', () => {
    expect(
      holderAfter('a', [
        { kind: 'pass', playerId: 'a', to: 'b' },
        { kind: 'pass', playerId: 'b', to: 'c' },
      ]),
    ).toBe('c')
    expect(holderAfter('a', [{ kind: 'dribble', playerId: 'a', toX: 2, toY: 2 }])).toBe('a')
  })
})

describe('scheduleTurn', () => {
  const positions: Record<string, Pt> = { a: [30, 30], b: [30, 45], c: [50, 30] }

  it('first actions of different players start together at 0', () => {
    const s = scheduleTurn(
      [
        { kind: 'pass', playerId: 'a', to: 'c' },
        { kind: 'run', playerId: 'b', toX: 30, toY: 60 },
      ],
      positions,
    )
    expect(s.passes[0].startTime).toBe(0)
    expect(s.moves[0].startTime).toBe(0)
    expect(s.passes[0].endTime).toBeCloseTo(20 / PASS_MPS)
    expect(s.moves[0].endTime).toBeCloseTo(15 / MOVE_MPS)
  })

  it("a player's own actions run back to back, departing from the previous target", () => {
    const s = scheduleTurn(
      [
        { kind: 'run', playerId: 'b', toX: 30, toY: 51 }, // 6m → 1s
        { kind: 'run', playerId: 'b', toX: 30, toY: 63 }, // 12m → 2s
      ],
      positions,
    )
    expect(s.moves[1].startTime).toBeCloseTo(1)
    expect(s.moves[1].endTime).toBeCloseTo(3)
    expect(s.plans[1].from).toEqual([30, 51])
    expect(s.planned.b).toEqual([30, 63])
  })

  it('an action queued after a pass to that player waits for the ball to arrive', () => {
    const s = scheduleTurn(
      [
        { kind: 'pass', playerId: 'a', to: 'c' }, // 20m → 1.111s
        { kind: 'dribble', playerId: 'c', toX: 50, toY: 42 },
      ],
      positions,
    )
    expect(s.moves[0].startTime).toBeCloseTo(20 / PASS_MPS)
  })

  it('a run queued before the incoming pass starts at once, and the pass aims at the planned spot', () => {
    const s = scheduleTurn(
      [
        { kind: 'run', playerId: 'c', toX: 50, toY: 40 },
        { kind: 'pass', playerId: 'a', to: 'c' },
      ],
      positions,
    )
    expect(s.moves[0].startTime).toBe(0)
    expect(s.plans[1].to).toEqual([50, 40]) // pass plan uses c's planned position
  })

  it('a run queued AFTER an incoming pass also starts at once — the receiver runs onto the ball', () => {
    const s = scheduleTurn(
      [
        { kind: 'pass', playerId: 'a', to: 'c' },
        { kind: 'run', playerId: 'c', toX: 50, toY: 40 },
      ],
      positions,
    )
    expect(s.moves[0].startTime).toBe(0) // receiver's run concurrent with pass flight
    expect(s.passes[0].startTime).toBe(0)
  })

  it('a dribble by the receiver still waits for the ball — he can`t carry what isn`t there yet', () => {
    const s = scheduleTurn(
      [
        { kind: 'pass', playerId: 'a', to: 'c' },
        { kind: 'dribble', playerId: 'c', toX: 50, toY: 42 },
      ],
      positions,
    )
    expect(s.moves[0].startTime).toBeCloseTo(s.passes[0].endTime)
  })

  it('a receiver`s run then dribble: run concurrent, dribble after the ball arrives', () => {
    const s = scheduleTurn(
      [
        { kind: 'pass', playerId: 'a', to: 'c' },           // 20m → 1.111s
        { kind: 'run', playerId: 'c', toX: 56, toY: 32 },    // 6m → 1s, concurrent with pass
        { kind: 'dribble', playerId: 'c', toX: 60, toY: 36 }, // waits for ball (and own run)
      ],
      positions,
    )
    expect(s.moves[0].startTime).toBe(0)                       // run starts at once
    expect(s.moves[1].startTime).toBeGreaterThanOrEqual(s.passes[0].endTime - 1e-9) // dribble waits for ball
    expect(s.moves[1].startTime).toBeGreaterThanOrEqual(s.moves[0].endTime - 1e-9)  // and own run chain
  })

  it('an authored delay pushes an action later, but never ahead of its dependencies', () => {
    const s = scheduleTurn(
      [
        { kind: 'run', playerId: 'b', toX: 30, toY: 51, delay: 1.5 }, // free: starts at its delay
        { kind: 'pass', playerId: 'a', to: 'c' },
        { kind: 'dribble', playerId: 'c', toX: 50, toY: 42, delay: 0.2 }, // waits for the ball anyway
      ],
      positions,
    )
    expect(s.moves[0].startTime).toBeCloseTo(1.5)
    expect(s.moves[1].startTime).toBeCloseTo(20 / PASS_MPS) // max(delay 0.2, ball arrival)
  })

  it('the passer may chain a support run that starts when the ball is released and lands', () => {
    const s = scheduleTurn(
      [
        { kind: 'pass', playerId: 'a', to: 'c' },
        { kind: 'run', playerId: 'a', toX: 36, toY: 36 },
      ],
      positions,
    )
    expect(s.moves[0].startTime).toBeCloseTo(s.passes[0].endTime)
  })
})

describe('turnStep', () => {
  const positions: Record<string, Pt> = { a: [30, 30], b: [30, 45] }
  it('ends when the last commanded action ends (no settle tail) and switches the opponent AI on', () => {
    const step = turnStep([{ kind: 'run', playerId: 'b', toX: 30, toY: 60 }], positions, 2)
    expect(step.duration).toBeCloseTo(15 / MOVE_MPS)
    expect(step.ai?.opp?.on).toBe(true)
    expect(step.ai?.ours).toBeUndefined()
  })
  it('clamps any single action to the budget', () => {
    const step = turnStep([{ kind: 'run', playerId: 'a', toX: 30, toY: 100 }], positions, 1) // 70m
    expect(step.moves[0].endTime).toBeCloseTo(ACTION_MAX_S)
  })
})

describe('action budget (XCOM-style range limit)', () => {
  const positions: Record<string, Pt> = { a: [34, 30], b: [34, 90] }
  it('a run inside the range is allowed, one beyond it is not', () => {
    expect(actionInRange({ kind: 'run', playerId: 'a', toX: 34, toY: 30 + RUN_RANGE_M - 1 }, positions)).toBe(true)
    expect(actionInRange({ kind: 'run', playerId: 'a', toX: 34, toY: 30 + RUN_RANGE_M + 1 }, positions)).toBe(false)
  })
  it('passes use the longer pass range', () => {
    expect(PASS_RANGE_M).toBeGreaterThan(RUN_RANGE_M)
    expect(actionInRange({ kind: 'pass', playerId: 'a', to: 'b' }, positions)).toBe(true) // 60m < 63m
    const far: Record<string, Pt> = { a: [34, 10], b: [34, 10 + PASS_RANGE_M + 2] }
    expect(actionInRange({ kind: 'pass', playerId: 'a', to: 'b' }, far)).toBe(false)
  })
})

describe('buildSnapshots', () => {
  const start: Record<string, Pt> = { a: [10, 10], b: [20, 20], d: [30, 30] }
  const end: Record<string, Pt> = { a: [10, 20], b: [20, 30], d: [30, 40] } // d = defender moved by the AI
  const actions: BuilderAction[] = [
    { kind: 'run', playerId: 'a', toX: 10, toY: 20 },
    { kind: 'pass', playerId: 'b', to: 'a' },
  ]
  const { plans } = scheduleTurn(actions, start)
  const snaps = buildSnapshots(3, plans, start, end, 'b', id)

  it('one snapshot per action, last one equal to the turn end state', () => {
    expect(snaps).toHaveLength(2)
    expect(snaps[1].positions).toEqual(end)
  })
  it('earlier snapshots land only the earlier movers and interpolate the defenders', () => {
    expect(snaps[0].positions.a).toEqual([10, 20]) // action 1 landed
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

    const tl = simulateStep(play, 1, initialState(play), holder, positions[holder])
    const last = tl.frames.at(-1)!
    expect(last.ball.holder).toBe(receiver)
    expect(last.players['o-LM'].x).toBeCloseTo(12, 0)
    expect(last.players['o-LM'].y).toBeCloseTo(55, 0)
    const oppMoved = play.players
      .filter((p) => p.team === 'opp')
      .map((p) => Math.hypot(last.players[p.id].x - p.x, last.players[p.id].y - p.y))
    expect(Math.max(...oppMoved)).toBeGreaterThan(2)
  })

  it('a chained receiver waits for the ball, then dribbles on — tween chains hold in the simulator', () => {
    const play = createDefaultPlay()
    const holder = 'o-LCM'
    const receiver = 'o-RST'
    const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
    const target: Pt = [40, 56]
    const step = turnStep(
      [
        { kind: 'pass', playerId: holder, to: receiver },
        { kind: 'dribble', playerId: receiver, toX: target[0], toY: target[1] },
      ],
      positions,
      1,
    )
    expect(step.moves[0].startTime).toBeCloseTo(step.passes[0].endTime) // waits to receive
    play.steps.push({ ...step, index: 1 })

    const tl = simulateStep(play, 1, initialState(play), holder, positions[holder])
    // before the pass lands the receiver has not left
    const early = tl.frames[Math.round((step.passes[0].endTime * 0.9) / (1 / 60))]
    expect(Math.hypot(early.players[receiver].x - positions[receiver][0], early.players[receiver].y - positions[receiver][1])).toBeLessThan(1)
    // at the end they carried the ball to the dribble target
    const last = tl.frames.at(-1)!
    expect(last.players[receiver].x).toBeCloseTo(target[0], 0)
    expect(last.players[receiver].y).toBeCloseTo(target[1], 0)
    expect(last.ball.holder).toBe(receiver)
    expect(Math.hypot(last.ball.x - last.players[receiver].x, last.ball.y - last.players[receiver].y)).toBeLessThan(3)
  })

  it('a two-run chain by one player follows both segments', () => {
    const play = createDefaultPlay()
    const holder = 'o-LCM'
    const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
    // o-RM starts at (58, 36): up the line, then cut inside
    const step = turnStep(
      [
        { kind: 'run', playerId: 'o-RM', toX: 58, toY: 50 },
        { kind: 'run', playerId: 'o-RM', toX: 48, toY: 56 },
      ],
      positions,
      1,
    )
    play.steps.push({ ...step, index: 1 })
    const tl = simulateStep(play, 1, initialState(play), holder, positions[holder])
    // mid-chain: at the first segment's end the player is at its target
    const atSeg1 = tl.frames[Math.round(step.moves[0].endTime / (1 / 60))]
    expect(atSeg1.players['o-RM'].x).toBeCloseTo(58, 0)
    expect(atSeg1.players['o-RM'].y).toBeCloseTo(50, 0)
    const last = tl.frames.at(-1)!
    expect(last.players['o-RM'].x).toBeCloseTo(48, 0)
    expect(last.players['o-RM'].y).toBeCloseTo(56, 0)
  })
})

describe('shortLabel', () => {
  it('fits a queue chip at phone width: "RCM→RST", "LST run", "LST dribble", "LST shot"', () => {
    expect(shortLabel({ kind: 'pass', playerId: 'RCM', to: 'RST' }, id)).toBe('RCM→RST')
    expect(shortLabel({ kind: 'run', playerId: 'LST', toX: 0, toY: 0 }, id)).toBe('LST run')
    expect(shortLabel({ kind: 'dribble', playerId: 'LST', toX: 0, toY: 0 }, id)).toBe('LST dribble')
    expect(shortLabel({ kind: 'shot', playerId: 'LST', toX: 0, toY: 0 }, id)).toBe('LST shot')
  })
})

describe('dribble → pass / dribble → shot chains (one player, one turn)', () => {
  const play = createDefaultPlay()
  const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
  const dribble: BuilderAction = { kind: 'dribble', playerId: 'o-LCB', toX: 25, toY: 33 }

  it('the pass leaves from the dribble end, once the dribble is over', () => {
    const s = scheduleTurn([dribble, { kind: 'pass', playerId: 'o-LCB', to: 'o-LST' }], positions)
    expect(s.plans).toHaveLength(2)
    expect(s.plans[1].from).toEqual([25, 33])
    expect(s.plans[1].start).toBeCloseTo(s.plans[0].end)
    expect(holderAfter('o-LCB', s.plans.map((p) => p.action))).toBe('o-LST')
    // the queue survives a removal elsewhere and the dribble → pass stays valid
    expect(sanitizeQueue([dribble, { kind: 'pass', playerId: 'o-LCB', to: 'o-LST' }], 'o-LCB')).toHaveLength(2)
  })

  it('the shot leaves from the dribble end', () => {
    const s = scheduleTurn([{ kind: 'dribble', playerId: 'o-LST', toX: 30, toY: 85 }, { kind: 'shot', playerId: 'o-LST', toX: 34, toY: 105.5 }], positions)
    expect(s.plans[1].from).toEqual([30, 85])
    expect(s.plans[1].start).toBeCloseTo(s.plans[0].end)
  })

  it('the simulated turn stops when the pass lands: nobody moves after the last commanded action', () => {
    const q: BuilderAction[] = [dribble, { kind: 'pass', playerId: 'o-LCB', to: 'o-LST' }]
    const step = turnStep(q, positions, 1)
    const s = scheduleTurn(q, positions)
    expect(step.duration).toBeCloseTo(s.plans[1].end)
    const game = { ...play, steps: [play.steps[0], step] }
    const tl = simulateStep(game, 1, initialState(game), 'o-LCB', positions['o-LCB'])
    expect(tl.duration).toBeCloseTo(s.plans[1].end)
    expect(tl.frames.at(-1)?.ball.holder).toBe('o-LST')
  })
})
