import { describe, expect, it } from 'vitest'
import { lerp, passFlight, trapezoid, tweenPosition } from '@/lib/engine/physics'

describe('trapezoid', () => {
  it('starts at 0 and ends at 1', () => {
    expect(trapezoid(0)).toBe(0)
    expect(trapezoid(1)).toBeCloseTo(1)
  })

  it('is monotonically increasing', () => {
    let prev = 0
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const p = trapezoid(t, 0.25)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })

  it('reaches halfway at t=0.5 (symmetric profile)', () => {
    expect(trapezoid(0.5, 0.25)).toBeCloseTo(0.5)
  })

  it('clamps out-of-range time', () => {
    expect(trapezoid(-1)).toBe(0)
    expect(trapezoid(2)).toBeCloseTo(1)
  })

  it('degenerates to linear with f=0', () => {
    expect(trapezoid(0.3, 0)).toBeCloseTo(0.3)
  })
})

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
  })
})

describe('tweenPosition', () => {
  it('lands exactly on the target at t=1', () => {
    const [x, y] = tweenPosition([0, 0], [10, 20], 1)
    expect(x).toBeCloseTo(10)
    expect(y).toBeCloseTo(20)
  })

  it('passes near the via point on a curved run', () => {
    const [x, y] = tweenPosition([0, 0], [10, 0], 0.5, 0.25, [5, 10])
    expect(x).toBeCloseTo(5)
    expect(y).toBeCloseTo(5) // quadratic bezier midpoint sits halfway to control
  })
})

describe('passFlight', () => {
  it('lob height peaks mid-flight and is zero at endpoints', () => {
    expect(passFlight([0, 0], [10, 10], 0, true).height).toBe(0)
    expect(passFlight([0, 0], [10, 10], 0.5, true).height).toBeCloseTo(1)
    expect(passFlight([0, 0], [10, 10], 1, true).height).toBe(0)
  })

  it('ground pass has no height', () => {
    expect(passFlight([0, 0], [10, 10], 0.5, false).height).toBe(0)
  })
})
