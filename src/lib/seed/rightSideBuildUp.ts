// "Right-side build-up: 4-5-1" — the pattern-of-play reference, authored in the reference's compact
// format (OURS / OPP / STEPS) and converted to the app's Play model by `toPlayInsert`.
// Self-contained (type-only imports) so scripts/gen-seed.mjs can run it directly under Node.

import type { DefenderRule, FaceTarget, OptionGroup, PassAnimation, PlayInsert, PlayStep, PlayerMove, PlayerPosition } from '../types/play.ts'

type Pt = [number, number]
type Spot = { x: number; y: number; label: string; ctx?: 1 }

export const OURS: Record<string, Spot> = {
  LCB: { x: 25, y: 29, label: 'LCB', ctx: 1 },
  RCB: { x: 46, y: 29, label: 'RCB' },
  RB: { x: 66, y: 42, label: 'RB' },
  LCM: { x: 24, y: 48, label: 'LCM', ctx: 1 },
  CM: { x: 44, y: 48, label: 'CM' },
  CAM: { x: 35, y: 64, label: 'CAM' },
  RW: { x: 62, y: 66, label: 'RW' },
  ST: { x: 34, y: 76, label: 'ST' },
}

export const OPP: Record<string, Spot> = {
  oST1: { x: 41, y: 53, label: 'oST' },
  oST2: { x: 29, y: 53, label: 'oST', ctx: 1 },
  oRM: { x: 20, y: 60, label: 'oRM', ctx: 1 },
  oCMa: { x: 35, y: 60, label: 'oCM' },
  oCMb: { x: 47, y: 60, label: 'oCM' },
  oLM: { x: 62, y: 60, label: 'oLM' },
  oRB: { x: 21, y: 79, label: 'oRB', ctx: 1 },
  oCB2: { x: 33, y: 79, label: 'oCB' },
  oCB1: { x: 45, y: 79, label: 'oCB' },
  oLB: { x: 57, y: 79, label: 'oLB' },
  oGK: { x: 34, y: 102, label: 'oGK' },
}

// ---- reference step format ----
type RawRule =
  | { type: 'mark'; att: string; gap: number; w: number; zone: Pt; delay: number; dx?: number }
  | { type: 'zone'; zone: Pt; delay: number }
type RawFace = { to: string | Pt; at: number }
type RawOptions = { pairs: [string, string][]; labels?: { t: string; a: 'start' | 'end' }[]; from: number; to: number }
interface RawStep {
  title: string
  D: number
  text?: string[]
  opp?: string[]
  moves: Record<string, [number, number, number, number, number?, Pt?]>
  passes: { from: string; to: string; t0: number; t1: number; lob?: boolean }[]
  rules: Record<string, RawRule | RawRule[]>
  cone?: string
  faces?: Record<string, RawFace | RawFace[]>
  gap?: { a: string; b: string; from: number; label: string }
  options?: RawOptions | RawOptions[]
  hasAlt?: boolean
  diag?: { pass: number; from: number }
  rest?: { ids: string[]; from: number; label: string }
  offside?: { from: number; to: number; label: string }
  alt?: { from: number; after?: number; label: string; btn: string }
}

const mk = (att: string, gap: number, w: number, zone: Pt, delay = 0, dx?: number): RawRule => ({ type: 'mark', att, gap, w, zone, delay, dx })
const zn = (x: number, y: number, delay = 0): RawRule => ({ type: 'zone', zone: [x, y], delay })

