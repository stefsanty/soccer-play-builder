// Concurrency within a step: a run and a pass in flight happen at the same time.
// The headline case — "run onto a pass" — works because the simulator's flight path
// homes onto the receiver's LIVE position every frame, not where he stood at kickoff.

import { describe, expect, it } from 'vitest'
import type { Play, PlayStep } from '@/lib/types/play'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { getTimeline } from '@/lib/engine/simulator'

const step = (index: number, extra: Partial<PlayStep> = {}): PlayStep => ({
  id: `s${index}`,
  index,
  title: `Step ${index + 1}`,
  duration: 0,
  moves: [],
  passes: [],
  defenderRules: {},
  faceTargets: [],
  ...extra,
})

describe('pass into a run (concurrent run + pass in flight)', () => {
  it('lands the ball at the receiver`s moved position, not his starting spot', () => {
    const play: Play = createDefaultPlay()
    // o-RCM starts at (43, 34). While o-GK's pass is in flight, he sprints to (58, 55).
    const receiverStart = { x: 43, y: 34 }
    play.steps = [
      step(0), // setup, instantaneous
      step(1, {
        duration: 2,
        passes: [{ from: 'o-GK', to: 'o-RCM', startTime: 0, endTime: 1.6 }],
        moves: [{ playerId: 'o-RCM', toX: 58, toY: 55, startTime: 0, endTime: 1.8 }],
      }),
    ]

    const tl = getTimeline(play, 1)
    const landing = tl.frames.find((f) => f.t >= 1.6)!
    const receiver = landing.players['o-RCM']

    // the receiver has really moved by the time the ball arrives
    expect(Math.hypot(receiver.x - receiverStart.x, receiver.y - receiverStart.y)).toBeGreaterThan(10)
    // and the ball is at his feet there (within the carry offset + a stride)…
    expect(Math.hypot(landing.ball.x - receiver.x, landing.ball.y - receiver.y)).toBeLessThan(2.5)
    // …not back where he started
    expect(Math.hypot(landing.ball.x - receiverStart.x, landing.ball.y - receiverStart.y)).toBeGreaterThan(10)
    expect(landing.ball.holder).toBe('o-RCM')
  })
})
