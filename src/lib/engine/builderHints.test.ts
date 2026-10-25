import { describe, expect, it } from 'vitest'
import { MAX_SUGGESTIONS, MIN_SUGGESTION_M, drawOrder, pickSuggestions } from '@/lib/engine/builderHints'
import type { AISuggestedMove } from '@/lib/engine/attackingAI'

const mv = (playerId: string, reason: AISuggestedMove['reason'], toX: number, toY: number): AISuggestedMove => ({
  playerId,
  toX,
  toY,
  startTime: 0,
  endTime: 1,
  reason,
})
const at: Record<string, [number, number]> = {
  gk: [34, 5],
  lb: [10, 20],
  lm: [10, 36],
  rcm: [43, 34],
  rst: [42, 47],
  lst: [26, 47],
}
const ball: [number, number] = [26, 47]
const opts = { ball, positions: at, isKeeper: (id: string) => id === 'gk' }

describe('pickSuggestions', () => {
  it('drops the keeper and runs shorter than the noise floor', () => {
    const picked = pickSuggestions([mv('gk', 'spacing', 36, 6), mv('lb', 'spacing', 10 + MIN_SUGGESTION_M - 1, 20)], opts)
    expect(picked).toEqual([])
  })
  it('keeps at most MAX_SUGGESTIONS, nearest to the ball first', () => {
    const all = [mv('lb', 'spacing', 10, 30), mv('lm', 'spacing', 10, 46), mv('rcm', 'spacing', 43, 44), mv('rst', 'danger-zone', 42, 57)]
    const picked = pickSuggestions(all, opts)
    expect(picked).toHaveLength(MAX_SUGGESTIONS)
    expect(picked.map((s) => s.playerId)).toEqual(['rst', 'lm'])
  })
  it('a support run (the passer following his pass) always comes first', () => {
    const all = [mv('rst', 'danger-zone', 42, 57), mv('lb', 'support', 10, 30), mv('lm', 'spacing', 10, 46)]
    expect(pickSuggestions(all, opts).map((s) => s.playerId)).toEqual(['lb', 'rst'])
  })
})

describe('drawOrder', () => {
  const players = [
    { id: 'o1', team: 'ours' as const },
    { id: 'p1', team: 'opp' as const },
    { id: 'o2', team: 'ours' as const },
    { id: 'p2', team: 'opp' as const },
  ]
  it('draws defenders first, then our team, with the ball holder last (on top)', () => {
    expect(drawOrder(players, 'o1').map((p) => p.id)).toEqual(['p1', 'p2', 'o2', 'o1'])
  })
  it('keeps our team above defenders when nobody holds the ball', () => {
    expect(drawOrder(players, null).map((p) => p.id)).toEqual(['p1', 'p2', 'o1', 'o2'])
  })
})
