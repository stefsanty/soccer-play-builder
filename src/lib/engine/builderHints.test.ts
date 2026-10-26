import { describe, expect, it } from 'vitest'
import { drawOrder } from '@/lib/engine/builderHints'

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
