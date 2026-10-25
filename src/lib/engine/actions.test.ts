import { describe, expect, it } from 'vitest'
import { autoFixConflicts, detectConflicts, type ActionItem } from '@/lib/engine/actions'

const recv = (start: number, end: number): ActionItem => ({ id: `recv:0:p`, type: 'receive', from: 'a', startTime: start, endTime: end })
const pass = (start: number, end: number, i = 0): ActionItem => ({ id: `pass:${i}:p`, type: 'pass', to: 'b', startTime: start, endTime: end })
const run = (start: number, end: number): ActionItem => ({ id: 'run:p', type: 'run', toX: 50, toY: 60, startTime: start, endTime: end })

describe('detectConflicts: moving is never a conflict', () => {
  it('a run during an incoming pass is legal (running onto the ball)', () => {
    expect(detectConflicts([recv(0, 1.4), run(0, 1.8)])).toEqual([])
  })

  it('a run while your own pass is in flight is legal (support run)', () => {
    expect(detectConflicts([pass(0, 1.2), run(0, 2)])).toEqual([])
  })

  it('two overlapping ball-bound actions still conflict (one player, one ball)', () => {
    expect(detectConflicts([recv(0, 1.4), pass(1.0, 2.0)])).toHaveLength(1)
    expect(detectConflicts([recv(0, 1.4), recv(1.0, 2.0)])).toHaveLength(1)
  })

  it('sequential ball-bound actions do not conflict', () => {
    expect(detectConflicts([recv(0, 1.4), pass(1.4, 2.4)])).toEqual([])
  })
})

describe('autoFixConflicts: only passes are re-timed', () => {
  it('pushes a pass to start after the receive, keeping its flight time', () => {
    const fixed = autoFixConflicts([recv(0, 1.4), pass(1.0, 2.0)])
    const p = fixed.find((a) => a.type === 'pass')!
    expect(p.startTime).toBeCloseTo(1.4)
    expect(p.endTime).toBeCloseTo(2.4)
  })

  it('leaves runs and receives untouched', () => {
    const fixed = autoFixConflicts([recv(0, 1.4), run(0, 3), pass(1.0, 2.0)])
    expect(fixed.find((a) => a.type === 'run')).toEqual(run(0, 3))
    expect(fixed.find((a) => a.type === 'receive')).toEqual(recv(0, 1.4))
  })
})
