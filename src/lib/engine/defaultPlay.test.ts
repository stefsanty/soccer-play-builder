import { describe, it, expect } from 'vitest'
import { createDefaultPlay } from './defaultPlay'

describe('createDefaultPlay', () => {
  it('has 11 players per team, ours in the bottom half and opp in the top half', () => {
    const play = createDefaultPlay()
    const ours = play.players.filter((p) => p.team === 'ours')
    const opp = play.players.filter((p) => p.team === 'opp')
    expect(ours).toHaveLength(11)
    expect(opp).toHaveLength(11)
    expect(ours.every((p) => p.y < 52.5)).toBe(true)
    expect(opp.every((p) => p.y > 52.5)).toBe(true)
    expect(new Set(play.players.map((p) => p.id)).size).toBe(22)
    expect(play.steps).toHaveLength(1)
  })
})
