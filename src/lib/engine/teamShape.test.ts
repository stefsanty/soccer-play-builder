// Attacking AI — off-ball teammates move with the user's single command (docs/attacking-ai-spec.md §5).

import { describe, expect, it } from 'vitest'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { initialState, simulateStep } from '@/lib/engine/simulator'
import { replayGame } from '@/lib/engine/builderReplay'
import { MOVE_MPS, scheduleTurn, turnStep, type BuilderAction } from '@/lib/engine/turnBuilder'
import {
  DEF_MAX_DEPTH,
  MAX_SHAPE_M,
  MAX_RUN_M,
  SPACING_M,
  CLEAR_M,
  REST_BEHIND,
  REST_COUNT,
  formationLines,
  planTeamShape,
  supportMovesToPlayerMoves,
  turnDuration,
  type ShapeInput,
  type SupportMove,
} from '@/lib/engine/teamShape'
import type { Play } from '@/lib/types/play'

type Pt = [number, number]
const id = (s: string) => s

const play = createDefaultPlay()
const homes = Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
const players = play.players.map((p) => ({ id: p.id, team: p.team, label: p.label }))

/** Build the solver's input from a queue on the given positions (default: the kick-off shape). */
function input(queue: BuilderAction[], holder: string | null = 'o-RCM', overrides: Record<string, Pt> = {}, homeOverrides: Record<string, Pt> = {}): ShapeInput {
  const positions: Record<string, Pt> = { ...homes, ...overrides }
  return { players, positions, homes: { ...homes, ...homeOverrides }, attackingTeam: 'ours', holder, queue, schedule: scheduleTurn(queue, positions) }
}
const plan = (queue: BuilderAction[], holder: string | null = 'o-RCM', overrides: Record<string, Pt> = {}) => planTeamShape(input(queue, holder, overrides))
const byId = (moves: SupportMove[], pid: string) => moves.find((m) => m.playerId === pid)
const len = (m: SupportMove) => Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1])
const ours = play.players.filter((p) => p.team === 'ours' && p.label !== 'GK').map((p) => p.id)
/** Everyone's final position: the AI target when moved, the schedule's planned spot otherwise. */
function finals(inp: ShapeInput, moves: SupportMove[]): Record<string, Pt> {
  const out: Record<string, Pt> = { ...inp.schedule.planned }
  for (const m of moves) out[m.playerId] = m.to
  return out
}

describe('formationLines', () => {
  it('U1 — splits the 4-4-2 into defence / midfield / forwards, keeper excluded, full-backs and wingers wide', () => {
    const lines = formationLines(players, homes, 'ours')
    expect(lines.role('o-GK')).toBe('gk')
    expect(['o-LB', 'o-LCB', 'o-RCB', 'o-RB'].map(lines.role)).toEqual(['def', 'def', 'def', 'def'])
    expect(['o-LM', 'o-LCM', 'o-RCM', 'o-RM'].map(lines.role)).toEqual(['mid', 'mid', 'mid', 'mid'])
    expect(['o-LST', 'o-RST'].map(lines.role)).toEqual(['fwd', 'fwd'])
    expect(['o-LB', 'o-RB', 'o-LM', 'o-RM'].map(lines.wide)).toEqual([true, true, true, true])
    expect(['o-LCB', 'o-LCM', 'o-LST'].map(lines.wide)).toEqual([false, false, false])
    expect(lines.side('o-LB')).toBe(-1)
    expect(lines.side('o-RM')).toBe(1)
  })
})

