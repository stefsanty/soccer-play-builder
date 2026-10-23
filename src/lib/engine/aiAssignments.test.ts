import { describe, expect, it } from 'vitest'
import {
  GRAVITY_R,
  HANDOFF_MAX,
  WORTH,
  canReleaseMark,
  computeAiTargets,
  computeAssignments,
  type AiWorld,
  type AiWorldPlayer,
  type AssignmentConfig,
  type XY,
} from '@/lib/engine/ai'
import { getTimeline, sampleTimeline } from '@/lib/engine/simulator'
import type { Play, PlayStep } from '@/lib/types/play'

/** A player at `xy`, whose formation home is `home` (his own position unless given). */
const P = (id: string, team: 'ours' | 'opp', xy: XY, home: XY = xy): AiWorldPlayer => ({
  id, team, label: id, x: xy[0], y: xy[1], home,
})

/** Defending the goal at y = 105 (the 'opp' half of the pitch frame), ball wherever. */
const defendingTop = (ball: XY, extra: Partial<AssignmentConfig> = {}): AssignmentConfig => ({
  goalDir: 1, ball, ...extra,
})

describe('computeAssignments: phase 1, one responsibility per defender', () => {
  it('gives every dangerous opponent exactly one marker, and no defender two men', () => {
    const defenders = [
      P('d1', 'opp', [20, 80]), P('d2', 'opp', [34, 80]), P('d3', 'opp', [48, 80]),
      P('m1', 'opp', [20, 62]), P('m2', 'opp', [48, 62]),
    ]
    // three attackers inside the block, one far outside it
    const opponents = [
      P('a1', 'ours', [20, 72]), P('a2', 'ours', [34, 72]), P('a3', 'ours', [48, 70]),
      P('far', 'ours', [34, 10]),
    ]
    const got = computeAssignments(defenders, opponents, defendingTop([34, 20]))

    const marked = [...got.entries()].filter(([, a]) => a.type === 'mark')
    expect(marked.map(([, a]) => a.opponent).sort()).toEqual(['a1', 'a2', 'a3'])
    // exactly one marker each, so no two defenders are sent at the same man
    expect(new Set(marked.map(([id]) => id)).size).toBe(3)
    // the far attacker is not the block's business
    expect(marked.some(([, a]) => a.opponent === 'far')).toBe(false)
  })

  it('an opponent further than GRAVITY_R from every defender is nobody\'s job', () => {
    const defenders = [P('d1', 'opp', [34, 80])]
    const near = P('near', 'ours', [34, 80 - (GRAVITY_R - 2)])
    const far = P('far', 'ours', [34, 80 - (GRAVITY_R + 5)])
    const got = computeAssignments(defenders, [far], defendingTop([34, 20]))
    expect(got.get('d1')!.type).not.toBe('mark')

    const got2 = computeAssignments(defenders, [near], defendingTop([34, 20]))
    expect(got2.get('d1')).toMatchObject({ type: 'mark', opponent: 'near' })
  })

  it('the man on the ball is pressed, not marked, and the presser answers for nobody else', () => {
    const defenders = [P('d1', 'opp', [34, 80]), P('d2', 'opp', [40, 80])]
    const opponents = [P('carrier', 'ours', [34, 74]), P('a1', 'ours', [40, 74])]
    const got = computeAssignments(defenders, opponents, defendingTop([34, 74], { carrier: 'carrier', presser: 'd1' }))

    expect(got.get('d1')).toMatchObject({ type: 'press' })
    expect(got.get('d1')!.opponent).toBeUndefined()
    expect([...got.values()].some((a) => a.opponent === 'carrier')).toBe(false)
  })

  it('tier: with distance and displacement equal, the man goes to the line that matches his depth', () => {
    // two defenders the same distance from one attacker, each standing on his own slot, so only the
    // mismatch between their formation line and the attacker's depth can decide it
    const back = P('back', 'opp', [30, 88], [30, 80])
    const fwd = P('fwd', 'opp', [38, 88], [38, 30])
    const slot = new Map<string, XY>([['back', [30, 88]], ['fwd', [38, 88]]])
    // the attacker is close to the defended goal: the deepest line is the one that answers for him
    const deep = P('deep', 'ours', [34, 92])
    const got = computeAssignments([back, fwd], [deep], defendingTop([34, 40], { slot }))
    expect(got.get('back')).toMatchObject({ type: 'mark', opponent: 'deep' })
    expect(got.get('fwd')!.type).not.toBe('mark')
  })

  it('a defender with nothing to answer for holds his zone in the back line, and is free ahead of it', () => {
    const defenders = [P('d1', 'opp', [34, 80]), P('m1', 'opp', [34, 55])]
    const got = computeAssignments(defenders, [], defendingTop([34, 20]))
    expect(got.get('d1')!.type).toBe('zone')
    expect(got.get('m1')!.type).toBe('free')
  })

  it('an opponent an authored rule already answers for is not handed to the AI as well', () => {
    const defenders = [P('d1', 'opp', [34, 80]), P('d2', 'opp', [38, 80])]
    const opponents = [P('a1', 'ours', [34, 72])]
    const duty = new Map<string, string>([['d2', 'a1']])
    const got = computeAssignments(defenders, opponents, defendingTop([34, 20], { duty }))
    expect(got.get('d1')!.type).not.toBe('mark')
  })
})

