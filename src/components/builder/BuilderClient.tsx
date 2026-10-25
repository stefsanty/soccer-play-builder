'use client'

/**
 * @description Turn-based play builder (/builder): designate a ball carrier in a setup phase, then
 * queue CHAINS of actions — passes, dribbles and runs scheduled back to back per player, with a
 * receiver's later actions waiting for the ball to arrive. A video-editor style timeline lays the
 * queued turn out in time: scrub it to preview any frame (ball position, who is doing what), and drag
 * an action block to retime when it starts (dependencies still win). Taps beyond the XCOM-style
 * movement range are capped to the range boundary. The carrier may tap the goal mouth to shoot
 * (engine/shot.ts gives the chance; Play rolls the dice — a saved shot flies to the keeper, and the
 * ball comes back to the shooter either way). Passes and dribbles carry a risk % (engine/risk.ts)
 * from the defenders' positions, shown on the ghost arrow; Play rolls those too — an intercepted
 * pass flies to the defender, a tackled dribble stops short, and the ball comes back to the player
 * who lost it (no turnover). Preview plays the queued turn without committing;
 * Play resolves it through the step simulator with the full defensive AI, and the attacking AI
 * suggests support runs as dashed green arrows (✓ queues, × dismisses). Every resolved action becomes
 * a rewind snapshot: ⏪ / ▶️ tween through them, and "Replan from here" branches the game from any
 * snapshot, discarding what came after.
 * Mobile-first: turn counter top-right, rewind bottom-left, scrollable action queue at the bottom.
 * @props {}
 * @dataDependencies engine/turnBuilder, engine/simulator (simulateStep/sampleTimeline), engine/attackingAI, engine/defaultPlay, engine/follow
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CircleDot, Eye, Play as PlayIcon, SkipBack, SkipForward, Square, Trash2, X } from 'lucide-react'
import type { Play } from '@/lib/types/play'
import { mToSvg, svgToFullM, PITCH_W, PITCH_H } from '@/lib/engine/pitch'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { H, initialState, sampleTimeline, simulateStep, type PlayerState, type SimState, type StepTimeline } from '@/lib/engine/simulator'
import { GOAL_CENTRE_X, GOAL_HALF_W, GOAL_LINE_Y, NET_DEPTH_M, detectGoal } from '@/lib/engine/goal'
import { SHOT_RANGE_M, distToSegment, rollShot, shotChance } from '@/lib/engine/shot'
import { dribbleRisk, passRisk, rollRisk, type Defender, type Risk } from '@/lib/engine/risk'
import { newFollowTrack } from '@/lib/engine/follow'
import { computeAutoMovements, type PitchState } from '@/lib/engine/attackingAI'
import { PitchMarkings } from '@/components/editor/PitchMarkings'
import { PitchSurface } from '@/components/editor/PitchSurface'
import {
  actionInRange,
  actionLabel,
  allowedKinds,
  buildSnapshots,
  holderAfter,
  queueAction,
  retimeAction,
  sanitizeQueue,
  scheduleTurn,
  turnStep,
  MIN_TURN_S,
  PASS_RANGE_M,
  RUN_RANGE_M,
  TACKLE_S,
  TURN_TAIL_S,
  type ActionKind,
  type ActionPlan,
  type BuilderAction,
  type TurnOutcomes,
  type TurnSnapshot,
} from '@/lib/engine/turnBuilder'

type Pt = [number, number]
type Phase = 'setup' | 'plan' | 'playing' | 'preview'

const OURS = '#2f8cff'
const OPP = '#e5484d'
const BALL = '#ffd43b'
const GHOST = 'rgba(255, 215, 40, 0.75)'
const BLOCK_COLORS: Record<string, string> = {
  pass: 'rgba(255,255,255,0.85)',
  dribble: 'rgba(255,170,60,0.9)',
  run: 'rgba(255,212,59,0.85)',
  shot: 'rgba(255,120,120,0.95)',
}
const SHOT_ARROW = 'rgba(255,140,140,0.95)'
/** Chip colour for a chance to score: green when likely, amber when even, red when a long shot. */
const chanceColor = (p: number) => (p >= 0.5 ? '#16a34a' : p >= 0.25 ? '#d97706' : '#dc2626')
/** Chip colour for a risk of losing the ball: green when safe, amber when dicey, red when likely lost. */
const riskColor = (r: number) => (r < 0.15 ? '#16a34a' : r < 0.4 ? '#d97706' : '#dc2626')
type BannerKind = 'goal' | 'saved' | 'lost'
interface BannerEvent {
  at: number
  kind: BannerKind
  title: string
  sub: string
}
const pct = (p: number) => `${Math.round(p * 100)}%`
/** Where in the goal mouth a shot aimed at tap x goes: between the posts, just over the line. */
const shotTarget = (x: number): Pt => [clamp(x, GOAL_CENTRE_X - GOAL_HALF_W + 0.3, GOAL_CENTRE_X + GOAL_HALF_W - 0.3), GOAL_LINE_Y + 0.5]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Confetti pieces for the GOAL! banner — fixed layout so the burst looks the same every time. */
const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 7) % 10) / 10,
  dur: 1.6 + ((i * 3) % 5) / 5,
  color: ['#ffd43b', '#2f8cff', '#86efac', '#f87171', '#ffffff'][i % 5],
}))
const pt = (x: number, y: number) => {
  const s = mToSvg(x, y)
  return { x: s.svgX, y: s.svgY }
}
const positionsOf = (state: SimState): Record<string, Pt> =>
  Object.fromEntries(Object.entries(state).map(([id, p]) => [id, [p.x, p.y] as Pt]))

/** A fresh SimState standing at `positions` — how a replanned branch restarts from a snapshot. */
const stateFromPositions = (play: Play, positions: Record<string, Pt>): SimState =>
  Object.fromEntries(
    play.players.map((p) => [
      p.id,
      {
        x: positions[p.id]?.[0] ?? p.x,
        y: positions[p.id]?.[1] ?? p.y,
        vx: 0,
        vy: 0,
        face: p.team === 'ours' ? -Math.PI / 2 : Math.PI / 2,
        faceTo: null,
        rule: null,
        fol: newFollowTrack(),
        team: p.team,
      } satisfies PlayerState,
    ]),
  )

