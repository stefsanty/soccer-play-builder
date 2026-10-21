import { describe, it, expect } from 'vitest'
import { computeFrame } from '../computeFrame'
import { createDefaultPlay } from '../defaultPlay'
import type { Play } from '@/lib/types/play'

function makePlay(): Play {
  const play = createDefaultPlay()
  play.steps.push({
    ...play.steps[0],
    id: 's2',
    index: 1,
    duration: 4,
    moves: [{ playerId: 'o-LST', toX: 40, toY: 60, startTime: 0, endTime: 4 }],
    passes: [],
  })
  return play
}

const find = (f: ReturnType<typeof computeFrame>, id: string) => f.players.find((p) => p.id === id)!

describe('computeFrame', () => {
  it('t=0 → players at starting positions', () => {
    const play = makePlay()
    const start = play.players.find((p) => p.id === 'o-LST')!
    const p = find(computeFrame(play, 1, 0), 'o-LST')
    expect([p.x, p.y]).toEqual([start.x, start.y])
  })

  it('t=1 → players at ending positions', () => {
    const p = find(computeFrame(makePlay(), 1, 1), 'o-LST')
    expect(p.x).toBeCloseTo(40)
    expect(p.y).toBeCloseTo(60)
  })

  it('t=0.5 → players interpolated (symmetric easing hits the midpoint)', () => {
    const play = makePlay()
    const start = play.players.find((p) => p.id === 'o-LST')!
    const p = find(computeFrame(play, 1, 0.5), 'o-LST')
    expect(p.x).toBeCloseTo((start.x + 40) / 2)
    expect(p.y).toBeCloseTo((start.y + 60) / 2)
  })

  it('applies earlier steps in full and honours startTime/endTime windows', () => {
    const play = makePlay()
    play.steps.push({ ...play.steps[1], id: 's3', index: 2, moves: [{ playerId: 'o-LST', toX: 50, toY: 70, startTime: 2, endTime: 4 }] })
    const early = find(computeFrame(play, 2, 0.25), 'o-LST') // 1s in: second move hasn't started
    expect([early.x, early.y]).toEqual([40, 60])
    const end = find(computeFrame(play, 2, 1), 'o-LST')
    expect([end.x, end.y]).toEqual([50, 70])
  })

  it('emits a run trail that grows with t', () => {
    const play = makePlay()
    expect(computeFrame(play, 1, 0.5).runTrails[0].progress).toBeCloseTo(0.5)
    expect(computeFrame(play, 1, 1).runTrails[0]).toMatchObject({ playerId: 'o-LST', progress: 1 })
  })

  it('null play → empty frame', () => {
    const f = computeFrame(null, 0, 0.5)
    expect(f).toEqual({ players: [], ball: null, activePass: null, runTrails: [] })
  })

  it('pass at t=0.5 → activePass.progress ≈ 0.5 and ball is mid-flight', () => {
    const play = makePlay()
    play.steps[1].moves = []
    play.steps[1].passes = [{ from: 'o-LCM', to: 'o-LST', startTime: 0, endTime: 4 }]
    const f = computeFrame(play, 1, 0.5)
    expect(f.activePass!.progress).toBeCloseTo(0.5)
    const a = f.activePass!
    expect(f.ball!.x).toBeCloseTo((a.from[0] + a.to[0]) / 2)
    expect(f.ball!.y).toBeCloseTo((a.from[1] + a.to[1]) / 2)
  })

  it('ball rests with the receiver after the pass and with the passer before it', () => {
    const play = makePlay()
    play.steps[1].moves = []
    play.steps[1].passes = [{ from: 'o-LCM', to: 'o-LST', startTime: 1, endTime: 2 }]
    const before = computeFrame(play, 1, 0)
    const after = computeFrame(play, 1, 1)
    expect(before.activePass).toBeNull()
    expect(before.ball).toMatchObject({ x: find(before, 'o-LCM').x, y: find(before, 'o-LCM').y })
    expect(after.ball).toMatchObject({ x: find(after, 'o-LST').x, y: find(after, 'o-LST').y })
  })
})