describe('shape rules', () => {
  // RCM dribbles straight up 15 m: the ball ends at (43, 49), 14 m above the midfield home line (35).
  const up: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 49 }]

  it('U2 — the block lifts with the ball: forwards 1:1, the defence at 60%', () => {
    const moves = plan(up)
    // LST is on shape (RST takes the depth run): home (26, 47) → lift 14 → 61, cut to the 12 m cap
    const lst = byId(moves, 'o-LST')!
    expect(lst.reason).toBe('shape')
    expect(lst.to[1]).toBeGreaterThan(47 + 11)
    // the far-side full-back: home (10, 20) → 20 + 14 × 0.6 = 28.4
    const lb = byId(moves, 'o-LB')!
    expect(lb.to[1]).toBeCloseTo(28.4, 1)
  })

  it('U3 — the block slides toward the ball side; the far-side wide player keeps his width', () => {
    const moves = plan(up)
    // LCB: home x 25 → 25 + 9 × 0.35 = 28.15
    expect(byId(moves, 'o-LCB')!.to[0]).toBeCloseTo(28.15, 1)
    // LB is wide on the far side: no shift
    expect(byId(moves, 'o-LB')!.to[0]).toBeCloseTo(10, 5)
  })

  it('U4 — the defence never goes further than 5 m past halfway', () => {
    const high: Record<string, Pt> = { 'o-RCM': [34, 80], 'o-LST': [26, 88], 'o-RST': [42, 88], 'o-LCB': [25, 50], 'o-RCB': [43, 50], 'o-LB': [10, 52], 'o-RB': [58, 52] }
    const moves = plan([{ kind: 'dribble', playerId: 'o-RCM', toX: 34, toY: 90 }], 'o-RCM', high)
    for (const pid of ['o-LB', 'o-LCB', 'o-RCB', 'o-RB']) {
      const m = byId(moves, pid)
      if (m) expect(m.to[1]).toBeLessThanOrEqual(DEF_MAX_DEPTH + 1e-9)
    }
  })

  it('U5 — nobody runs beyond the offside line (the second-last opponent, whoever he is)', () => {
    // the opponents' back line drops to 66; their midfield (69–71) is now the last line but one
    const low: Record<string, Pt> = { 'p-LB': [58, 66], 'p-LCB': [43, 66], 'p-RCB': [25, 66], 'p-RB': [10, 66] }
    const inp = input([{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 60 }], 'o-RCM', { ...low, 'o-RCM': [43, 45], 'o-LST': [26, 62], 'o-RST': [42, 62] })
    const oppYs = players.filter((p) => p.team === 'opp').map((p) => inp.positions[p.id][1]).sort((a, b) => b - a)
    expect(oppYs[1]).toBe(71)
    const moves = planTeamShape(inp)
    expect(moves.some((m) => m.reason === 'depth')).toBe(true)
    for (const m of moves) expect(m.to[1]).toBeLessThanOrEqual(oppYs[1] - 1 + 1e-9)
  })

  it('U6 — a long shape move is cut to the cap along its own direction', () => {
    // LB starts far from his slot: home (10, 20) but standing at (10, 2)
    const moves = plan(up, 'o-RCM', { 'o-LB': [10, 2] })
    const lb = byId(moves, 'o-LB')!
    expect(len(lb)).toBeCloseTo(MAX_SHAPE_M, 5)
    expect(lb.to[0]).toBeCloseTo(10, 5)
    expect(lb.to[1]).toBeCloseTo(14, 5)
  })

  it('U7 — moves under the deadband are dropped', () => {
    // a 2 m nudge: the ball moves sideways only, the block shift is 0.7 m
    const moves = plan([{ kind: 'dribble', playerId: 'o-RCM', toX: 45, toY: 34 }])
    expect(moves.every((m) => len(m) >= 2.5)).toBe(true)
    // the far-side defenders have nothing to do
    expect(byId(moves, 'o-LB')).toBeUndefined()
  })

  it('U8 — two free players aimed at the same slot end apart', () => {
    // LCM and RCM are central mids with homes and positions 1 m apart; LM dribbles, so neither is commanded
    const clash: Record<string, Pt> = { 'o-LCM': [30, 34], 'o-RCM': [31, 34] }
    const inp = input([{ kind: 'dribble', playerId: 'o-LM', toX: 10, toY: 48 }], 'o-LM', clash, clash)
    const moves = planTeamShape(inp)
    const f = finals(inp, moves)
    expect(Math.hypot(f['o-LCM'][0] - f['o-RCM'][0], f['o-LCM'][1] - f['o-RCM'][1])).toBeGreaterThanOrEqual(SPACING_M - 0.5)
  })

  it('U9 — a target on top of a defender moves clear of him', () => {
    // an opponent stands exactly on LCM's support slot (34, 44)
    const moves = plan(up, 'o-RCM', { 'p-RCM': [34, 44] })
    const lcm = byId(moves, 'o-LCM')!
    expect(Math.hypot(lcm.to[0] - 34, lcm.to[1] - 44)).toBeGreaterThanOrEqual(CLEAR_M - 1e-6)
  })

  it('U10 — the keeper, commanded players and pass receivers are never moved (a passer only after his pass)', () => {
    const q: BuilderAction[] = [
      { kind: 'pass', playerId: 'o-RCM', to: 'o-RST' },
      { kind: 'run', playerId: 'o-LM', toX: 6, toY: 50 },
    ]
    const moves = plan(q)
    const ids = moves.filter((m) => m.reason !== 'pass-move').map((m) => m.playerId)
    expect(ids).not.toContain('o-GK')
    expect(ids).not.toContain('o-RCM')
    expect(ids).not.toContain('o-RST')
    expect(ids).not.toContain('o-LM')
    expect(ids.every((i) => i.startsWith('o-'))).toBe(true)
    // the keeper never makes a pass-and-move run either
    const gkPass = plan([{ kind: 'pass', playerId: 'o-GK', to: 'o-LCB' }], 'o-GK')
    expect(byId(gkPass, 'o-GK')).toBeUndefined()
  })

  it('U14 — pass and move: the passer offers himself again once the ball has left him', () => {
    // a pass that ends the turn leaves no time to move: everybody stops when the ball lands
    expect(byId(plan([{ kind: 'pass', playerId: 'o-RCM', to: 'o-RST' }]), 'o-RCM')).toBeUndefined()
    // LM's run keeps the turn going after the pass, so the passer follows it
    const q: BuilderAction[] = [{ kind: 'pass', playerId: 'o-RCM', to: 'o-RST' }, { kind: 'run', playerId: 'o-LM', toX: 6, toY: 50 }]
    const inp = input(q)
    const moves = planTeamShape(inp)
    const rcm = byId(moves, 'o-RCM')!
    expect(rcm.reason).toBe('pass-move')
    const passEnd = inp.schedule.plans[0].end
    expect(rcm.start).toBeCloseTo(passEnd, 6)
    expect(rcm.end).toBeLessThanOrEqual(turnDuration(inp.schedule) + 1e-9)
    // heads for the slot beside-and-behind RST (42, 47) on the side he passed from (the right)
    expect(rcm.to[0]).toBeGreaterThan(43)
    expect(rcm.to[1]).toBeGreaterThan(34)
    expect(rcm.to[1]).toBeLessThan(47)
    // a passer who dribbles on after his pass is commanded — no follow-up for him
    const chained: BuilderAction[] = [
      { kind: 'pass', playerId: 'o-RCM', to: 'o-RST' },
      { kind: 'pass', playerId: 'o-RST', to: 'o-RCM' },
      { kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 50 },
    ]
    const back = plan(chained)
    expect(byId(back, 'o-RCM')).toBeUndefined()
    // RST's pass is his last action: he follows it
    expect(byId(back, 'o-RST')?.reason).toBe('pass-move')
  })

  it('U11 — rest defence: three outfielders stay 10 m behind a ball in the opponent half', () => {
    const highBlock: Record<string, Pt> = { 'o-RCM': [43, 60], 'o-LST': [26, 68], 'o-RST': [42, 68], 'o-LCM': [25, 58], 'o-LM': [10, 60], 'o-RM': [58, 60], 'o-LB': [10, 65], 'o-LCB': [25, 65], 'o-RCB': [43, 65], 'o-RB': [58, 65] }
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 70 }]
    const inp = input(q, 'o-RCM', highBlock)
    const f = finals(inp, planTeamShape(inp))
    const behind = ours.filter((pid) => f[pid][1] <= 70 - REST_BEHIND + 1e-9)
    expect(behind.length).toBeGreaterThanOrEqual(REST_COUNT)
    expect(planTeamShape(inp).filter((m) => m.reason === 'rest').length).toBeGreaterThanOrEqual(REST_COUNT)
  })

  it('U12 — deterministic: the same input gives the same moves and ignores Math.random', () => {
    const a = plan(up)
    const orig = Math.random
    Math.random = () => 0.999
    const b = plan(up)
    Math.random = orig
    expect(b).toEqual(a)
  })

  it('U13 — every move starts at 0 and ends inside the turn; a 12 m move takes 2 s', () => {
    const inp = input(up)
    const moves = planTeamShape(inp)
    const dur = turnDuration(inp.schedule)
    // the turn ends when the last commanded action ends: no settle tail
    expect(dur).toBeCloseTo(inp.schedule.length, 6)
    for (const m of moves) {
      expect(m.start).toBe(0)
      expect(m.end).toBeLessThanOrEqual(dur + 1e-9)
      expect(m.end).toBeCloseTo(Math.min(dur, Math.max(0.5, len(m) / MOVE_MPS)), 6)
    }
    const capped = moves.find((m) => Math.abs(len(m) - MAX_SHAPE_M) < 1e-6)!
    expect(capped.end).toBeCloseTo(2, 6)
  })
})

