import { describe, expect, it } from 'vitest'
import { TURN_LIMIT, gameOutcome, turnCounterLabel, turnsLeft } from '@/lib/engine/builderGame'

describe('gameOutcome: score within the turn limit', () => {
  it('is playing while turns remain and nothing is scored', () => {
    expect(gameOutcome(0, 0)).toBe('playing')
    expect(gameOutcome(TURN_LIMIT - 1, 0)).toBe('playing')
  })
  it('is won the moment a goal is scored, however early', () => {
    expect(gameOutcome(1, 1)).toBe('won')
    expect(gameOutcome(TURN_LIMIT, 1)).toBe('won')
  })
  it('is lost once the last turn has resolved without a goal', () => {
    expect(gameOutcome(TURN_LIMIT, 0)).toBe('lost')
    expect(gameOutcome(TURN_LIMIT + 2, 0)).toBe('lost')
  })
  it('a goal after the limit still counts as won (play on after a replan)', () => {
    expect(gameOutcome(TURN_LIMIT + 1, 1)).toBe('won')
  })
})

describe('turnsLeft', () => {
  it('counts down and never goes negative', () => {
    expect(turnsLeft(0)).toBe(TURN_LIMIT)
    expect(turnsLeft(TURN_LIMIT - 1)).toBe(1)
    expect(turnsLeft(TURN_LIMIT + 3)).toBe(0)
  })
})

describe('turnCounterLabel', () => {
  it('shows the limit while it matters and drops it once won', () => {
    expect(turnCounterLabel(1, 'playing')).toBe(`Turn 1/${TURN_LIMIT}`)
    expect(turnCounterLabel(TURN_LIMIT, 'playing')).toBe(`Turn ${TURN_LIMIT}/${TURN_LIMIT}`)
    expect(turnCounterLabel(TURN_LIMIT + 1, 'lost')).toBe(`Turn ${TURN_LIMIT}/${TURN_LIMIT}`)
    expect(turnCounterLabel(7, 'won')).toBe('Turn 7')
  })
})
