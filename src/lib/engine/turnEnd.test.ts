import { describe, expect, it } from 'vitest'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { H, initialState, simulateStep } from '@/lib/engine/simulator'
import { scheduleTurn, turnStep, type BuilderAction } from '@/lib/engine/turnBuilder'
import { planTeamShape, supportMovesToPlayerMoves } from '@/lib/engine/teamShape'

type Pt = [number, number]

// Stefan (2026-10-27): "the turn doesn't seem to end exactly as the player command ends". The step
// did stop at the last command's end, but the AI defenders were still sprinting (6.8 m/s) on the
// last frame and froze in mid-stride. A turn now ends with the whole picture at rest.
describe('a turn ends exactly when the last command ends', () => {
  const play = createDefaultPlay()
  const id = (label: string) => play.players.find((p) => p.label === label && p.team === 'ours')!.id
  const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
  const lcm = id('LCM')
  const lst = id('LST')

  const resolve = (queue: BuilderAction[], holder: string) => {
    const schedule = scheduleTurn(queue, positions)
    const support = planTeamShape({
      players: play.players.map((p) => ({ id: p.id, team: p.team, label: p.label })),
      positions,
      homes: positions,
      attackingTeam: 'ours',
      holder,
      queue,
      schedule,
    })
    const step = turnStep(queue, positions, 1, {}, supportMovesToPlayerMoves(support))
    const next = { ...play, steps: [...play.steps, step] }
    return { schedule, tl: simulateStep(next, 1, initialState(next), holder, positions[holder]) }
  }

  const cases: [string, BuilderAction[], string][] = [
    ['a single run', [{ kind: 'run', playerId: lst, toX: positions[lst][0], toY: positions[lst][1] + 12 }], lcm],
    ['a dribble then a pass', [{ kind: 'dribble', playerId: lcm, toX: positions[lcm][0], toY: positions[lcm][1] + 8 }, { kind: 'pass', playerId: lcm, to: lst }], lcm],
  ]

  for (const [name, queue, holder] of cases) {
    it(`${name}: the timeline lasts exactly until the last action's end`, () => {
      const { schedule, tl } = resolve(queue, holder)
      const lastEnd = Math.max(...schedule.plans.map((p) => p.end))
      expect(tl.duration).toBeCloseTo(lastEnd, 9)
      expect(tl.frames.at(-1)!.t).toBeCloseTo(lastEnd, 9)
    })

    it(`${name}: nobody — commanded, support or defender — is still moving on the last frame`, () => {
      const { tl } = resolve(queue, holder)
      const a = tl.frames.at(-2)!.players
      const b = tl.frames.at(-1)!.players
      const fastest = Math.max(...Object.keys(b).map((k) => Math.hypot(b[k].x - a[k].x, b[k].y - a[k].y) / H))
      expect(fastest).toBeLessThan(0.5)
    })
  }

  it('the commanded player lands on his target on the last frame', () => {
    const { schedule, tl } = resolve(cases[0][1], lcm)
    const end = tl.frames.at(-1)!.players[lst]
    expect(end.x).toBeCloseTo(schedule.plans[0].to[0], 6)
    expect(end.y).toBeCloseTo(schedule.plans[0].to[1], 6)
  })
})
