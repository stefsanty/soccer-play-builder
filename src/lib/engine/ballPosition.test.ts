import { describe, expect, it } from 'vitest'
import type { Play, PlayStep } from '@/lib/types/play'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { setupBallPosition } from '@/lib/engine/ballHolder'
import { getTimeline } from '@/lib/engine/simulator'

const step = (index: number, extra: Partial<PlayStep> = {}): PlayStep => ({
  id: `s${index}`,
  index,
  title: `Step ${index + 1}`,
  duration: 2,
  moves: [],
  passes: [],
  defenderRules: {},
  faceTargets: [],
  ...extra,
})

/** A play the way the editor store shapes it: a duration-0 setup step, then a pass step. */
function playWithSetup(): Play {
  const play = createDefaultPlay()
  play.steps = [
    step(0, { title: 'Setup', duration: 0 }),
    step(1, { passes: [{ from: 'o-GK', to: 'o-RCB', startTime: 0.8, endTime: 1.4 }] }),
  ]
  return play
}

describe('setup ball position', () => {
  it('defaults to the centre spot when the setup step has none', () => {
    expect(setupBallPosition(createDefaultPlay())).toEqual({ x: 34, y: 52.5 })
  })

  it('returns the authored spot when set', () => {
    const play = playWithSetup()
    play.steps[0].ballPosition = { x: 10, y: 20 }
    expect(setupBallPosition(play)).toEqual({ x: 10, y: 20 })
  })

  it('starts the animation with the ball on the authored spot', () => {
    const play = playWithSetup()
    play.steps[0].ballPosition = { x: 10, y: 20 }
    const setup = getTimeline(play, 0)
    expect(setup.frames[0].ball.x).toBeCloseTo(10)
    expect(setup.frames[0].ball.y).toBeCloseTo(20)
    // the next step inherits that exact spot as its starting ball position
    const tl = getTimeline(play, 1)
    expect(tl.frames[0].ball.x).toBeCloseTo(10)
    expect(tl.frames[0].ball.y).toBeCloseTo(20)
    // and by the time the pass starts the ball has settled at the passer's feet
    const prePass = tl.frames.findLast((f) => f.t < 0.8)!
    const gk = prePass.players['o-GK']
    expect(Math.hypot(prePass.ball.x - gk.x, prePass.ball.y - gk.y)).toBeLessThan(2)
  })

  it('starts the animation from the centre spot when no position is authored', () => {
    const tl = getTimeline(playWithSetup(), 0)
    expect(tl.frames[0].ball.x).toBeCloseTo(34)
    expect(tl.frames[0].ball.y).toBeCloseTo(52.5)
  })
})
