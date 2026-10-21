import type { Play, PlayerPosition, PlayStep } from '@/lib/types/play'
import { PITCH_W, PITCH_H } from '@/lib/engine/pitch'

// 4-4-2 for the team defending y=0 (bottom of the SVG). Rows are [label, x, y].
const OURS_442: [string, number, number][] = [
  ['GK', 34, 5],
  ['LB', 10, 20], ['LCB', 25, 18], ['RCB', 43, 18], ['RB', 58, 20],
  ['LM', 10, 36], ['LCM', 25, 34], ['RCM', 43, 34], ['RM', 58, 36],
  ['LST', 26, 47], ['RST', 42, 47],
]

/** Builds a play with a 4-4-2 for both teams: ours bottom half, opp mirrored in the top half. */
export function createDefaultPlay(): Play {
  const players: PlayerPosition[] = [
    ...OURS_442.map(([label, x, y]) => ({ id: `o-${label}`, team: 'ours' as const, label, x, y })),
    ...OURS_442.map(([label, x, y]) => ({
      id: `p-${label}`,
      team: 'opp' as const,
      label,
      x: PITCH_W - x,
      y: PITCH_H - y,
    })),
  ]
  const step: PlayStep = {
    id: crypto.randomUUID(),
    index: 0,
    title: 'Step 1',
    duration: 4,
    narrativeOurs: [],
    narrativeOpp: [],
    moves: [],
    passes: [],
    defenderRules: {},
    faceTargets: [],
  }
  const now = new Date().toISOString()
  return {
    id: 'draft',
    title: 'Untitled play',
    authorId: '',
    authorName: '',
    createdAt: now,
    updatedAt: now,
    meta: { formation: '4-4-2', viewSide: 'full', tags: [], isPublic: false },
    players,
    steps: [step],
  }
}
