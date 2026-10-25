// Small pure helpers behind the turn builder's pitch: which attacking-AI suggestions to show, and
// the order players are drawn in so the ones you need to tap are on top.

import type { AISuggestedMove } from '@/lib/engine/attackingAI'

type Pt = [number, number]

/** The playtest showed ten dashed arrows at once; two near the ball is what a thumb can use. */
export const MAX_SUGGESTIONS = 2
/** Suggested runs shorter than this are noise (the keeper's 3 m shuffle). */
export const MIN_SUGGESTION_M = 4

export interface PickOptions {
  ball: Pt
  positions: Record<string, Pt>
  isKeeper: (id: string) => boolean
}

/**
 * Keep the few suggestions worth showing: never the keeper, never a micro-run; a support run (the
 * passer following his pass) first, then the players nearest the ball; at most MAX_SUGGESTIONS.
 */
export function pickSuggestions(all: AISuggestedMove[], { ball, positions, isKeeper }: PickOptions): AISuggestedMove[] {
  const distToBall = (s: AISuggestedMove) => {
    const p = positions[s.playerId]
    return p ? Math.hypot(p[0] - ball[0], p[1] - ball[1]) : Infinity
  }
  const runLength = (s: AISuggestedMove) => {
    const p = positions[s.playerId]
    return p ? Math.hypot(s.toX - p[0], s.toY - p[1]) : 0
  }
  return all
    .filter((s) => !isKeeper(s.playerId) && runLength(s) >= MIN_SUGGESTION_M)
    .sort((a, b) => {
      const sa = a.reason === 'support' ? 0 : 1
      const sb = b.reason === 'support' ? 0 : 1
      return sa - sb || distToBall(a) - distToBall(b)
    })
    .slice(0, MAX_SUGGESTIONS)
}

/** Defenders first (underneath), then our team, with the ball holder drawn last so he is never covered. */
export function drawOrder<T extends { id: string; team: 'ours' | 'opp' }>(players: T[], holder: string | null): T[] {
  const rank = (p: T) => (p.id === holder ? 2 : p.team === 'ours' ? 1 : 0)
  return [...players].sort((a, b) => rank(a) - rank(b))
}
