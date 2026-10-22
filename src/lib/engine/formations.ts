// Standard formation presets.
// Coordinates are for a team defending y=0 (bottom of pitch) and attacking toward y=105.
// OPP (defending y=105) gets x mirrored (68-x) and y mirrored (105-y).

import type { PlayerPosition } from '@/lib/types/play'

export type FormationKey = '4-4-2' | '4-3-3' | '4-5-1' | '4-2-3-1' | '3-4-3' | '3-5-2' | '5-3-2' | '5-4-1'

export const FORMATION_KEYS: FormationKey[] = [
  '4-4-2', '4-3-3', '4-5-1', '4-2-3-1', '3-4-3', '3-5-2', '5-3-2', '5-4-1',
]

// [x, y] positions sorted GK → defenders → midfielders → forwards
const PRESETS: Record<FormationKey, [number, number][]> = {
  '4-4-2': [
    [34, 5],
    [10, 20], [24, 24], [44, 24], [58, 20],
    [8, 50],  [24, 48], [44, 48], [60, 50],
    [24, 72], [44, 72],
  ],
  '4-3-3': [
    [34, 5],
    [10, 20], [24, 24], [44, 24], [58, 20],
    [18, 50], [34, 48], [50, 50],
    [12, 72], [34, 78], [56, 72],
  ],
  '4-5-1': [
    [34, 5],
    [10, 20], [24, 24], [44, 24], [58, 20],
    [8, 50], [22, 48], [34, 52], [46, 48], [60, 50],
    [34, 72],
  ],
  '4-2-3-1': [
    [34, 5],
    [10, 20], [24, 24], [44, 24], [58, 20],
    [24, 42], [44, 42],
    [14, 60], [34, 62], [54, 60],
    [34, 78],
  ],
  '3-4-3': [
    [34, 5],
    [18, 22], [34, 24], [50, 22],
    [8, 50], [24, 48], [44, 48], [60, 50],
    [12, 72], [34, 78], [56, 72],
  ],
  '3-5-2': [
    [34, 5],
    [18, 22], [34, 24], [50, 22],
    [8, 50], [22, 48], [34, 50], [46, 48], [60, 50],
    [24, 72], [44, 72],
  ],
  '5-3-2': [
    [34, 5],
    [8, 24], [20, 26], [34, 28], [48, 26], [60, 24],
    [20, 52], [34, 50], [48, 52],
    [24, 72], [44, 72],
  ],
  '5-4-1': [
    [34, 5],
    [8, 24], [20, 26], [34, 28], [48, 26], [60, 24],
    [8, 50], [24, 48], [44, 48], [60, 50],
    [34, 72],
  ],
}

/**
 * Applies a formation to a list of players, repositioning them in formation order.
 * Players are sorted by depth (most defensive first) so drag-order stays intuitive.
 * OPP players (team === 'opp') get mirrored coordinates.
 */
export function applyFormation(
  players: PlayerPosition[],
  team: 'ours' | 'opp',
  formation: FormationKey,
): PlayerPosition[] {
  const coords = PRESETS[formation]
  const teamPlayers = [...players.filter((p) => p.team === team)]
  if (teamPlayers.length === 0) return players

  // Sort: "ours" ascending y (GK first), "opp" descending y (their GK first)
  teamPlayers.sort((a, b) => team === 'ours' ? a.y - b.y : b.y - a.y)

  const updated = new Map<string, { x: number; y: number }>()
  teamPlayers.forEach((p, i) => {
    const slot = coords[Math.min(i, coords.length - 1)]
    let [x, y] = slot
    if (team === 'opp') { x = 68 - x; y = 105 - y }
    updated.set(p.id, { x, y })
  })

  return players.map((p) => {
    const pos = updated.get(p.id)
    return pos ? { ...p, ...pos } : p
  })
}
