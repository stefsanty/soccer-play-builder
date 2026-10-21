// "Defensive AI test: 4 scenarios" — exercises engine/ai.ts. In every step the opponent block is driven by
// the AI (mid intensity, offside line on); steps 2 and 3 add one authored press on top.
// Self-contained (type-only imports plus the rule constructors) so scripts/gen-seed.mjs can run it under Node.

import type { PlayInsert, PlayStep, PlayerPosition } from '../types/play.ts'
import { fl, pr } from '../engine/rules.ts'

const ours: [string, number, number][] = [
  ['GK', 34, 5], ['LB', 14, 20], ['LCB', 26, 25], ['RCB', 46, 25], ['RB', 60, 20],
  ['LCM', 22, 45], ['CM', 34, 48], ['RCM', 52, 45], ['LW', 12, 65], ['CAM', 34, 68], ['ST', 34, 80],
]
const opp: [string, number, number][] = [
  ['oGK', 34, 100], ['oLB', 14, 78], ['oLCB', 28, 82], ['oRCB', 48, 82], ['oRB', 60, 78],
  ['oCML', 22, 62], ['oCMR', 52, 62], ['oCAM', 34, 62], ['oLW', 14, 72], ['oRW', 60, 72], ['oST', 34, 72],
]

type Pass = [from: string, to: string, t0: number, t1: number]

function step(
  index: number,
  title: string,
  duration: number,
  text: string[],
  passes: Pass[],
  extra: Partial<PlayStep> = {},
): PlayStep {
  return {
    id: `ai-step-${index}`,
    index,
    title,
    duration,
    narrativeOurs: text,
    narrativeOpp: [],
    moves: [],
    passes: passes.map(([from, to, startTime, endTime]) => ({ from, to, startTime, endTime })),
    defenderRules: {},
    faceTargets: [],
    ai: { opp: { on: true, intensity: 'mid', offsideLine: true } },
    ...extra,
  }
}

export function toPlayInsert(): PlayInsert {
  const players: PlayerPosition[] = [
    ...ours.map(([label, x, y]) => ({ id: label, team: 'ours' as const, label, x, y })),
    ...opp.map(([label, x, y]) => ({ id: label, team: 'opp' as const, label, x, y })),
  ]
  return {
    title: 'Defensive AI test: 4 scenarios',
    description: 'Four build-up scenarios against a defensive-AI opponent block (mid intensity, offside line on).',
    authorId: '',
    authorName: 'Stefan',
    meta: { formation: 'custom', viewSide: 'full', tags: ['defensive-ai'], isPublic: true },
    players,
    steps: [
      step(0, 'Ball recycled at the back: GK to CB to CB', 5, [
        'OPP has Defense AI on mid intensity.',
        'Ball is recycled between GK and CBs.',
        'Watch how the OPP block stays compact and adjusts to ball side.',
      ], [['GK', 'LCB', 0.5, 1.8], ['LCB', 'RCB', 2.2, 3.5]]),

      step(1, 'Wide pass: RB to LW, who is wide open', 5, [
        'RB finds LW making a wide run.',
        'The nearest OPP defender (oLCB) presses while the block shifts.',
      ], [['RCB', 'RB', 0.2, 1.4], ['RB', 'LW', 1.8, 3.5]], { defenderRules: { oLCB: [pr('LW', 1.8)] } }),

      step(2, 'Ball to CAM in front of the box', 6, [
        'CM plays to CAM who is in a dangerous central position.',
        'The ball is deep in the OPP half: the block drops and the nearest defenders close CAM down.',
        'Watch the OPP block collapse and pack the central area.',
      ], [['RCB', 'CM', 0.3, 1.6], ['CM', 'CAM', 2.2, 3.4]], {
        moves: [{ playerId: 'CAM', toX: 34, toY: 72, startTime: 0, endTime: 1.2 }],
        defenderRules: { oCMR: [pr('CAM', 2.4, 0.5)] },
      }),

      step(3, 'Full build-up through all thirds', 7, [
        'Watch the OPP block progressively drop deeper as the ball advances.',
        'Each line drops behind the ball as it moves forward.',
        'Near the box, two OPP defenders press ST.',
      ], [['GK', 'LCB', 0.3, 1.4], ['LCB', 'CM', 2.0, 3.2], ['CM', 'CAM', 3.8, 4.9], ['CAM', 'ST', 5.5, 6.5]]),

      // OPP have the ball and recycle it at the back while OURS rearrange: ST drops, LW runs into his place, CM covers.
      step(4, 'Ball at the back: ST drops, LW runs into the striker zone', 8, [
        'ST drops to midfield to create space. LW makes a diagonal run into the striker zone.',
        'oCAM follows ST into midfield (follow rule with zone boundary).',
        'Watch: does the OPP defensive shape adapt? Does a new player pick up LW in the striker zone?',
        'When ball is recycled at back, do the OPP lines stay high enough or do they drop unnecessarily?',
      ], [['oRCB', 'oGK', 0.5, 1.6], ['oGK', 'oLCB', 2.2, 3.2]], {
        moves: [
          { playerId: 'ST', toX: 34, toY: 55, startTime: 0.3, endTime: 3.3 },
          { playerId: 'LW', toX: 28, toY: 78, startTime: 0.5, endTime: 3.5 },
          { playerId: 'CM', toX: 34, toY: 38, startTime: 0.8, endTime: 3.8 },
        ],
        defenderRules: { oCAM: [fl('ST', [34, 62], { kind: 'rect', x0: 18, y0: 48, x1: 50, y1: 75 }, 0.3)] },
      }),
    ],
  }
}
