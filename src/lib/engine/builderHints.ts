// Small pure helpers behind the turn builder's pitch: the order players are drawn in so the ones you
// need to tap are on top. (The suggestion picker that lived here went with the ✓/× chips in v0.42.0 —
// the attacking AI, engine/teamShape.ts, makes those runs itself now.)

/** Defenders first (underneath), then our team, with the ball holder drawn last so he is never covered. */
export function drawOrder<T extends { id: string; team: 'ours' | 'opp' }>(players: T[], holder: string | null): T[] {
  const rank = (p: T) => (p.id === holder ? 2 : p.team === 'ours' ? 1 : 0)
  return [...players].sort((a, b) => rank(a) - rank(b))
}
