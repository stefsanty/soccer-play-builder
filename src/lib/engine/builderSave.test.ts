import { describe, expect, it } from 'vitest'
import { builderTitle, hasUnsavedWork } from '@/lib/engine/builderSave'

describe('hasUnsavedWork', () => {
  it('is false on a fresh game: only the setup step, nothing queued', () => {
    expect(hasUnsavedWork({ stepCount: 1, queued: 0, savedStepCount: 0 })).toBe(false)
  })
  it('is true once a turn has resolved and was not saved', () => {
    expect(hasUnsavedWork({ stepCount: 2, queued: 0, savedStepCount: 0 })).toBe(true)
  })
  it('is true while actions are queued, even on a fresh game', () => {
    expect(hasUnsavedWork({ stepCount: 1, queued: 1, savedStepCount: 0 })).toBe(true)
  })
  it('is false right after saving, and true again after the next turn', () => {
    expect(hasUnsavedWork({ stepCount: 3, queued: 0, savedStepCount: 3 })).toBe(false)
    expect(hasUnsavedWork({ stepCount: 4, queued: 0, savedStepCount: 3 })).toBe(true)
  })
})

describe('builderTitle', () => {
  it('names the game after the builder and the date', () => {
    const t = builderTitle(new Date(2026, 9, 26, 14, 5))
    expect(t.startsWith('Turn Builder')).toBe(true)
    expect(t).toContain('2026')
  })
})
