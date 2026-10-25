import { describe, expect, it } from 'vitest'
import type { PlayStep } from '@/lib/types/play'
import { SETTLE_MARGIN, stepDuration } from '@/lib/engine/stepMeta'

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