export const STEPS: RawStep[] = [
  {
    title: 'Start: the 4-5-1 shape', D: 0,
    text: ['The team is in a 4-5-1 shape.', 'RCB has the ball.', 'RB stands wide and open to the midfield, not the wing.', 'Press Play or Next.'],
    opp: ['The opponent uses a 4-4-2 mid block.', 'The block has two compact lines of four.'],
    moves: {}, passes: [], rules: {},
    cone: 'RB', faces: { RB: { to: 'CM', at: 0 } },
  },
  {
    title: 'RCB passes to RB. CAM moves into the gap', D: 4.4,
    text: ['RCB passes the ball to RB. The trigger pass is always diagonal: forward and wide. It is never a flat, horizontal pass.',
      'RB stays wide. This gives a better passing angle.',
      'RB receives with an open body. RB faces the midfield, not the wing.',
      'The ball stays on the inside foot. RB steps inward as he receives.',
      'At the same time, CAM moves from the center into the gap between the two opponent central midfielders (oCM).',
      'RB now has two pass options: CM and CAM.'],
    opp: ['The wide midfielder (oLM) runs straight at RB to press him.',
      'The striker (oST) stands in the pass lane to CM.',
      'The two oCM stay apart. Neither oCM can take CAM without leaving space.'],
    passes: [{ from: 'RCB', to: 'RB', t0: 0.3, t1: 1.6 }],
    moves: {
      RB: [63.5, 44, 0.9, 2.0], RCB: [47, 31, 0.6, 1.8], CM: [45, 50, 0.4, 1.8],
      LCB: [27, 30, 0.5, 2.0], LCM: [26, 49, 0.5, 2.0], CAM: [46.5, 62, 0.2, 2.4],
    },
    gap: { a: 'oCMa', b: 'oCMb', from: 2.4, label: 'Gap' },
    options: { pairs: [['RB', 'CM'], ['RB', 'CAM']], from: 2.7, to: Infinity },
    hasAlt: true,
    diag: { pass: 0, from: 0 },
    cone: 'RB',
    faces: { RB: { to: 'CM', at: 0 }, CAM: { to: 'RB', at: 1.2 } },
    rules: {
      oLM: [mk('RB', 3, 0.7, [63, 55], 1.0, 0), mk('RB', 3, 0.95, [63, 55], 2.0, 0)],
      oST1: [mk('CM', 4.5, 0.55, [46, 54], 0.8), zn(48, 53, 2.0)],
      oST2: zn(33, 53, 0.8),
      oCMa: zn(40, 60, 0.6),
      oCMb: zn(53, 60, 0.6),
      oRM: zn(25, 60, 0.9),
      oLB: mk('RW', 3.2, 0.55, [58, 79], 0.9),
      oCB1: zn(49, 79, 1.0),
      oCB2: mk('ST', 3.2, 0.8, [35, 79], 0.9),
      oRB: zn(24, 79, 1.0),
    },
  },
  {
    title: 'RW runs upfield into the half space', D: 3.8,
    text: ['RW runs forward and inside, into the right half space.',
      'The run goes far upfield, close to the opponent back line.',
      'This pulls the opponent left back (oLB) inside.',
      'Space opens near the touchline.'],
    opp: ['oLB follows RW for a short time. Then he lets RW go and returns to the line.',
      'The left center back (oCB) takes RW. The back line shifts a little toward the ball side.'],
    moves: { RW: [52, 76, 0.2, 3.0] },
    passes: [], cone: 'RB',
    rules: {
      oLB: [mk('RW', 3.2, 0.85, [58, 79], 0.5), zn(57, 79, 1.5)],
      oCB1: [zn(46, 79, 0.9), mk('RW', 3.2, 0.6, [46.5, 79], 1.6)],
      oRB: zn(25.5, 79, 1.0),
      oRM: zn(26, 60, 1.0),
    },
  },
  {
    title: 'RB passes to CAM. CAM has three options', D: 5.4,
    text: ['RB passes to CAM. RB can also pass to CM.',
      'CAM faces RB as the ball comes. CAM turns on the first touch and faces forward.',
      'CAM now has three choices: pass to ST, pass to RW, or turn back to CM.',
      'CAM chooses RW. CAM passes to RW at once.'],
    opp: ['oCM presses CAM from the side. Then oCM tries to get in front of him.',
      'One oCB stays tight on ST. The other oCB stays with RW.'],
    passes: [{ from: 'RB', to: 'CAM', t0: 0.3, t1: 1.9 }, { from: 'CAM', to: 'RW', t0: 3.6, t1: 4.4 }],
    moves: { CM: [46.5, 50, 0.3, 2.2], ST: [38, 76, 0.4, 2.4] },
    options: [
      { pairs: [['RB', 'CM']], from: 0, to: 1.9 },
      {
        pairs: [['CAM', 'ST'], ['CAM', 'RW'], ['CAM', 'CM']],
        labels: [{ t: 'Pass to ST', a: 'end' }, { t: 'Pass to RW', a: 'start' }, { t: 'Turn back', a: 'start' }],
        from: 2.0, to: 3.6,
      },
    ],
    cone: 'CAM',
    faces: { CAM: [{ to: 'RB', at: 0 }, { to: [46.5, 105], at: 1.6 }] },
    rules: {
      oCMb: [mk('CAM', 0.5, 0.9, [53, 60], 1.2, 3.0), mk('CAM', 3, 0.9, [53, 60], 2.6, 2.2)],
      oCMa: mk('CM', 4.5, 0.6, [44, 56], 0.8),
      oCB2: mk('ST', 3.2, 0.9, [36, 79], 0.5),
      oLM: mk('RB', 4, 0.6, [62, 62], 2.1),
    },
  },
  {
    title: 'RB overlaps to support RW', D: 5.2,
    text: ['RB runs past RW on the outside.', 'RW holds the ball and waits for RB.', 'The defenders must watch both players.'],
    opp: ['oLM tracks RB but falls behind. Then oLM drops back inside.',
      'oLB slides out and takes RB when RB enters his zone.',
      'The oCB stays tight on RW. The other defenders keep their marks.'],
    moves: { RB: [66, 73, 0.3, 4.6, 0.12], RW: [51, 75, 0.5, 2.5] },
    passes: [],
    faces: { RB: { to: [66, 73], at: 0.3 } },
    rules: {
      oLM: [mk('RB', 3, 1, [62, 60], 0.3), zn(59, 66, 3.0)],
      oLB: [zn(57.5, 78.5, 1.6), mk('RB', 3, 1, [62, 79], 3.4)],
      oST1: zn(47, 56, 1.0),
      oCMb: mk('CAM', 3, 0.7, [52, 60], 0, 2.2),
      oCMa: mk('CM', 4.5, 0.6, [44, 56], 0),
      oCB2: mk('ST', 3.2, 0.9, [36, 79], 0),
    },
  },
  {
    title: 'CM tucks into the rest-defense slot', D: 4.0,
    text: ['CM moves into the right back position that RB left.',
      'LCB, RCB and CM make a back three.',
      'The team is safe if it loses the ball.'],
    opp: ['The opponent defenders keep their marks.'],
    moves: { CM: [62, 41, 0.2, 3.2], RCB: [45, 40, 0.4, 2.8], LCB: [27, 40, 0.4, 2.8], LCM: [34, 52, 0.4, 2.8] },
    passes: [],
    faces: { RB: { to: 'RW', at: 0.3 } },
    options: { pairs: [['RW', 'RB'], ['RW', 'CAM']], from: 3.0, to: Infinity },
    rest: { ids: ['LCB', 'RCB', 'CM'], from: 1.8, label: 'Rest defense: back three' },
    rules: { oLM: mk('RB', 4, 0.6, [62, 66], 0.4) },
  },
  {
    title: 'Option: RB passes to CM, CM recycles to RCB, reset', D: 7.0,
    alt: { from: 1, label: '1a', btn: 'pass to CM and reset' },
    text: ['RB passes to CM. RB stays wide, so the lane to CM is clear.',
      'CM receives with an open body. oST presses CM.',
      'CM plays back to RCB.',
      'The team resets to the start shape. The build-up can start again.'],
    opp: ['oST presses CM when CM gets the ball.',
      'After the back pass, the opponent block moves back to its shape.'],
    passes: [{ from: 'RB', to: 'CM', t0: 0.3, t1: 1.7 }, { from: 'CM', to: 'RCB', t0: 2.5, t1: 3.3 }],
    moves: {
      CM: [44, 48, 3.6, 6.4], RCB: [46, 29, 3.6, 6.0], RB: [66, 42, 3.8, 6.0],
      CAM: [35, 64, 3.6, 6.6], LCB: [25, 29, 3.8, 6.2], LCM: [24, 48, 3.8, 6.2],
    },
    options: { pairs: [['CM', 'RCB']], from: 1.8, to: 2.5 },
    cone: 'CM',
    faces: {
      CM: [{ to: 'RB', at: 0.2 }, { to: 'RCB', at: 2.0 }, { to: [44, 100], at: 4.0 }],
      CAM: { to: [35, 100], at: 4.0 },
    },
    rules: {
      oST1: [mk('CM', 3, 0.85, [48, 53], 1.8), mk('RCB', 3, 0.5, [44, 53], 3.5), zn(41, 53, 5.0)],
      oLM: [mk('RB', 3, 0.6, [63, 55], 1.8, 0), zn(62, 59, 3.8)],
      oCMa: zn(35, 59, 3.8),
      oCMb: zn(47, 59, 3.8),
      oST2: zn(29, 53, 4.0),
      oCB1: zn(45, 79, 4.2),
    },
  },
  {
    title: 'Option: RW makes an arced run, CAM lobs a through ball', D: 6.2,
    alt: { from: 2, after: 3, label: '3a', btn: 'RW makes an arced run, CAM lobs a through ball' },
    text: ['Replay of step 3: RB passes to CAM. CAM turns on the first touch.',
      'This time, RW makes an arced run towards the opposition box. RW goes wide of oLB, then curves in.',
      'RW is onside when CAM plays the ball.',
      'CAM lobs a through ball over the back line. RW arrives in the box.'],
    opp: ['oLB and the oCB watch the ball. They start to chase too late.',
      'The goalkeeper (oGK) steps out.'],
    passes: [{ from: 'RB', to: 'CAM', t0: 0.3, t1: 1.9 }, { from: 'CAM', to: 'RW', t0: 2.4, t1: 4.9, lob: true }],
    moves: { CM: [46.5, 50, 0.3, 2.2], ST: [38, 76, 0.4, 2.4], RW: [53, 91, 1.9, 5.1, 0.2, [64, 77]] },
    options: [{ pairs: [['RB', 'CM']], from: 0, to: 1.9 }],
    offside: { from: 1.8, to: 2.9, label: 'Offside line: RW is onside' },
    cone: 'CAM',
    faces: { CAM: [{ to: 'RB', at: 0 }, { to: [46.5, 105], at: 1.6 }] },
    rules: {
      oCMb: [mk('CAM', 0.5, 0.9, [53, 60], 1.2, 3.0), mk('CAM', 3, 0.9, [53, 60], 2.6, 2.2)],
      oCMa: mk('CM', 4.5, 0.6, [44, 56], 0.8),
      oCB2: mk('ST', 3.2, 0.9, [36, 79], 0.5),
      oLM: mk('RB', 4, 0.6, [62, 62], 2.1),
      oLB: [zn(57, 79, 0), mk('RW', -1.5, 1, [57, 79], 3.1, 0)],
      oCB1: [zn(49, 79, 0), mk('RW', -1.5, 1, [49, 79], 3.2, 0)],
      oGK: zn(46, 96, 3.0),
      oRB: zn(27, 79, 2.5),
    },
  },
]