describe('single-command scenarios (4-4-2, ball with RCM at (43, 34))', () => {
  it('S1 — dribble forward: the block moves up, a forward runs beyond, support angles and a wide outlet form', () => {
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 49 }]
    const inp = input(q)
    const moves = planTeamShape(inp)
    const f = finals(inp, moves)
    const ids = moves.map((m) => m.playerId)
    expect(ids).not.toContain('o-GK')
    expect(ids).not.toContain('o-RCM')
    // nobody drops
    for (const m of moves) expect(m.to[1]).toBeGreaterThanOrEqual(m.from[1] - 0.1)
    // the nearest forward runs beyond the ball
    const rst = byId(moves, 'o-RST')!
    expect(rst.reason).toBe('depth')
    expect(rst.to[1]).toBeGreaterThanOrEqual(49 + 10)
    // a central midfielder offers an angle underneath, on the left
    const lcm = byId(moves, 'o-LCM')!
    expect(lcm.reason).toBe('support')
    expect(lcm.to[0]).toBeLessThan(43)
    expect(lcm.to[1]).toBeLessThan(49)
    expect(lcm.to[1]).toBeGreaterThan(40)
    // the ball-side winger pushes on down the line instead of tucking in
    const rm = byId(moves, 'o-RM')!
    expect(rm.reason).toBe('wide')
    expect(rm.to[0]).toBeGreaterThanOrEqual(55)
    expect(rm.to[1]).toBeGreaterThan(49)
    // the far-side winger keeps the width
    expect(f['o-LM'][0]).toBeLessThanOrEqual(12)
    // rest defence
    expect(ours.filter((pid) => f[pid][1] <= 49 - REST_BEHIND + 1e-9).length).toBeGreaterThanOrEqual(REST_COUNT)
    // spacing, move cap
    for (let i = 0; i < ours.length; i++)
      for (let j = i + 1; j < ours.length; j++)
        expect(Math.hypot(f[ours[i]][0] - f[ours[j]][0], f[ours[i]][1] - f[ours[j]][1])).toBeGreaterThanOrEqual(5)
    // (a side step off a defender may overrun the cap by the clearance distance)
    for (const m of moves) expect(len(m)).toBeLessThanOrEqual((m.reason === 'shape' ? MAX_SHAPE_M : MAX_RUN_M) + CLEAR_M)
  })

  it('S2 — dribble back: no runs beyond or support angles; nobody drops more than half the retreat; the defence holds', () => {
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 24 }]
    // start from a lifted block so there is something to hold
    const lifted: Record<string, Pt> = { 'o-LST': [26, 60], 'o-RST': [42, 60], 'o-LCM': [28, 46], 'o-LM': [10, 48], 'o-RM': [58, 48] }
    const moves = plan(q, 'o-RCM', lifted)
    expect(moves.some((m) => m.reason === 'depth' || m.reason === 'support' || m.reason === 'wide')).toBe(false)
    for (const m of moves) {
      expect(m.to[1]).toBeGreaterThanOrEqual(m.from[1] - 5 - 1e-6)
      expect(['o-LB', 'o-LCB', 'o-RCB', 'o-RB']).not.toContain(m.playerId)
    }
  })

  it('S3 — an off-ball run: the shape holds, support angles stay around the carrier, forwards do not drop', () => {
    const q: BuilderAction[] = [{ kind: 'run', playerId: 'o-LM', toX: 6, toY: 50 }]
    const moves = plan(q)
    expect(byId(moves, 'o-LM')).toBeUndefined()
    const sup = moves.filter((m) => m.reason === 'support')
    expect(sup.length).toBeGreaterThanOrEqual(1)
    for (const m of sup) expect(Math.hypot(m.to[0] - 43, m.to[1] - 34)).toBeLessThan(12)
    for (const m of moves) expect(len(m)).toBeLessThanOrEqual(MAX_RUN_M + 1e-6)
    for (const pid of ['o-LST', 'o-RST']) {
      const m = byId(moves, pid)
      if (m) expect(m.to[1]).toBeGreaterThanOrEqual(m.from[1] - 0.1)
    }
  })

  it('S4 — a pass: receiver and passer untouched; the team re-forms around the receiver', () => {
    const q: BuilderAction[] = [{ kind: 'pass', playerId: 'o-RCM', to: 'o-RST' }]
    const moves = plan(q)
    expect(byId(moves, 'o-RST')).toBeUndefined()
    // the pass ends the turn, so the passer has no time to follow it
    expect(byId(moves, 'o-RCM')).toBeUndefined()
    // the other forward makes the third-man run beyond RST (42, 47); a 13 m pass is a short turn, so
    // the run covers what fits in the pass's flight — the AI never makes a turn longer
    const lst = byId(moves, 'o-LST')!
    expect(lst.reason).toBe('depth')
    expect(lst.to[1]).toBeGreaterThan(47 + 3)
    expect(len(lst)).toBeCloseTo(MOVE_MPS * scheduleTurn(q, homes).length, 5)
    // support angles sit around the receiver, not the passer
    const sup = moves.filter((m) => m.reason === 'support')
    expect(sup.length).toBeGreaterThanOrEqual(1)
    // (they only get the pass's flight time, so they head that way rather than arrive)
    for (const m of sup) {
      expect(Math.hypot(m.to[0] - 42, m.to[1] - 47)).toBeLessThan(Math.hypot(m.from[0] - 42, m.from[1] - 47))
      expect(m.to[1]).toBeGreaterThan(34)
    }
  })

  it('S5 — a shot: forwards crash the box, a midfielder holds the edge, the defence stays back', () => {
    const up: Record<string, Pt> = {
      'o-LST': [30, 90], 'o-RST': [44, 86], 'o-LCM': [28, 76], 'o-RCM': [44, 76], 'o-LM': [10, 80], 'o-RM': [58, 80],
      'o-LB': [10, 56], 'o-LCB': [25, 55], 'o-RCB': [43, 55], 'o-RB': [58, 56],
      // their back line has dropped to the edge of the six-yard box
      'p-LB': [58, 96], 'p-LCB': [43, 97], 'p-RCB': [25, 97], 'p-RB': [10, 96],
    }
    const q: BuilderAction[] = [{ kind: 'shot', playerId: 'o-LST', toX: 34, toY: 105.5 }]
    const moves = plan(q, 'o-LST', up)
    const rst = byId(moves, 'o-RST')!
    expect(rst.reason).toBe('box')
    // heads for the box; a quick shot leaves him only the flight time to get there
    expect(rst.to[1]).toBeGreaterThan(86)
    expect(moves.some((m) => m.reason === 'second-ball' && m.to[1] > m.from[1])).toBe(true)
    for (const pid of ['o-LB', 'o-LCB', 'o-RCB', 'o-RB']) {
      const m = byId(moves, pid)
      if (m) expect(m.to[1]).toBeLessThanOrEqual(DEF_MAX_DEPTH + 1e-9)
    }
  })

  it('S6 — a wide dribble: the full-back behind overlaps outside and ahead of the ball', () => {
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RM', toX: 62, toY: 50 }]
    const moves = plan(q, 'o-RM')
    const rb = byId(moves, 'o-RB')!
    expect(rb.reason).toBe('overlap')
    // from (58, 20) the run heads outside and up the line; the turn (RM's 14.6 m dribble) is too short to finish it
    expect(rb.to[0]).toBeGreaterThanOrEqual(rb.from[0])
    expect(rb.to[1]).toBeGreaterThanOrEqual(rb.from[1] + 8)
    expect(len(rb)).toBeCloseTo(Math.min(MAX_RUN_M, MOVE_MPS * scheduleTurn(q, homes).length), 5)
  })

  it('S7 — turnStep carries the AI moves and keeps its duration', () => {
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 49 }]
    const inp = input(q)
    const support = supportMovesToPlayerMoves(planTeamShape(inp))
    const plain = turnStep(q, inp.positions, 1)
    const withAi = turnStep(q, inp.positions, 1, {}, support)
    expect(withAi.duration).toBe(plain.duration)
    expect(withAi.moves.length).toBe(plain.moves.length + support.length)
    expect(support.every((m) => m.hidden === true && m.runningSpeed === 'jog')).toBe(true)
    for (const m of support) expect(m.endTime).toBeLessThanOrEqual(withAi.duration + 1e-9)
  })

  it('S8 — the simulator lands every AI mover on his target', () => {
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 49 }]
    const inp = input(q)
    const moves = planTeamShape(inp)
    const step = turnStep(q, inp.positions, 1, {}, supportMovesToPlayerMoves(moves))
    const game: Play = { ...play, steps: [play.steps[0], step] }
    const tl = simulateStep(game, 1, initialState(game), 'o-RCM', inp.positions['o-RCM'])
    for (const m of moves) {
      const end = tl.end[m.playerId]
      expect(Math.hypot(end.x - m.to[0], end.y - m.to[1])).toBeLessThan(0.6)
    }
  })

  it('S9 — a saved game with AI moves replays to the same end positions', () => {
    const q: BuilderAction[] = [{ kind: 'dribble', playerId: 'o-RCM', toX: 43, toY: 49 }]
    const inp = input(q)
    const step = { ...turnStep(q, inp.positions, 1, {}, supportMovesToPlayerMoves(planTeamShape(inp))), builder: { actions: q, outcomes: {}, startHolder: 'o-RCM', endHolder: 'o-RCM', goal: false } }
    const game: Play = { ...play, steps: [{ ...play.steps[0], ballPosition: { x: 43, y: 34 }, builder: { kickoffHolder: 'o-RCM' } }, step] }
    const live = simulateStep(game, 1, initialState(game), 'o-RCM', [43, 34])
    const r = replayGame(game, id)!
    expect(r.turn).toBe(2)
    for (const pid of ours) {
      expect(r.chain!.state[pid].x).toBeCloseTo(live.end[pid].x, 6)
      expect(r.chain!.state[pid].y).toBeCloseTo(live.end[pid].y, 6)
    }
  })
})
