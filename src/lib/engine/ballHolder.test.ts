import { describe, expect, it } from 'vitest'
import { createDefaultPlay } from './defaultPlay'
import { ballHolderAfter, ballHolderBefore, initialBallHolder } from './ballHolder'

function playWithPasses() {
  const play = createDefaultPlay()
  const mk = (i: number) => ({ ...play.steps[0], id: `s${i}`, index: i, passes: [] as { from: string; to: string; startTime: number; endTime: number }[] })
  play.steps = [mk(0), mk(1), mk(2)]
  play.steps[1].passes = [{ from: 'o-LCM', to: 'o-LST', startTime: 0, endTime: 2 }]
  play.steps[2].passes = [{ from: 'o-LST', to: 'o-RST', startTime: 0, endTime: 2 }]
  return play
}

describe('ballHolder', () => {
  it('has no holder when nobody passes', () => {
    const play = createDefaultPlay()
    expect(initialBallHolder(play)).toBeNull()
    expect(ballHolderAfter(play, 0)).toBeNull()
  })

  it('starts with the first passer and follows the last receiver', () => {
    const play = playWithPasses()
    expect(ballHolderAfter(play, 0)).toBe('o-LCM')
    expect(ballHolderBefore(play, 1)).toBe('o-LCM')
    expect(ballHolderAfter(play, 1)).toBe('o-LST')
    expect(ballHolderAfter(play, 2)).toBe('o-RST')
  })
})
