import { describe, expect, it } from 'vitest'
import { LANE_REACH_M, MAX_RISK, TACKLE_REACH_M, dribbleRisk, passRisk, rollRisk } from '@/lib/engine/risk'

type Pt = [number, number]
const from: Pt = [20, 40]
const to: Pt = [40, 60] // ~28 m pass

describe('passRisk', () => {
  it('is zero with nobody near the lane', () => {
    expect(passRisk(from, to, [{ id: 'd', at: [60, 10] }])).toEqual({ risk: 0, by: null })
  })
  it('is high with a defender standing on the lane, and names him', () => {
    const r = passRisk(from, to, [{ id: 'far', at: [60, 10] }, { id: 'on', at: [30, 50] }])
    expect(r.by).toBe('on')
    expect(r.risk).toBeGreaterThan(0.4)
    expect(r.risk).toBeLessThanOrEqual(MAX_RISK)
  })
  it('falls off as the defender moves away from the lane', () => {
    const near = passRisk(from, to, [{ id: 'd', at: [31, 49] }]).risk   // ~1.4 m off the lane
    const mid = passRisk(from, to, [{ id: 'd', at: [33, 47] }]).risk    // ~4.2 m off
    const out = passRisk(from, to, [{ id: 'd', at: [30 + LANE_REACH_M + 1, 50 - LANE_REACH_M - 1] }]).risk
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(0)
    expect(out).toBe(0)
  })
  it('a longer pass through the same gap is riskier than a short one', () => {
    const short = passRisk([28, 48], [32, 52], [{ id: 'd', at: [31, 49] }]).risk
    const long = passRisk(from, to, [{ id: 'd', at: [31, 49] }]).risk
    expect(long).toBeGreaterThan(short)
  })
  it('a defender tight on the receiver counts too', () => {
    expect(passRisk(from, to, [{ id: 'd', at: [41, 61] }]).risk).toBeGreaterThan(0.3)
  })
  it('never exceeds the cap', () => {
    expect(passRisk(from, [to[0] + 30, to[1] + 30], [{ id: 'd', at: [30, 50] }]).risk).toBeLessThanOrEqual(MAX_RISK)
  })
})

describe('dribbleRisk', () => {
  const path: Pt = [20, 60]
  it('is zero when no defender is within tackle reach of the path', () => {
    expect(dribbleRisk(from, path, [{ id: 'd', at: [20 + TACKLE_REACH_M + 1, 50] }])).toEqual({ risk: 0, by: null })
  })
  it('each defender within reach adds up to 35%; two add up, and the nearest is named', () => {
    const one = dribbleRisk(from, path, [{ id: 'a', at: [20.5, 50] }])
    const two = dribbleRisk(from, path, [{ id: 'a', at: [20.5, 50] }, { id: 'b', at: [21.5, 55] }])
    expect(one.by).toBe('a')
    expect(one.risk).toBeGreaterThan(0.25)
    expect(one.risk).toBeLessThanOrEqual(0.35)
    expect(two.risk).toBeGreaterThan(one.risk)
    expect(two.by).toBe('a')
  })
  it('is capped', () => {
    const wall = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, at: [20, 42 + i * 2] as Pt }))
    expect(dribbleRisk(from, path, wall).risk).toBeLessThanOrEqual(MAX_RISK)
  })
})

describe('rollRisk', () => {
  it('loses the ball when the roll lands under the risk', () => {
    expect(rollRisk(0.3, () => 0.29)).toBe('lost')
    expect(rollRisk(0.3, () => 0.3)).toBe('kept')
    expect(rollRisk(0, () => 0)).toBe('kept')
  })
})
