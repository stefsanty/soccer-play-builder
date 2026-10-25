import { describe, expect, it } from 'vitest'
import type { PlayStep } from '@/lib/types/play'
import { SETTLE_MARGIN, narrate, stepDuration } from '@/lib/engine/stepMeta'

const step = (extra: Partial<PlayStep> = {}): PlayStep => ({
  id: 's',
  index: 1,
  title: 'Step',
  duration: 0,
  moves: [],
  passes: [],
  defenderRules: {},
  faceTargets: [],
  ...extra,
})

describe('stepDuration', () => {
  it('keeps an explicitly authored duration (legacy steps)', () => {
    const s = step({ duration: 4, passes: [{ from: 'a', to: 'b', startTime: 0, endTime: 9 }] })
    expect(stepDuration(s)).toBe(4)
  })

  it('derives the duration from the last action end plus the settle margin', () => {
    const s = step({
      passes: [{ from: 'a', to: 'b', startTime: 0, endTime: 1.4 }],
      moves: [{ playerId: 'b', toX: 50, toY: 80, startTime: 0, endTime: 2.1 }],
    })
    expect(stepDuration(s)).toBeCloseTo(2.1 + SETTLE_MARGIN)
  })

  it('a step with no actions is instantaneous', () => {
    expect(stepDuration(step())).toBe(0)
  })
})

describe('narrate', () => {
  const labelOf = (id: string) => id.toUpperCase()

  it('a pass step reads as the ball path', () => {
    const s = step({ passes: [{ from: 'gk', to: 'rcb', startTime: 0, endTime: 1 }] })
    expect(narrate(s, labelOf)).toBe('GK → RCB')
  })

  it('a legacy multi-pass step summarises first passer to last receiver', () => {
    const s = step({
      passes: [
        { from: 'gk', to: 'rcb', startTime: 0, endTime: 1 },
        { from: 'rcb', to: 'rb', startTime: 1, endTime: 2 },
      ],
    })
    expect(narrate(s, labelOf)).toBe('GK → RB')
  })

  it('pure movement reads as Reposition, hidden-only moves as Hold', () => {
    const run = { playerId: 'rm', toX: 50, toY: 60, startTime: 0, endTime: 2 }
    expect(narrate(step({ moves: [run] }), labelOf)).toBe('Reposition')
    expect(narrate(step({ moves: [{ ...run, hidden: true }] }), labelOf)).toBe('Hold')
  })

  it('an empty step has nothing to say', () => {
    expect(narrate(step(), labelOf)).toBe('')
  })
})