// ---- conversion to the app's Play model ----
const toArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

function convertStep(raw: RawStep, index: number): PlayStep {
  const moves: PlayerMove[] = Object.entries(raw.moves).map(([playerId, [toX, toY, startTime, endTime, easeFraction, via]]) => ({
    playerId, toX, toY, startTime, endTime, ...(easeFraction !== undefined && { easeFraction }), ...(via && { via }),
  }))
  const passes: PassAnimation[] = raw.passes.map((p) => ({
    from: p.from, to: p.to, startTime: p.t0, endTime: p.t1, ...(p.lob && { isLob: true }),
  }))
  const defenderRules: Record<string, DefenderRule[]> = {}
  for (const [id, r] of Object.entries(raw.rules)) {
    defenderRules[id] = toArray(r).map((x): DefenderRule =>
      x.type === 'mark'
        ? { type: 'mark', attacker: x.att, gap: x.gap, weight: x.w, zone: x.zone, delay: x.delay, ...(x.dx !== undefined && { dx: x.dx }) }
        : { type: 'zone', target: x.zone, delay: x.delay })
  }
  const faceTargets: FaceTarget[] = Object.entries(raw.faces ?? {}).flatMap(([playerId, f]) =>
    toArray(f).map((x) => ({ playerId, at: x.at, to: x.to })))
  const options: OptionGroup[] = toArray(raw.options).map((o) => ({
    pairs: o.pairs, ...(o.labels && { labels: o.labels }), from: o.from, to: Number.isFinite(o.to) ? o.to : null,
  }))

  return {
    id: `step-${index}`,
    index,
    title: raw.title,
    duration: raw.D,
    moves,
    passes,
    defenderRules,
    faceTargets,
    ...(raw.cone && { showConeFor: raw.cone }),
    ...(raw.gap && { gapAnnotation: { playerA: raw.gap.a, playerB: raw.gap.b, showFrom: raw.gap.from, label: raw.gap.label } }),
    ...(raw.rest && { restAnnotation: { playerIds: raw.rest.ids, showFrom: raw.rest.from, label: raw.rest.label } }),
    ...(raw.offside && { offsideAnnotation: { showFrom: raw.offside.from, showTo: raw.offside.to, label: raw.offside.label } }),
    ...(options.length > 0 && { options }),
    ...(raw.diag && { diagPass: raw.diag }),
    ...(raw.hasAlt && { hasAlt: true }),
    ...(raw.alt && {
      isAltBranch: true,
      altFrom: raw.alt.from,
      ...(raw.alt.after !== undefined && { altAfter: raw.alt.after }),
      altLabel: raw.alt.label,
      altButtonText: raw.alt.btn,
    }),
  }
}

export function toPlayInsert(): PlayInsert {
  const players: PlayerPosition[] = [
    ...Object.entries(OURS).map(([id, p]) => ({ id, team: 'ours' as const, label: p.label, x: p.x, y: p.y, ...(p.ctx && { isContext: true }) })),
    ...Object.entries(OPP).map(([id, p]) => ({ id, team: 'opp' as const, label: p.label, x: p.x, y: p.y, ...(p.ctx && { isContext: true }) })),
  ]
  return {
    title: 'Right-side build-up: 4-5-1',
    description: 'The team attacks up the screen. You see the right half of the pitch.',
    authorId: '',
    authorName: 'Stefan',
    meta: { formation: 'custom', viewSide: 'right', tags: [], isPublic: true },
    players,
    steps: STEPS.map(convertStep),
  }
}
