import { describe, expect, it } from 'vitest'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { isBuilderGame, replayGame } from '@/lib/engine/builderReplay'
import { turnStep, type BuilderAction } from '@/lib/engine/turnBuilder'
import type { Play } from '@/lib/types/play'

type Pt = [number, number]
const id = (s: string) => s

/** A two-turn game saved the way BuilderClient saves it. */
function savedGame(): Play {
  const play = createDefaultPlay()
  const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
  const t1: BuilderAction[] = [
    { kind: 'pass', playerId: 'o-RCM', to: 'o-RST' },
    { kind: 'run', playerId: 'o-LM', toX: 10, toY: 44 },
  ]
  const step1 = { ...turnStep(t1, positions, 1), builder: { actions: t1, outcomes: {}, startHolder: 'o-RCM', endHolder: 'o-RST', goal: false } }
  // turn 2: a pass that the dice intercepted — the ball came back to the passer
  const t2: BuilderAction[] = [{ kind: 'pass', playerId: 'o-RST', to: 'o-LST' }]
  const outcomes = { intercepted: { 0: 'p-LST' } }
  const step2 = { ...turnStep(t2, positions, 2, outcomes), builder: { actions: t2, outcomes, startHolder: 'o-RST', endHolder: 'o-RST', goal: false } }
  return {
    ...play,
    steps: [{ ...play.steps[0], ballPosition: { x: 43, y: 34 }, builder: { kickoffHolder: 'o-RCM' } }, step1, step2],
  }
}

describe('replayGame', () => {
  it('ignores plays that did not come from the builder', () => {
    const play = createDefaultPlay()
    expect(isBuilderGame(play)).toBe(false)
    expect(replayGame(play, id)).toBeNull()
  })

  it('rebuilds kick-off plus one snapshot per action, the holder, the turn counter and the chain', () => {
    const game = savedGame()
    expect(isBuilderGame(game)).toBe(true)
    const r = replayGame(game, id)
    expect(r).not.toBeNull()
    if (!r) return
    expect(r.history.map((s) => [s.turn, s.actionIndex])).toEqual([
      [0, 0],
      [1, 1],
      [1, 2],
      [2, 1],
    ])
    expect(r.history[0].holder).toBe('o-RCM')
    expect(r.history[2].holder).toBe('o-RST')
    // the intercepted pass: the dice said the ball came back to RST, not on to LST
    expect(r.history[3].holder).toBe('o-RST')
    expect(r.holder).toBe('o-RST')
    expect(r.turn).toBe(3)
    expect(r.score).toBe(0)
    expect(r.skipped).toBe(0)
    expect(r.chain?.holder).toBe('o-RST')
    // the chain stands where the last snapshot stands
    const lastSnap = r.history[r.history.length - 1]
    expect(r.chain?.state['o-LM'].x).toBeCloseTo(lastSnap.positions['o-LM'][0], 5)
  })

  it('counts goals and stops at the first turn without bookkeeping', () => {
    const game = savedGame()
    game.steps[1].builder = { ...game.steps[1].builder, goal: true }
    delete game.steps[2].builder
    const r = replayGame(game, id)
    expect(r?.score).toBe(1)
    expect(r?.turn).toBe(2)
    expect(r?.skipped).toBe(1)
    expect(r?.play.steps).toHaveLength(2)
  })
})
