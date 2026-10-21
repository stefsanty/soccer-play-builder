// Motion primitives for the animation engine.
// Trapezoid easing: accelerate for `f` of the duration, cruise, decelerate
// for the final `f` — matches how a player speeds up and slows down.

/**
 * Trapezoidal velocity profile mapped to progress.
 * @param t normalized time 0..1
 * @param f ease fraction 0..0.5 — time spent accelerating (and decelerating)
 * @returns normalized progress 0..1
 */
export function trapezoid(t: number, f = 0.25): number {
  const tc = Math.min(Math.max(t, 0), 1)
  const fc = Math.min(Math.max(f, 0), 0.5)
  if (fc === 0) return tc
  // Peak velocity so total area under profile = 1
  const vMax = 1 / (1 - fc)
  if (tc < fc) {
    return (vMax * tc * tc) / (2 * fc)
  }
  if (tc < 1 - fc) {
    return (vMax * fc) / 2 + vMax * (tc - fc)
  }
  const td = 1 - tc
  return 1 - (vMax * td * td) / (2 * fc)
}

/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Tween a 2D position with trapezoid easing, optionally through a quadratic
 * bezier control point (`via`) for curved runs.
 */
export function tweenPosition(
  from: [number, number],
  to: [number, number],
  t: number,
  easeFraction = 0.25,
  via?: [number, number],
): [number, number] {
  const p = trapezoid(t, easeFraction)
  if (via) {
    const q = 1 - p
    return [
      q * q * from[0] + 2 * q * p * via[0] + p * p * to[0],
      q * q * from[1] + 2 * q * p * via[1] + p * p * to[1],
    ]
  }
  return [lerp(from[0], to[0], p), lerp(from[1], to[1], p)]
}

/**
 * Ball flight for a pass: linear in the plane; lobs get a parabolic
 * "height" the renderer can use for scale/shadow.
 */
export function passFlight(
  from: [number, number],
  to: [number, number],
  t: number,
  isLob = false,
): { x: number; y: number; height: number } {
  const tc = Math.min(Math.max(t, 0), 1)
  const x = lerp(from[0], to[0], tc)
  const y = lerp(from[1], to[1], tc)
  const height = isLob ? 4 * tc * (1 - tc) : 0 // peaks at 1 mid-flight
  return { x, y, height }
}
