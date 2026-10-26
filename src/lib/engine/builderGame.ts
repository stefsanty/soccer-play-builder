// The Turn Builder's win condition: score within TURN_LIMIT turns.
//
// This is the simplest rule that gives the risk % a consequence without a turnover: an intercepted
// pass costs a turn, and turns are what run out. A goal in time wins (play may carry on freely
// afterwards); no goal after the last turn is "out of turns" — rewind and replan, or start over.

/** How many turns a game has to score. A coach can change this one number. */
export const TURN_LIMIT = 6

export type GameOutcome = 'playing' | 'won' | 'lost'

/** Outcome after `turnsPlayed` resolved turns with `score` goals. */
export function gameOutcome(turnsPlayed: number, score: number, limit: number = TURN_LIMIT): GameOutcome {
  if (score > 0) return 'won'
  if (turnsPlayed >= limit) return 'lost'
  return 'playing'
}

/** Turns still available before the limit (never negative). */
export function turnsLeft(turnsPlayed: number, limit: number = TURN_LIMIT): number {
  return Math.max(0, limit - turnsPlayed)
}

/** The header counter: "Turn 3/6" while the limit matters, plain "Turn 7" once the game is won. */
export function turnCounterLabel(turn: number, outcome: GameOutcome, limit: number = TURN_LIMIT): string {
  return outcome === 'won' ? `Turn ${turn}` : `Turn ${Math.min(turn, limit)}/${limit}`
}
