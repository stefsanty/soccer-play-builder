// Saving the turn builder's game: when there is unsaved work, and what to call the play.

/** Unsaved work = resolved turns beyond what the last save stored, or actions still queued. */
export function hasUnsavedWork({ stepCount, queued, savedStepCount }: { stepCount: number; queued: number; savedStepCount: number }): boolean {
  const resolvedTurns = Math.max(0, stepCount - 1)
  const savedTurns = Math.max(0, savedStepCount - 1)
  return queued > 0 || resolvedTurns > savedTurns
}

/** Default title for a saved game, e.g. "Turn Builder — 26 Oct 2026, 14:05". */
export function builderTitle(now: Date): string {
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `Turn Builder — ${date}, ${time}`
}