describe('computeAssignments: the handoff cost on a mark', () => {
  it('is Infinity when there is no other defender who could take the man on', () => {
    const defenders = [P('d1', 'opp', [34, 80])]
    const opponents = [P('a1', 'ours', [34, 72])]
    const got = computeAssignments(defenders, opponents, defendingTop([34, 20]))
    expect(got.get('d1')).toMatchObject({ type: 'mark', opponent: 'a1' })
    expect(got.get('d1')!.handoffCost).toBe(Infinity)
  })

  it('is small when a spare defender is standing right next to the man', () => {
    // the spare belongs to the same line, so what is being measured is his distance, not a tier gap
    const defenders = [P('d1', 'opp', [34, 80]), P('spare', 'opp', [36, 74], [36, 80])]
    const opponents = [P('a1', 'ours', [34, 72])]
    const got = computeAssignments(defenders, opponents, defendingTop([34, 20]))
    const marker = [...got.entries()].find(([, a]) => a.type === 'mark')!
    expect(marker[1].handoffCost).toBeLessThan(HANDOFF_MAX)
    expect(marker[1].handoffCost).toBeGreaterThan(0)
  })

  it('rises as the only other candidate gets further away', () => {
    const near = computeAssignments(
      [P('d1', 'opp', [34, 80]), P('spare', 'opp', [36, 74], [36, 80])],
      [P('a1', 'ours', [34, 72])], defendingTop([34, 20]),
    )
    const far = computeAssignments(
      [P('d1', 'opp', [34, 80]), P('spare', 'opp', [60, 74], [60, 80])],
      [P('a1', 'ours', [34, 72])], defendingTop([34, 20]),
    )
    const cost = (m: Map<string, { type: string; handoffCost: number }>) =>
      [...m.values()].find((a) => a.type === 'mark')!.handoffCost
    expect(cost(far)).toBeGreaterThan(cost(near))
  })
})

