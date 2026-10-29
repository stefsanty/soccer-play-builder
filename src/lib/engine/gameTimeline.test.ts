import { describe, expect, it } from 'vitest'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { replayGame } from '@/lib/engine/builderReplay'
import { actionsDoneBy, atTurnEnd, buildMarkers, nearestMarker } from '@/lib/engine/gameTimeline'
import { sampleTimeline } from '@/lib/engine/simulator'
import { scheduleTurn, turnStep, type BuilderAction } from '@/lib/engine/turnBuilder'
import type { Play } from '@/lib/types/play'

type Pt = [number, number]
const id = (s: string) => s

/** Two turns saved the way BuilderClient saves them: pass + run, then a dribble. */
function savedGame(): Play {
  const play = createDefaultPlay()
  const positions = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
  const t1: BuilderAction[] = [
    { kind: 'pass', playerId: 'o-RCM', to: 'o-RST' },
    { kind: 'run', playerId: 'o-LM', toX: 10, toY: 44 },
  ]
  const step1 = { ...turnStep(t1, positions, 1), builder: { actions: t1, outcomes: {}, startHolder: 'o-RCM', endHolder: 'o-RST', goal: false } }
  const t2: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RST', toX: 40, toY: 62 }]
  const step2 = { ...turnStep(t2, positions, 2), builder: { actions: t2, outcomes: {}, startHolder: 'o-RST', endHolder: 'o-RST', goal: false } }
  return { ...play, steps: [{ ...play.steps[0], builder: { kickoffHolder: 'o-RCM' } }, step1, step2] }
}

describe('game timeline', () => {
  const game = replayGame(savedGame(), id)!

  it('a reopened game keeps every turn with its simulation and the state after it', () => {
    expect(game.turns).toHaveLength(2)
    expect(game.turns[0].actions).toHaveLength(2)
    expect(game.turns[1].after.holder).toBe('o-RST')
    // the end of turn 1 is where turn 2 starts
    const end1 = sampleTimeline(game.turns[0].tl, game.turns[0].tl.duration).players['o-LM']
    expect(game.turns[1].tl.start['o-LM'].x).toBeCloseTo(end1.x, 5)
  })

  it('markers: kick-off, each action end per turn (the last at the turn end), then the draft', () => {
    const m = buildMarkers(game.turns, null, id)
    expect(m.map((x) => x.turn)).toEqual([1, 1, 1, 2])
    expect(m[0]).toMatchObject({ t: 0, label: 'Kick-off' })
    expect(m[2].t).toBe(game.turns[0].tl.duration)
    expect(m[3].t).toBe(game.turns[1].tl.duration)
    const draft = scheduleTurn([{ kind: 'run', playerId: 'o-LB', toX: 5, toY: 40 }], {})
    expect(buildMarkers(game.turns, { plans: draft.plans, duration: 2 }, id)).toHaveLength(4) // no positions → no plans
  })

  it('snaps a point to the closest step; a turn start counts as the previous turn end', () => {
    const m = buildMarkers(game.turns, null, id)
    expect(nearestMarker(m, { turn: 1, t: 0.01 })).toBe(0)
    expect(nearestMarker(m, { turn: 2, t: 0.05 })).toBe(2)
    expect(nearestMarker(m, { turn: 2, t: game.turns[1].tl.duration - 0.1 })).toBe(3)
  })

  it('branching mid-turn keeps only the actions that had ended', () => {
    const t1 = game.turns[0]
    const first = [...t1.plans].sort((a, b) => a.end - b.end)[0]
    const kept = actionsDoneBy(t1.actions, t1.plans, first.end)
    expect(kept).toEqual([first.action])
    expect(atTurnEnd(game.turns, { turn: 1, t: first.end })).toBe(first.end >= t1.tl.duration - 0.02)
    expect(atTurnEnd(game.turns, { turn: 1, t: t1.tl.duration })).toBe(true)
  })
})