export function BuilderClient() {
  const [play, setPlay] = useState<Play | null>(null)
  useEffect(() => setPlay(createDefaultPlay()), []) // crypto.randomUUID → client only

  const [phase, setPhase] = useState<Phase>('setup')
  const [holder, setHolder] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [queue, setQueue] = useState<BuilderAction[]>([])
  const [turn, setTurn] = useState(1)
  // Latest resolved point of the game; null until the first turn resolves.
  const [chain, setChain] = useState<{ state: SimState; ball: Pt; holder: string } | null>(null)
  const [history, setHistory] = useState<TurnSnapshot[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  // Goals scored so far (header chip) and the GOAL! / SAVED banner, shown the moment it happens in playback.
  const [score, setScore] = useState(0)
  const [goalBanner, setGoalBanner] = useState<{ kind: BannerKind; title: string; sub: string; preview: boolean } | null>(null)
  const [timeline, setTimeline] = useState<StepTimeline | null>(null)
  const [progress, setProgress] = useState(0)
  // Timeline scrubber: 0..1 through the queued (draft) turn; null = not scrubbing.
  const [scrubT, setScrubT] = useState<number | null>(null)
  // A block being dragged to a new start time: visual position until the pointer lifts.
  const [blockDrag, setBlockDrag] = useState<{ index: number; start: number } | null>(null)
  // Attacking-AI suggestions the user has waved away; cleared when a new turn starts.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  useEffect(() => setDismissed(new Set()), [turn])
  useEffect(() => setScrubT(null), [queue, phase, historyIdx])

  const svgRef = useRef<SVGSVGElement>(null)
  const tlRef = useRef<HTMLDivElement>(null)
  const plansRef = useRef<ActionPlan[]>([])
  // The play including the running turn's step; only committed when a real Play finishes (not Preview).
  const pendingPlayRef = useRef<Play | null>(null)
  // Banner moments of the running turn (goal crossing, keeper save), in playback seconds; popped as reached.
  const bannerQueueRef = useRef<BannerEvent[]>([])
  // Who holds the ball when the turn ends, when the dice overrode the plan: after a shot (saved or
  // scored) or a lost ball, it comes back to that player for the next turn — no turnover.
  const returnToRef = useRef<string | null>(null)

  const running = phase === 'playing' || phase === 'preview'

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2200)
    return () => clearTimeout(t)
  }, [flash])

  // The banner lingers until tapped, or a few seconds after the turn finishes playing.
  useEffect(() => {
    if (!goalBanner || running) return
    const t = setTimeout(() => setGoalBanner(null), 3000)
    return () => clearTimeout(t)
  }, [goalBanner, running])

  const labelOf = useCallback((id: string) => play?.players.find((p) => p.id === id)?.label ?? id, [play])

  // Positions being edited against (turn start): the last resolved state, or kick-off.
  const basePositions = useMemo<Record<string, Pt>>(() => {
    if (!play) return {}
    if (chain) return positionsOf(chain.state)
    return Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
  }, [play, chain])

  const inHistory = historyIdx !== null
  const viewSnapshot = inHistory ? history[historyIdx] : null

  // The queued chain laid out in time: ghost arrows come from its plans and the range disc / gating
  // from its planned (post-move) positions, so a second queued run departs from the first one's target.
  const schedule = useMemo(() => (phase === 'plan' && !inHistory ? scheduleTurn(queue, basePositions) : null), [phase, inHistory, queue, basePositions])
  const planned = schedule?.planned ?? basePositions
  // Who will hold the ball once the queue so far has run — gating follows this through the chain.
  const projectedHolder = holderAfter(holder, queue)
  const tlDuration = schedule ? Math.max(MIN_TURN_S, schedule.length + TURN_TAIL_S) : 0

  // Shooting: the keeper saves (the roll homes a saved shot onto him); other defenders can block.
  const keeperId = useMemo(() => play?.players.find((p) => p.team === 'opp' && /gk/i.test(p.label))?.id ?? null, [play])
  const blockers = useMemo<Pt[]>(
    () => (play ? play.players.filter((p) => p.team === 'opp' && p.id !== keeperId).map((p) => basePositions[p.id] ?? [p.x, p.y]) : []),
    [play, keeperId, basePositions],
  )
  /** Chance to score for each queued shot, by queue index. */
  const shotChances = useMemo<Record<number, number>>(() => {
    const out: Record<number, number> = {}
    schedule?.plans.forEach((p, i) => {
      if (p.action.kind === 'shot') out[i] = shotChance(p.from, p.to, blockers)
    })
    return out
  }, [schedule, blockers])
  // Every defender (keeper included) as he stands at the turn start — who can cut out a pass or tackle.
  const defenders = useMemo<Defender[]>(
    () => (play ? play.players.filter((p) => p.team === 'opp').map((p) => ({ id: p.id, at: basePositions[p.id] ?? [p.x, p.y] })) : []),
    [play, basePositions],
  )
  /** Risk of losing the ball for each queued pass / dribble, by queue index (engine/risk.ts). */
  const risks = useMemo<Record<number, Risk>>(() => {
    const out: Record<number, Risk> = {}
    schedule?.plans.forEach((p, i) => {
      if (p.action.kind === 'pass') out[i] = passRisk(p.from, p.to, defenders)
      else if (p.action.kind === 'dribble') out[i] = dribbleRisk(p.from, p.to, defenders)
    })
    return out
  }, [schedule, defenders])
  const threats = useMemo(() => new Set(Object.values(risks).map((r) => r.by).filter((id): id is string => !!id)), [risks])

  // The queued turn fully simulated (draft): powers the timeline scrubber and both Preview and Play.
  const draft = useMemo(() => {
    if (!play || phase !== 'plan' || inHistory || queue.length === 0) return null
    const stepIndex = play.steps.length
    const step = turnStep(queue, basePositions, stepIndex)
    const nextPlay: Play = { ...play, steps: [...play.steps, step] }
    const start = chain ? chain.state : initialState(nextPlay)
    const startBall: Pt = chain ? chain.ball : (basePositions[holder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2])
    const tl = simulateStep(nextPlay, stepIndex, start, holder, startBall)
    return { nextPlay, tl }
  }, [play, phase, inHistory, queue, basePositions, chain, holder])

  // What the pitch shows right now: playback frame > scrub frame > history snapshot > planning state.
  const frame =
    timeline && running
      ? sampleTimeline(timeline, progress * timeline.duration)
      : scrubT !== null && draft
        ? sampleTimeline(draft.tl, scrubT * draft.tl.duration)
        : null
  const shownPositions = useMemo<Record<string, Pt>>(() => {
    if (frame) return Object.fromEntries(Object.entries(frame.players).map(([id, p]) => [id, [p.x, p.y] as Pt]))
    if (viewSnapshot) return viewSnapshot.positions
    return basePositions
  }, [frame, viewSnapshot, basePositions])

  // Attacking-AI suggestions (engine/attackingAI.ts): recomputed against the queued turn so a queued
  // pass yields the passer's support run; hidden mid-gesture, while scrubbing, in history and playback.
  const suggestions = useMemo(() => {
    if (!play || phase !== 'plan' || inHistory || selected || scrubT !== null) return []
    const draftStep = turnStep(queue, basePositions, play.steps.length)
    const holderPos = holder ? basePositions[holder] : null
    const state: PitchState = {
      players: play.players.map((p) => {
        const pos = basePositions[p.id] ?? [p.x, p.y]
        return { id: p.id, team: p.team, x: pos[0], y: pos[1] }
      }),
      ball: { x: holderPos?.[0] ?? PITCH_W / 2, y: holderPos?.[1] ?? PITCH_H / 2, holderId: holder },
      attackingTeam: 'ours',
    }
    return computeAutoMovements(draftStep, state, new Set()).filter((s) => !dismissed.has(s.playerId))
  }, [play, phase, inHistory, selected, scrubT, queue, basePositions, holder, dismissed])

  const shownHolder = frame ? frame.ball.holder : viewSnapshot ? viewSnapshot.holder : holder

  // ⏪/▶️ tween the pitch between history states instead of teleporting — an instant flip to a
  // slightly different arrangement reads as nothing happening.
  const displayedRef = useRef<Record<string, Pt> | null>(null)
  const [animPositions, setAnimPositions] = useState<Record<string, Pt> | null>(null)
  const animRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (running) return
    const from = displayedRef.current
    const target = historyIdx !== null ? history[historyIdx]?.positions : chain ? positionsOf(chain.state) : null
    if (!from || !target) return
    const delta = Math.max(
      0,
      ...Object.entries(target).map(([id, tp]) => {
        const fp = from[id]
        return fp ? Math.hypot(tp[0] - fp[0], tp[1] - fp[1]) : 0
      }),
    )
    if (delta < 0.05) return
    if (animRafRef.current !== null) cancelAnimationFrame(animRafRef.current)
    const t0 = performance.now()
    const DUR = 400
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / DUR)
      const e = 1 - (1 - u) ** 3
      const mix: Record<string, Pt> = {}
      for (const [id, tp] of Object.entries(target)) {
        const fp = from[id] ?? tp
        mix[id] = [fp[0] + (tp[0] - fp[0]) * e, fp[1] + (tp[1] - fp[1]) * e]
      }
      setAnimPositions(u < 1 ? mix : null)
      if (u < 1) animRafRef.current = requestAnimationFrame(tick)
    }
    animRafRef.current = requestAnimationFrame(tick)
    return () => {
      if (animRafRef.current !== null) cancelAnimationFrame(animRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIdx])

  const renderPositions = !frame && animPositions ? animPositions : shownPositions
  displayedRef.current = renderPositions

  const shownBall: Pt | null = frame
    ? [frame.ball.x, frame.ball.y]
    : shownHolder && renderPositions[shownHolder]
      ? renderPositions[shownHolder]
      : null

  // ---- playback loop (Play commits on completion, Preview just returns to planning) ----
  useEffect(() => {
    if (!running || !timeline || !play) return
    let raf = 0
    let last: number | null = null
    let p = 0
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000
      last = now
      p = Math.min(1, p + dt / timeline.duration)
      setProgress(p)
      const due = bannerQueueRef.current[0]
      if (due && p * timeline.duration >= due.at) {
        bannerQueueRef.current = bannerQueueRef.current.slice(1)
        setGoalBanner({ kind: due.kind, title: due.title, sub: due.sub, preview: phase === 'preview' })
        if (due.kind === 'goal' && phase === 'playing') setScore((n) => n + 1)
      }
      if (p < 1) {
        raf = requestAnimationFrame(tick)
        return
      }
      if (phase === 'preview') {
        setTimeline(null)
        setProgress(0)
        setPhase('plan')
        return
      }
      // Turn resolved: commit the step, end state, holder and per-action snapshots.
      const plans = plansRef.current
      const actions = plans.map((pl) => pl.action)
      const startPositions = positionsOf(timeline.start)
      const endPositions = positionsOf(timeline.end)
      const lastBall = timeline.frames.at(-1)?.ball
      // After a shot or a lost ball the ball returns to that player (Stefan: no turnover; play carries on).
      const override = returnToRef.current
      returnToRef.current = null
      const nextHolder = override ?? holderAfter(holder, actions)
      const returned = override !== null
      if (pendingPlayRef.current) setPlay(pendingPlayRef.current)
      pendingPlayRef.current = null
      setChain({
        state: timeline.end,
        ball: lastBall && !returned ? [lastBall.x, lastBall.y] : (endPositions[nextHolder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2]),
        holder: nextHolder ?? '',
      })
      setHistory((h) => {
        const snaps = buildSnapshots(turn, plans, startPositions, endPositions, holder, labelOf)
        const last = snaps.at(-1)
        if (last && returned) snaps[snaps.length - 1] = { ...last, holder: nextHolder }
        return [...h, ...snaps]
      })
      setHolder(nextHolder)
      setTurn((t) => t + 1)
      setQueue([])
      setTimeline(null)
      setPhase('plan')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, phase, timeline, play, holder, turn, labelOf])

  // ---- interactions ----
  const toMeters = (e: { clientX: number; clientY: number }): Pt | null => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()?.inverse()
    if (!svg || !ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm)
    const m = svgToFullM(p.x, p.y)
    // Taps stay 2 m inside the touchlines, except into the goal mouth: a tap between the posts may
    // land up to NET_DEPTH_M behind the line, so a carrier can dribble the ball into the net.
    const x = clamp(m.x, 2, PITCH_W - 2)
    const inMouth = Math.abs(x - GOAL_CENTRE_X) <= GOAL_HALF_W
    return [x, clamp(m.y, 2, inMouth ? GOAL_LINE_Y + NET_DEPTH_M : PITCH_H - 2)]
  }

  const onPlayerTap = (id: string) => {
    if (running || inHistory || !play) return
    if (scrubT !== null) {
      setScrubT(null)
      return
    }
    const player = play.players.find((p) => p.id === id)
    if (!player || player.team !== 'ours') return

    if (phase === 'setup') {
      setHolder(id)
      return
    }
    if (!selected) {
      setSelected(id)
      return
    }
    if (selected === id) {
      setSelected(null)
      return
    }
    // A second player tapped: the projected ball carrier passes; anyone else just can't.
    if (allowedKinds(selected, projectedHolder).includes('pass')) {
      const pass: BuilderAction = { kind: 'pass', playerId: selected, to: id }
      if (!actionInRange(pass, planned)) {
        setFlash(`Too far — a pass can travel up to ${PASS_RANGE_M}m`)
        return
      }
      setQueue((q) => queueAction(q, pass))
      setSelected(null)
    } else {
      setFlash(`${labelOf(selected)} won't have the ball — runs only`)
      setSelected(id)
    }
  }

  const onPitchTap = (e: React.MouseEvent) => {
    if (phase !== 'plan' || inHistory) return
    if (scrubT !== null) {
      setScrubT(null)
      return
    }
    if (!selected) return
    const m = toMeters(e)
    if (!m) return
    // A projected holder with the ball already at their chain time dribbles; otherwise they run,
    // concurrent with the incoming pass flight (the simulator's pass homes onto the live receiver).
    const canDribble = allowedKinds(selected, projectedHolder).includes('dribble')
    let kind: ActionKind = canDribble ? 'dribble' : 'run'
    if (canDribble && schedule) {
      const myNext = Math.max(0, ...schedule.plans.filter((p) => p.action.playerId === selected).map((p) => p.end))
      const ballArrival = Math.max(
        0,
        ...schedule.plans.filter((p) => p.action.kind === 'pass' && p.action.to === selected).map((p) => p.end),
      )
      if (myNext < ballArrival) kind = 'run'
    }
    const from = planned[selected] ?? basePositions[selected]
    if (!from) return
    // The carrier tapping the goal mouth shoots (within range), else dribbles closer.
    if (kind === 'dribble' && Math.abs(m[0] - GOAL_CENTRE_X) <= GOAL_HALF_W && m[1] >= GOAL_LINE_Y - 0.5) {
      const target = shotTarget(m[0])
      if (Math.hypot(target[0] - from[0], target[1] - from[1]) <= SHOT_RANGE_M) {
        setQueue((q) => queueAction(q, { kind: 'shot', playerId: selected, toX: target[0], toY: target[1] }))
        setSelected(null)
        return
      }
      setFlash(`Too far to shoot (max ${SHOT_RANGE_M}m) — ${labelOf(selected)} dribbles closer`)
    }
    // A tap beyond the highlighted range becomes a maximum-distance move toward that spot.
    let to: Pt = m
    const d = Math.hypot(m[0] - from[0], m[1] - from[1])
    if (d > RUN_RANGE_M) {
      to = [from[0] + ((m[0] - from[0]) * RUN_RANGE_M) / d, from[1] + ((m[1] - from[1]) * RUN_RANGE_M) / d]
      setFlash(`Max range — ${labelOf(selected)} ${kind === 'dribble' ? 'dribbles' : 'runs'} ${Math.round(RUN_RANGE_M)}m toward it`)
    }
    setQueue((q) => queueAction(q, { kind, playerId: selected, toX: to[0], toY: to[1] }))
    setSelected(null)
  }

  const startGame = () => {
    if (!play || !holder) return
    setHistory([
      {
        turn: 0,
        actionIndex: 0,
        actionCount: 0,
        label: 'Kick-off',
        positions: basePositions,
        holder,
      },
    ])
    setPhase('plan')
  }

  /** Simulate the queued turn; `commit: false` is Preview (nothing persists when it ends, and every
   *  shot goes in). A real Play rolls the dice on each shot first: a saved one flies to the keeper. */
  const beginTurn = (commit: boolean) => {
    if (!play || !draft || phase !== 'plan' || inHistory) return
    const banners: BannerEvent[] = []
    let nextPlay = draft.nextPlay
    let tl = draft.tl
    const outcomes: TurnOutcomes = { saved: {}, intercepted: {}, tackled: {} }
    let rolled = false
    let lostBy: { index: number; player: string } | null = null
    if (commit) {
      // Roll in queue order; the first lost ball ends the ball's story for this turn.
      for (let i = 0; i < queue.length && !lostBy; i++) {
        const a = queue[i]
        if (a.kind === 'shot') {
          if (keeperId && rollShot(shotChances[i] ?? 0) === 'saved') {
            outcomes.saved![i] = keeperId
            rolled = true
          }
          continue
        }
        const r = risks[i]
        if (!r || !r.by || rollRisk(r.risk) === 'kept') continue
        rolled = true
        lostBy = { index: i, player: a.playerId }
        if (a.kind === 'pass') outcomes.intercepted![i] = r.by
        else if (a.kind === 'dribble') {
          const plan = schedule?.plans[i]
          const def = defenders.find((d) => d.id === r.by)
          const u = plan && def ? distToSegment(def.at, plan.from, plan.to).u : 0.5
          outcomes.tackled![i] = { by: r.by, at: clamp(u, 0.15, 0.9) }
        }
      }
      if (rolled) {
        const stepIndex = play.steps.length
        const step = turnStep(queue, basePositions, stepIndex, outcomes)
        nextPlay = { ...play, steps: [...play.steps, step] }
        const start = chain ? chain.state : initialState(nextPlay)
        const startBall: Pt = chain ? chain.ball : (basePositions[holder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2])
        tl = simulateStep(nextPlay, stepIndex, start, holder, startBall)
      }
    }
    const plans = scheduleTurn(queue, basePositions, outcomes).plans
    plansRef.current = plans
    pendingPlayRef.current = commit ? nextPlay : null
    const lastShot = plans.filter((p) => p.action.kind === 'shot').at(-1)
    const lost: { index: number; player: string } | null = lostBy
    returnToRef.current = lost ? lost.player : lastShot ? lastShot.action.playerId : null
    plans.forEach((p, i) => {
      const who = labelOf(p.action.playerId)
      if (p.action.kind === 'shot' && outcomes.saved?.[i]) {
        banners.push({ at: p.end, kind: 'saved', title: 'SAVED', sub: `${labelOf(keeperId ?? '')} keeps it out (${pct(shotChances[i] ?? 0)} chance) · ball back to ${who}` })
      } else if (p.action.kind === 'pass' && outcomes.intercepted?.[i]) {
        banners.push({ at: p.end, kind: 'lost', title: 'INTERCEPTED', sub: `opp ${labelOf(outcomes.intercepted[i])} cuts it out (${pct(risks[i]?.risk ?? 0)} risk) · ball back to ${who}` })
      } else if (p.action.kind === 'dribble' && outcomes.tackled?.[i]) {
        banners.push({ at: p.end + TACKLE_S, kind: 'lost', title: 'TACKLED', sub: `opp ${labelOf(outcomes.tackled[i].by)} wins it (${pct(risks[i]?.risk ?? 0)} risk) · ball back to ${who}` })
      }
    })
    const goal = detectGoal(tl.frames)
    if (goal) banners.push({ at: goal.frameIndex * H, kind: 'goal', title: 'GOAL!', sub: commit ? `Turn ${turn} · tap to carry on` : 'Preview — not counted' })
    bannerQueueRef.current = banners.sort((a, b) => a.at - b.at)
    setGoalBanner(null)
    setSelected(null)
    setScrubT(null)
    setTimeline(tl)
    setProgress(0)
    setPhase(commit ? 'playing' : 'preview')
  }

  const cancelPreview = () => {
    setTimeline(null)
    setProgress(0)
    setPhase('plan')
  }

  // ---- rewind / branch ----
  const canRewind = phase === 'plan' && history.length > 1 && (historyIdx === null || historyIdx > 0)
  const canForward = inHistory
  const rewind = () => {
    if (!canRewind) return
    setSelected(null)
    setHistoryIdx((i) => (i === null ? history.length - 2 : Math.max(0, i - 1)))
  }
  const forward = () => {
    if (historyIdx === null) return
    const next = historyIdx + 1
    setHistoryIdx(next >= history.length - 1 ? null : next)
  }

  /** Branch the game from the viewed snapshot: everything after it is discarded and planning resumes
   *  from exactly this arrangement (an interrupted turn is re-planned under its own number). */
  const replanFromHere = () => {
    if (historyIdx === null || !play) return
    const snap = history[historyIdx]
    const completedTurns = snap.actionIndex === snap.actionCount ? snap.turn : Math.max(0, snap.turn - 1)
    const positions = snap.positions
    setPlay({ ...play, steps: play.steps.slice(0, 1 + completedTurns) })
    setChain({
      state: stateFromPositions(play, positions),
      ball: snap.holder ? (positions[snap.holder] ?? [PITCH_W / 2, PITCH_H / 2]) : [PITCH_W / 2, PITCH_H / 2],
      holder: snap.holder ?? '',
    })
    setHolder(snap.holder)
    setTurn(completedTurns + 1)
    setHistory((h) => h.slice(0, historyIdx + 1))
    setHistoryIdx(null)
    setQueue([])
    setSelected(null)
    setFlash(`Replanning from ${snap.turn === 0 ? 'kick-off' : `turn ${snap.turn}`} — later turns discarded`)
  }

  // ---- timeline scrub & retime ----
  const tlTimeAt = (clientX: number): number => {
    const r = tlRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return clamp((clientX - r.left) / r.width, 0, 1)
  }
  const onTlPointerDown = (e: React.PointerEvent) => {
    if (!draft) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture can fail for exotic pointers; scrubbing still works per-event
    }
    setScrubT(tlTimeAt(e.clientX))
  }
  const onTlPointerMove = (e: React.PointerEvent) => {
    if (!draft || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    setScrubT(tlTimeAt(e.clientX))
  }
  const blockDragRef = useRef<{ index: number; pointerId: number; grabOffset: number; durS: number } | null>(null)
  const onBlockPointerDown = (e: React.PointerEvent, index: number, plan: ActionPlan) => {
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // capture can fail for exotic pointers; dragging still works per-event
    }
    blockDragRef.current = { index, pointerId: e.pointerId, grabOffset: tlTimeAt(e.clientX) * tlDuration - plan.start, durS: plan.end - plan.start }
    setBlockDrag({ index, start: plan.start })
  }
  const onBlockPointerMove = (e: React.PointerEvent) => {
    const d = blockDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    const start = clamp(tlTimeAt(e.clientX) * tlDuration - d.grabOffset, 0, Math.max(0, tlDuration - d.durS))
    setBlockDrag({ index: d.index, start })
  }
  const onBlockPointerUp = (e: React.PointerEvent) => {
    const d = blockDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    blockDragRef.current = null
    setBlockDrag((bd) => {
      if (bd) setQueue((q) => retimeAction(q, bd.index, bd.start))
      return null
    })
  }

  if (!play) return <div className="flex h-dvh items-center justify-center bg-[var(--app-bg)]" />

  const scrubSeconds = scrubT !== null && draft ? scrubT * draft.tl.duration : null
  const activeNow =
    scrubSeconds !== null && schedule
      ? schedule.plans.filter((p) => scrubSeconds >= p.start && scrubSeconds <= p.end).map((p) => actionLabel(p.action, labelOf))
      : []

  const status =
    phase === 'setup'
      ? holder
        ? `${labelOf(holder)} starts with the ball — tap Start, or pick someone else`
        : 'Tap one of your (blue) players to give them the ball'
      : inHistory && viewSnapshot
        ? viewSnapshot.turn === 0
          ? 'History — Kick-off · step ▶ to return, or replan from here'
          : `History — Turn ${viewSnapshot.turn}, action ${viewSnapshot.actionIndex}/${viewSnapshot.actionCount}: ${viewSnapshot.label}`
        : phase === 'playing'
          ? 'Playing…'
          : phase === 'preview'
            ? 'Previewing — nothing is committed'
            : scrubSeconds !== null
              ? `${scrubSeconds.toFixed(1)}s — ${activeNow.length ? activeNow.join(' · ') : 'ball settles'}`
              : selected
                ? allowedKinds(selected, projectedHolder).includes('pass')
                  ? selected !== holder
                    ? `${labelOf(selected)} will have the ball — tap a teammate to pass, or the pitch to run and meet it`
                    : `${labelOf(selected)} has the ball — tap a teammate to pass, the pitch to dribble, or the goal to shoot`
                  : `${labelOf(selected)} — tap the pitch to queue a run (beyond the area = max-distance run)`
                : 'Tap a blue player to select; actions chain in queue order'

  // timeline lanes: one row per player that has actions, in order of first appearance
  const lanes: string[] = []
  if (schedule) for (const p of schedule.plans) if (!lanes.includes(p.action.playerId)) lanes.push(p.action.playerId)

  return (
    <div className="flex h-dvh flex-col bg-[var(--app-bg)] text-[#e8edf2]">
      {/* top bar: back + title, turn counter top-right */}
      <header className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" aria-label="Home" className="flex size-9 items-center justify-center rounded-lg text-[var(--app-muted)] hover:text-white">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="truncate text-base font-bold">Turn Builder</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {phase !== 'setup' && (
            <div data-testid="score" aria-label={`${score} goals`} className="rounded-full border border-white/10 bg-[var(--app-card)] px-3 py-1 text-sm font-semibold tabular-nums">
              ⚽ {score}
            </div>
          )}
          <div data-testid="turn-counter" className="rounded-full border border-white/10 bg-[var(--app-card)] px-3 py-1 text-sm font-semibold">
            {phase === 'setup' ? 'Setup' : `Turn ${inHistory && viewSnapshot ? viewSnapshot.turn : turn}`}
          </div>
        </div>
      </header>

      {/* pitch */}
      <div className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          data-testid="builder-pitch"
          viewBox="-20 -20 720 1090"
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full touch-manipulation select-none"
          onClick={onPitchTap}
          role="img"
          aria-label="Turn-based play builder pitch"
        >
          <PitchSurface />
          <PitchMarkings />
          <defs>
            <marker id="builder-arrow-suggest" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#86efac" />
            </marker>
            <clipPath id="builder-pitch-clip">
              <rect x={0} y={0} width={680} height={1050} />
            </clipPath>
          </defs>

          {/* XCOM-style movement range, centred on where the chain leaves the selected player */}
          {selected && phase === 'plan' && !inHistory && scrubT === null && (planned[selected] ?? basePositions[selected]) && (() => {
            const p0 = planned[selected] ?? basePositions[selected]
            const c = pt(p0[0], p0[1])
            const r = RUN_RANGE_M * 10
            return (
              <g clipPath="url(#builder-pitch-clip)" pointerEvents="none" data-testid="move-range">
                <circle cx={c.x} cy={c.y} r={r} fill="rgba(76,201,240,0.13)" />
                <circle cx={c.x} cy={c.y} r={r} fill="none" stroke="rgba(76,201,240,0.55)" strokeWidth={2.5} strokeDasharray="10 8" />
              </g>
            )
          })()}

          {/* shoot target: the goal mouth lights up when the selected carrier is within range */}
          {selected && phase === 'plan' && !inHistory && scrubT === null && allowedKinds(selected, projectedHolder).includes('shot') && (() => {
            const p0 = planned[selected] ?? basePositions[selected]
            if (!p0) return null
            const centre = shotTarget(GOAL_CENTRE_X)
            const d = Math.hypot(centre[0] - p0[0], centre[1] - p0[1])
            if (d > SHOT_RANGE_M) return null
            const chance = shotChance(p0, centre, blockers)
            const tl = pt(GOAL_CENTRE_X - GOAL_HALF_W, GOAL_LINE_Y)
            return (
              <g pointerEvents="none" data-testid="shoot-target">
                <rect x={tl.x} y={tl.y - 18} width={GOAL_HALF_W * 20} height={18 + 10} rx={4} fill="rgba(255,120,120,0.35)" stroke={SHOT_ARROW} strokeWidth={2.5} strokeDasharray="8 6">
                  <animate attributeName="opacity" values="1;0.45;1" dur="1.2s" repeatCount="indefinite" />
                </rect>
                <rect x={tl.x + GOAL_HALF_W * 10 - 52} y={tl.y + 16} width={104} height={26} rx={13} fill={chanceColor(chance)} />
                <text x={tl.x + GOAL_HALF_W * 10} y={tl.y + 34} textAnchor="middle" fontSize={15} fontWeight={800} fill="white">
                  Shoot · {pct(chance)}
                </text>
              </g>
            )
          })()}

          {/* attacking-AI suggestions (dashed green) — ✓ queues the run, × dismisses it */}
          {suggestions.map((s) => {
            const from = planned[s.playerId] ?? basePositions[s.playerId]
            if (!from) return null
            const a = pt(from[0], from[1])
            const b = pt(s.toX, s.toY)
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
            // dismiss chip sits beside the arrowhead (empty pitch), not on the player, so it never
            // steals the player's own tap target
            const xChip = { x: b.x + (-(b.y - a.y) / len) * 30, y: b.y + ((b.x - a.x) / len) * 30 }
            return (
              <g key={`sug-${s.playerId}`} data-testid={`suggestion-${s.playerId}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#86efac" strokeWidth={3} strokeDasharray="10 7" opacity={0.55} markerEnd="url(#builder-arrow-suggest)" pointerEvents="none" />
                <g
                  style={{ cursor: 'pointer' }}
                  data-testid={`suggest-accept-${s.playerId}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Suggestions are short, but clamp to the movement budget just in case.
                    const fp = planned[s.playerId] ?? basePositions[s.playerId]
                    let tx = s.toX
                    let ty = s.toY
                    if (fp) {
                      const d = Math.hypot(tx - fp[0], ty - fp[1])
                      if (d > RUN_RANGE_M) {
                        tx = fp[0] + ((tx - fp[0]) * RUN_RANGE_M) / d
                        ty = fp[1] + ((ty - fp[1]) * RUN_RANGE_M) / d
                      }
                    }
                    setQueue((q) => queueAction(q, { kind: 'run', playerId: s.playerId, toX: tx, toY: ty }))
                    setFlash(`${labelOf(s.playerId)} run queued (AI)`)
                  }}
                >
                  <ellipse cx={mid.x} cy={mid.y} rx={26} ry={19} fill="rgba(22,163,74,0.82)" />
                  <text x={mid.x} y={mid.y + 5} textAnchor="middle" fontSize={17} fill="white" fontWeight={700} pointerEvents="none">✓</text>
                </g>
                <g
                  style={{ cursor: 'pointer' }}
                  data-testid={`suggest-dismiss-${s.playerId}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDismissed((prev) => new Set([...prev, s.playerId]))
                  }}
                >
                  <circle cx={xChip.x} cy={xChip.y} r={19} fill="rgba(0,0,0,0.52)" />
                  <text x={xChip.x} y={xChip.y + 5} textAnchor="middle" fontSize={17} fill="#f87171" fontWeight={700} pointerEvents="none">×</text>
                </g>
              </g>
            )
          })}

          {/* queued ghost arrows — one per scheduled action, chained segments included */}
          {!frame &&
            !inHistory &&
            schedule?.plans.map(({ action, from, to }, i) => {
              const f = pt(from[0], from[1])
              const t = pt(to[0], to[1])
              const d = Math.hypot(t.x - f.x, t.y - f.y) || 1
              const ux = (t.x - f.x) / d
              const uy = (t.y - f.y) / d
              const isShot = action.kind === 'shot'
              const stroke = isShot ? SHOT_ARROW : GHOST
              const chance = shotChances[i]
              return (
                <g key={`${action.playerId}-${i}`} pointerEvents="none">
                  <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={stroke} strokeWidth={isShot ? 4 : 3} strokeDasharray={isShot ? undefined : action.kind === 'pass' ? '4 8' : '12 8'} />
                  <polyline
                    points={`${t.x - ux * 18 - uy * 9},${t.y - uy * 18 + ux * 9} ${t.x},${t.y} ${t.x - ux * 18 + uy * 9},${t.y - uy * 18 - ux * 9}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  {action.kind === 'run' || action.kind === 'dribble' ? <circle cx={t.x} cy={t.y} r={16} fill="none" stroke={GHOST} strokeWidth={2.5} strokeDasharray="5 4" /> : null}
                  {isShot && chance !== undefined && (
                    <g data-testid={`shot-chance-${i}`}>
                      <rect x={(f.x + t.x) / 2 - 46} y={(f.y + t.y) / 2 - 13} width={92} height={26} rx={13} fill={chanceColor(chance)} />
                      <text x={(f.x + t.x) / 2} y={(f.y + t.y) / 2 + 5} textAnchor="middle" fontSize={15} fontWeight={800} fill="white">
                        Goal {pct(chance)}
                      </text>
                    </g>
                  )}
                  {risks[i] && (
                    <g data-testid={`risk-${i}`} data-risk={Math.round(risks[i].risk * 100)}>
                      <rect x={(f.x + t.x) / 2 - 26} y={(f.y + t.y) / 2 - 13} width={52} height={26} rx={13} fill={riskColor(risks[i].risk)} />
                      <text x={(f.x + t.x) / 2} y={(f.y + t.y) / 2 + 5} textAnchor="middle" fontSize={15} fontWeight={800} fill="white">
                        {pct(risks[i].risk)}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}

          {/* players */}
          {play.players.map((p) => {
            const pos = renderPositions[p.id] ?? [p.x, p.y]
            const c = pt(pos[0], pos[1])
            const isOurs = p.team === 'ours'
            const isSel = selected === p.id
            const isHolder = shownHolder === p.id
            const tappable = isOurs && !running && !inHistory
            return (
              <g
                key={p.id}
                transform={`translate(${c.x}, ${c.y})`}
                onClick={(e) => {
                  if (!tappable) return
                  e.stopPropagation()
                  onPlayerTap(p.id)
                }}
                style={{ cursor: tappable ? 'pointer' : 'default' }}
              >
                {/* generous tap target */}
                {tappable && <circle r={26} fill="transparent" />}
                {threats.has(p.id) && <circle r={22} fill="none" stroke="#f87171" strokeWidth={3} opacity={0.6} data-testid="threat-ring" />}
                {isSel && <circle r={21} fill="none" stroke={BALL} strokeWidth={3.5} opacity={0.95} />}
                {isHolder && !isSel && <circle r={19} fill="none" stroke="white" strokeWidth={2.5} opacity={0.9} />}
                <circle r={14} fill={isOurs ? OURS : OPP} stroke="rgba(255,255,255,0.65)" strokeWidth={1.5} />
                <text textAnchor="middle" dy={4} fontSize={11} fontWeight={700} fill="white" pointerEvents="none">
                  {p.label}
                </text>
              </g>
            )
          })}

          {/* ball */}
          {shownBall &&
            (() => {
              const b = pt(shownBall[0], shownBall[1])
              const lift = frame?.ball.lift ?? 0
              return (
                <circle
                  cx={b.x}
                  cy={b.y}
                  r={7 * (1 + lift * 0.6)}
                  fill={BALL}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              )
            })()}
        </svg>

        {goalBanner && (
          <div
            data-testid="turn-banner"
            data-kind={goalBanner.kind}
            role="status"
            onClick={() => !running && setGoalBanner(null)}
            className={`absolute inset-0 flex flex-col items-center justify-center overflow-hidden ${running ? 'pointer-events-none' : 'cursor-pointer'}`}
          >
            {goalBanner.kind === 'goal' && CONFETTI.map((c, i) => (
              <span
                key={i}
                aria-hidden
                className="builder-confetti absolute top-0 block h-2.5 w-1.5 rounded-sm"
                style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }}
              />
            ))}
            <div className="rounded-2xl bg-[rgba(11,16,21,0.88)] px-8 py-4 text-center shadow-2xl backdrop-blur">
              <div className={`font-black tracking-tight drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] ${goalBanner.kind === 'goal' ? 'text-5xl text-[#ffd43b]' : 'text-4xl text-[#ff8a8a]'}`}>
                {goalBanner.title}
              </div>
              <div className="mt-1 max-w-[260px] text-xs font-semibold text-[var(--app-muted)]">{goalBanner.sub}</div>
            </div>
          </div>
        )}
        {flash && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="rounded-full bg-[rgba(11,16,21,0.9)] px-4 py-1.5 text-xs font-semibold text-[#ffd43b] shadow-lg backdrop-blur">
              {flash}
            </div>
          </div>
        )}
        {inHistory && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <button
              onClick={replanFromHere}
              data-testid="replan-here"
              className="touch-manipulation rounded-full bg-[var(--app-accent)] px-5 py-2 text-xs font-bold text-[var(--app-accent-ink)] shadow-lg transition-all duration-100 active:scale-95"
            >
              Replan from here
            </button>
          </div>
        )}
        {phase === 'preview' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="rounded-full border border-[var(--app-accent)]/40 bg-[rgba(11,16,21,0.9)] px-4 py-1.5 text-xs font-semibold text-[var(--app-accent)]">
              Preview — tap Stop to go back to planning
            </div>
          </div>
        )}
      </div>

      {/* bottom panel: status, queue, timeline, controls */}
      <div className="shrink-0 rounded-t-2xl border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2.5">
        <div className="mb-2 min-h-4 text-xs leading-tight text-[var(--app-muted)]" aria-live="polite">
          {status}
        </div>

        {phase === 'setup' ? (
          <button
            onClick={startGame}
            disabled={!holder}
            className="flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-[14px] bg-[var(--app-accent)] text-base font-bold text-[var(--app-accent-ink)] transition-all duration-100 active:scale-[0.97] disabled:opacity-40"
          >
            Start planning
          </button>
        ) : (
          <>
            <div className="no-scrollbar mb-2 flex min-h-[38px] items-center gap-1.5 overflow-x-auto" data-testid="action-queue">
              {inHistory ? (
                <span className="text-xs text-[var(--app-muted)]">{viewSnapshot?.label}</span>
              ) : queue.length === 0 ? (
                <span className="text-xs text-[#5b6977]">No actions queued</span>
              ) : (
                queue.map((a, i) => (
                  <span
                    key={`${a.playerId}-${i}`}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--app-line)] bg-[var(--app-chip)] px-2.5 py-1.5 text-xs font-semibold"
                  >
                    <span className="text-[10px] text-[var(--app-muted)]">{i + 1}</span>
                    {a.kind !== 'run' && <CircleDot className="size-3.5 text-[#ffd43b]" aria-hidden />}
                    {actionLabel(a, labelOf)}
                    {a.kind === 'shot' && shotChances[i] !== undefined && (
                      <span className="rounded px-1 text-[10px] text-white" style={{ background: chanceColor(shotChances[i]) }}>
                        {pct(shotChances[i])}
                      </span>
                    )}
                    {risks[i] && (
                      <span className="rounded px-1 text-[10px] text-white" style={{ background: riskColor(risks[i].risk) }}>
                        {pct(risks[i].risk)}
                      </span>
                    )}
                    <button
                      onClick={() => setQueue((q) => sanitizeQueue(q.filter((_, j) => j !== i), holder))}
                      aria-label={`Remove ${actionLabel(a, labelOf)}`}
                      className="-mr-1 flex size-5 items-center justify-center rounded text-[var(--app-muted)] hover:text-red-400"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* turn timeline: scrub to preview any moment, drag a block to retime its action */}
            {schedule && queue.length > 0 && !inHistory && phase === 'plan' && (
              <div
                ref={tlRef}
                data-testid="turn-timeline"
                className="relative mb-2.5 touch-none select-none overflow-hidden rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)]"
                style={{ height: 22 + lanes.length * 20 }}
                onPointerDown={onTlPointerDown}
                onPointerMove={onTlPointerMove}
              >
                {/* second ticks */}
                {Array.from({ length: Math.floor(tlDuration) }, (_, i) => i + 1).map((s) => (
                  <div key={s} className="absolute bottom-0 top-0 w-px bg-white/10" style={{ left: `${(s / tlDuration) * 100}%` }}>
                    <span className="absolute bottom-0 left-0.5 text-[8px] leading-none text-[var(--app-muted)]">{s}s</span>
                  </div>
                ))}
                {/* action blocks */}
                {schedule.plans.map((plan, i) => {
                  const lane = lanes.indexOf(plan.action.playerId)
                  const start = blockDrag?.index === i ? blockDrag.start : plan.start
                  const w = Math.max(3, ((plan.end - plan.start) / tlDuration) * 100)
                  const active = scrubSeconds !== null && scrubSeconds >= start && scrubSeconds <= start + (plan.end - plan.start)
                  return (
                    <div
                      key={i}
                      data-testid={`tl-block-${i}`}
                      className="absolute flex h-4 cursor-grab items-center overflow-hidden whitespace-nowrap rounded px-1 text-[9px] font-bold leading-none text-[#0b1015]"
                      style={{
                        top: 3 + lane * 20,
                        left: `${(start / tlDuration) * 100}%`,
                        width: `${w}%`,
                        background: BLOCK_COLORS[plan.action.kind],
                        outline: active ? '2px solid #ffd43b' : blockDrag?.index === i ? '2px solid #4cc9f0' : 'none',
                      }}
                      onPointerDown={(e) => onBlockPointerDown(e, i, plan)}
                      onPointerMove={onBlockPointerMove}
                      onPointerUp={onBlockPointerUp}
                    >
                      {actionLabel(plan.action, labelOf)}
                    </div>
                  )
                })}
                {/* playhead */}
                {scrubT !== null && (
                  <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-[#ffd43b]" style={{ left: `${scrubT * 100}%` }} />
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* rewind controls, bottom-left; appear once there is history to walk */}
              {history.length > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={rewind}
                    disabled={!canRewind}
                    aria-label="Rewind one action"
                    data-testid="rewind"
                    className="flex size-12 touch-manipulation items-center justify-center rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] transition-all duration-100 active:scale-95 disabled:opacity-35"
                  >
                    <SkipBack className="size-5" />
                  </button>
                  <span className="w-9 text-center text-xs font-semibold tabular-nums text-[var(--app-muted)]" data-testid="history-pos">
                    {(historyIdx ?? history.length - 1) + 1}/{history.length}
                  </span>
                  <button
                    onClick={forward}
                    disabled={!canForward}
                    aria-label="Forward one action"
                    data-testid="forward"
                    className="flex size-12 touch-manipulation items-center justify-center rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] transition-all duration-100 active:scale-95 disabled:opacity-35"
                  >
                    <SkipForward className="size-5" />
                  </button>
                </div>
              )}
              <button
                onClick={() => (phase === 'preview' ? cancelPreview() : beginTurn(false))}
                disabled={phase === 'playing' || inHistory || (phase === 'plan' && queue.length === 0)}
                aria-label={phase === 'preview' ? 'Stop preview' : 'Preview the queued turn'}
                data-testid="preview-turn"
                className="flex h-12 touch-manipulation items-center justify-center gap-1.5 rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3.5 text-sm font-semibold text-[var(--app-muted)] transition-all duration-100 active:scale-95 disabled:opacity-35"
              >
                {phase === 'preview' ? <Square className="size-4" /> : <Eye className="size-4" />}
                {phase === 'preview' ? 'Stop' : 'Preview'}
              </button>
              <button
                onClick={() => beginTurn(true)}
                disabled={queue.length === 0 || phase !== 'plan' || inHistory}
                data-testid="play-turn"
                className="flex h-12 flex-1 touch-manipulation items-center justify-center gap-2 rounded-[14px] bg-[var(--app-accent)] text-base font-bold text-[var(--app-accent-ink)] transition-all duration-100 active:scale-[0.97] disabled:opacity-40"
              >
                <PlayIcon className="size-5" />
                Play
              </button>
              <button
                onClick={() => {
                  setQueue([])
                  setSelected(null)
                }}
                disabled={inHistory || phase !== 'plan' || queue.length === 0}
                aria-label="Clear queued actions"
                className="flex size-12 touch-manipulation items-center justify-center rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)] transition-all duration-100 active:scale-95 disabled:opacity-35"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