describe('canReleaseMark: when a defender may leave the man he was given', () => {
  it('a defender who was given no man is always free to go', () => {
    expect(canReleaseMark({ type: 'free', handoffCost: Infinity }, 0)).toBe(true)
    expect(canReleaseMark({ type: 'zone', handoffCost: Infinity }, 0)).toBe(true)
    expect(canReleaseMark(undefined, 0)).toBe(true)
  })

  it('holds the mark when nobody else can take the man on, however good the reason', () => {
    const bound = { type: 'mark' as const, opponent: 'a1', handoffCost: Infinity }
    expect(canReleaseMark(bound, 1e6)).toBe(false)
  })

  it('holds the mark when a handoff exists but costs more than the reason is worth', () => {
    const a = { type: 'mark' as const, opponent: 'a1', handoffCost: HANDOFF_MAX - 1 }
    expect(canReleaseMark(a, WORTH.cover)).toBe(false)
  })

  it('releases when a handoff is available and the reason outweighs what it costs', () => {
    const a = { type: 'mark' as const, opponent: 'a1', handoffCost: WORTH.cover - 1 }
    expect(canReleaseMark(a, WORTH.cover)).toBe(true)
  })

  it('never releases past the handoff ceiling, even for a reason worth more than the cost', () => {
    const a = { type: 'mark' as const, opponent: 'a1', handoffCost: HANDOFF_MAX + 1 }
    expect(canReleaseMark(a, HANDOFF_MAX + 2)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The reported defect, on the geometry it was reported on: play
// 465325cb-4c97-4f8d-bd34-8fbabb94024a, step 2, the opponent block on its
// mildly-aggressive setting (aggressiveness 50 — one presser breaks, rest hold).
//
// OPP face down the pitch, so their LEFT is screen RIGHT: `oLW` is the right wing
// defender the report is about. He starts on RCM, and RCM is the only man he is
// near. The ball goes to the far flank; being pulled off RCM to cover the press
// leaves RCM with nobody, because no other defender can reach him.
// ---------------------------------------------------------------------------

const FORKED_PLAYERS: [string, 'ours' | 'opp', number, number][] = [
  ['GK', 'ours', 34, 5], ['LB', 'ours', 9.83, 22.77], ['LCB', 'ours', 26, 25],
  ['RCB', 'ours', 46, 25], ['RB', 'ours', 60, 20], ['LCM', 'ours', 22, 45],
  ['CM', 'ours', 34, 48], ['RCM', 'ours', 52, 45], ['LW', 'ours', 12, 65],
  ['CAM', 'ours', 34, 68], ['ST', 'ours', 34, 88],
  ['oGK', 'opp', 34, 100], ['oLB', 'opp', 55.65, 72.89], ['oLCB', 'opp', 42.45, 73.63],
  ['oRCB', 'opp', 24.95, 72.74], ['oRB', 'opp', 9.53, 69.78], ['oCML', 'opp', 41.42, 55.84],
  ['oCMR', 'opp', 27.18, 53.46], ['oCAM', 'opp', 34.89, 40.71], ['oLW', 'opp', 55.8, 54.35],
  ['oRW', 'opp', 11.75, 48.57], ['oST', 'opp', 36.37, 27.36],
]

const blank = (index: number, title: string, duration: number): PlayStep => ({
  id: `s${index}`, index, title, duration,
  narrativeOurs: [], narrativeOpp: [], moves: [], passes: [], defenderRules: {}, faceTargets: [],
})

/** The three steps the report is about: the setup, the recycle that settles the block, then the wide pass. */
const FORKED_STEPS: PlayStep[] = [
  { ...blank(0, 'Setup', 0) },
  {
    ...blank(1, 'Ball recycled at the back: GK to CB to CB', 5),
    passes: [
      { from: 'GK', to: 'LCB', startTime: 0.5, endTime: 1.8 },
      { from: 'LCB', to: 'RCB', startTime: 2.2, endTime: 3.5 },
    ],
    ai: { opp: { on: true, aggressiveness: 71, lineHeight: 50, width: 100, offsideLine: true } },
  },
  {
    ...blank(2, 'Wide pass: RB to LW, who is wide open', 5),
    passes: [
      { from: 'RCB', to: 'RB', startTime: 0.2, endTime: 1.4 },
      { from: 'RB', to: 'LW', startTime: 1.8, endTime: 3.5 },
    ],
    defenderRules: { oRB: [{ type: 'press', att: 'LW', gap: 1, delay: 1.8 }] },
    ai: { opp: { on: true, intensity: 'mid', offsideLine: true } },
  },
]

const FORKED_HOME = new Map(FORKED_PLAYERS.map(([id, , x, y]) => [id, [x, y] as XY]))

const forkedPlay = (): Play => ({
  id: 'forked', title: 'Defensive AI test', authorId: '', authorName: '', createdAt: '', updatedAt: '',
  meta: { formation: 'custom', viewSide: 'full', tags: [], isPublic: false },
  players: FORKED_PLAYERS.map(([id, team, x, y]) => ({ id, team, label: id, x, y })),
  steps: FORKED_STEPS,
})

describe('the right wing defender holds his man while the ball goes to the far flank', () => {
  const frames = () => getTimeline(forkedPlay(), 2).frames

  it('oLW never gets further up the pitch than RCM, the man he is the only one near', () => {
    // OPP defend y = 105, so "up the pitch" is DOWN in y. Going past his own man, towards the ball
    // on the other flank, is the drift the report is about (he used to reach y = 36.6 with RCM on 45).
    let worst = { t: 0, past: -Infinity }
    for (const f of frames()) {
      const past = f.players['RCM'].y - f.players['oLW'].y
      if (past > worst.past) worst = { t: f.t, past }
    }
    expect(worst.past, `oLW got ${worst.past.toFixed(1)} m up the pitch past RCM at t=${worst.t.toFixed(1)}`)
      .toBeLessThan(1)
  })

  it('oLW stays with RCM while the press goes in on the far flank', () => {
    // The window is the press: the ball travels out to RB on the other side and oST closes him down, which
    // is when oLW used to be conscripted as the cover and walked away (RCM was 8.2 m clear by t = 2.5 and
    // 9.3 m by t = 3.3). It ends at 2.5 s because what happens after is the block dropping as a block
    // behind a ball that has gone deep on the far wing, and a man standing on halfway 33 m from it is
    // correctly left — that is a zonal block doing its job, not a mark being released.
    let worst = { t: 0, d: -Infinity }
    for (const f of frames()) {
      if (f.t > 2.5) break
      const d = Math.hypot(f.players['oLW'].x - f.players['RCM'].x, f.players['oLW'].y - f.players['RCM'].y)
      if (d > worst.d) worst = { t: f.t, d }
    }
    expect(worst.d, `oLW was ${worst.d.toFixed(1)} m from RCM at t=${worst.t.toFixed(1)}`).toBeLessThan(6)
  })

  it('and is not handed a ball-seeking job while he is the only one who can reach RCM', () => {
    // t = 1.0 is the frame the report is about: oST is pressing RB out on the far touchline and the cover
    // used to be picked by "whose slot is nearest the ball", which found oLW.
    const f = sampleTimeline(getTimeline(forkedPlay(), 2), 1.0)
    const players: AiWorldPlayer[] = FORKED_PLAYERS.map(([id, team]) => ({
      id, team, label: id, x: f.players[id].x, y: f.players[id].y,
      home: FORKED_HOME.get(id)!, duty: null,
    }))
    const w: AiWorld = {
      players, ball: { x: f.ball.x, y: f.ball.y }, memory: {},
      owner: 'ours', focus: f.ball.target, t: f.t,
    }
    const t = computeAiTargets(w, 'opp', FORKED_STEPS[2], FORKED_STEPS[2].ai!.opp!)
    expect(['presser', 'cover']).not.toContain(t['oLW'].role)
    const rcm = f.players['RCM']
    expect(Math.hypot(t['oLW'].x - rcm.x, t['oLW'].y - rcm.y)).toBeLessThan(6)
  })
})
