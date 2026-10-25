import { describe, expect, it } from 'vitest'
import { MOVE_MPS, scheduleTurn, type BuilderAction } from '@/lib/engine/turnBuilder'

type Pt = [number, number]
const positions: Record<string, Pt> = { a: [20, 40], b: [40, 60], c: [50, 70], d: [30, 50] }

describe('scheduleTurn with lost-ball outcomes', () => {
  it('an intercepted pass flies to the defender and the receiver never gets the ball', () => {
    const q: BuilderAction[] = [
      { kind: 'pass', playerId: 'a', to: 'b' },
      { kind: 'pass', playerId: 'b', to: 'c' },
      { kind: 'run', playerId: 'c', toX: 55, toY: 75 },
    ]
    const s = scheduleTurn(q, positions, { intercepted: { 0: 'd' } })
    expect(s.passes).toHaveLength(1)
    expect(s.passes[0]).toMatchObject({ from: 'a', to: 'd' })
    // b's onward pass is gone, c's run still happens
    expect(s.plans.map((p) => p.action.kind)).toEqual(['pass', 'run'])
    expect(s.plans[0].to).toEqual(positions.d)
  })

  it('a tackled dribble stops at the tackle point and hands the ball to the tackler', () => {
    const q: BuilderAction[] = [
      { kind: 'dribble', playerId: 'a', toX: 20, toY: 60 },
      { kind: 'pass', playerId: 'a', to: 'b' },
    ]
    const s = scheduleTurn(q, positions, { tackled: { 0: { by: 'd', at: 0.5 } } })
    expect(s.moves).toHaveLength(1)
    expect([s.moves[0].toX, s.moves[0].toY]).toEqual([20, 50])
    expect(s.moves[0].endTime).toBeCloseTo(10 / MOVE_MPS, 5)
    // the tackle itself: a short flight from the dribbler to the defender when the dribble is cut
    expect(s.passes).toHaveLength(1)
    expect(s.passes[0]).toMatchObject({ from: 'a', to: 'd' })
    expect(s.passes[0].startTime).toBeCloseTo(s.moves[0].endTime, 5)
    // a's later pass never happens
    expect(s.plans).toHaveLength(1)
    expect(s.plans[0].to).toEqual([20, 50])
    expect(s.planned.a).toEqual([20, 50])
  })
})
