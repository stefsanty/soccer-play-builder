import { describe, expect, it } from 'vitest'
import {
  actionInRange,
  actionLabel,
  allowedKinds,
  holderAfter,
  sanitizeQueue,
  scheduleTurn,
  SHOT_MPS,
  type BuilderAction,
} from '@/lib/engine/turnBuilder'
import { GOAL_CENTRE_X, GOAL_LINE_Y } from '@/lib/engine/goal'

type Pt = [number, number]
const target: Pt = [GOAL_CENTRE_X, GOAL_LINE_Y + 0.5]
const shot: BuilderAction = { kind: 'shot', playerId: 'a', toX: target[0], toY: target[1] }

describe('shot action', () => {
  it('only the (projected) ball carrier may shoot', () => {
    expect(allowedKinds('a', 'a')).toContain('shot')
    expect(allowedKinds('b', 'a')).not.toContain('shot')
  })

  it('after a shot nobody holds the ball for the rest of the turn', () => {
    expect(holderAfter('a', [shot])).toBeNull()
    expect(holderAfter('a', [{ kind: 'pass', playerId: 'a', to: 'b' }, { ...shot, playerId: 'b' }])).toBeNull()
  })

  it('sanitizeQueue drops ball actions queued after a shot, keeps runs', () => {
    const q: BuilderAction[] = [shot, { kind: 'dribble', playerId: 'a', toX: 1, toY: 1 }, { kind: 'run', playerId: 'c', toX: 1, toY: 1 }]
    expect(sanitizeQueue(q, 'a')).toEqual([shot, { kind: 'run', playerId: 'c', toX: 1, toY: 1 }])
  })

  it('is in range up to 35 m from the shooter, measured to the target', () => {
    expect(actionInRange(shot, { a: [GOAL_CENTRE_X, GOAL_LINE_Y - 30] })).toBe(true)
    expect(actionInRange(shot, { a: [GOAL_CENTRE_X, GOAL_LINE_Y - 40] })).toBe(false)
  })

  it('labels as "X shoots"', () => {
    expect(actionLabel(shot, (id) => id.toUpperCase())).toBe('A shoots')
  })

  it('schedules as a ball flight to the target point that nobody receives', () => {
    const positions = { a: [GOAL_CENTRE_X, GOAL_LINE_Y - 24] as Pt }
    const s = scheduleTurn([shot], positions)
    expect(s.passes).toHaveLength(1)
    expect(s.passes[0]).toMatchObject({ from: 'a', to: '', target, startTime: 0 })
    expect(s.passes[0].endTime).toBeCloseTo(24.5 / SHOT_MPS, 5)
    expect(s.moves).toHaveLength(0)
    expect(s.plans[0].to).toEqual(target)
  })

  it('a saved shot is scheduled as a flight that homes onto the keeper', () => {
    const positions = { a: [GOAL_CENTRE_X, GOAL_LINE_Y - 24] as Pt, gk: [GOAL_CENTRE_X, GOAL_LINE_Y - 4] as Pt }
    const s = scheduleTurn([shot], positions, { saved: { 0: 'gk' } })
    expect(s.passes[0]).toMatchObject({ from: 'a', to: 'gk' })
    expect(s.passes[0].target).toBeUndefined()
  })

  it('a later run by the shooter starts when the shot leaves his foot', () => {
    const positions = { a: [GOAL_CENTRE_X, GOAL_LINE_Y - 24] as Pt }
    const s = scheduleTurn([shot, { kind: 'run', playerId: 'a', toX: 20, toY: 90 }], positions)
    expect(s.plans[1].start).toBeCloseTo(s.plans[0].end, 5)
  })
})
