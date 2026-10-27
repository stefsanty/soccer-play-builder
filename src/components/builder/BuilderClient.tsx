'use client'

/**
 * @description Turn-based play builder (/builder): designate a ball carrier in a setup phase, then
 * queue CHAINS of actions — passes, dribbles and runs scheduled back to back per player, with a
 * receiver's later actions waiting for the ball to arrive. A video-editor style timeline lays the
 * queued turn out in time: scrub it to preview any frame (ball position, who is doing what), and drag
 * an action block to retime when it starts (dependencies still win). Taps beyond the XCOM-style
 * movement range are capped to the range boundary; a second, white disc shows the pass range when the
 * selected player will have the ball, with unreachable teammates dimmed (a too-far pass is still
 * refused). The carrier may tap the goal mouth to shoot
 * (engine/shot.ts gives the chance; Play rolls the dice — a saved shot flies to the keeper, and the
 * ball comes back to the shooter either way). Passes and dribbles carry a risk % (engine/risk.ts)
 * from the defenders' positions, shown on the ghost arrow; Play rolls those too — an intercepted
 * pass flies to the defender, a tackled dribble stops short, and the ball comes back to the player
 * who lost it (no turnover). Preview plays the queued turn without committing;
 * Play resolves it through the step simulator with the full defensive AI. The attacking AI
 * (engine/teamShape.ts) moves every teammate the user did not command — the block lifts and slides
 * with the ball, two support angles and a wide outlet form around the carrier, a forward runs beyond,
 * a full-back overlaps, forwards crash the box on a shot, a passer moves again once his pass is away —
 * drawn as thin dotted green arrows while planning and resolved as ordinary moves in the turn (user
 * commands always win: the keeper, commanded players and pass receivers are never moved by it). The
 * old ✓/× suggestion chips are gone. Every resolved action becomes
 * a rewind snapshot: ⏪ / ▶️ tween through them, and "Replan from here" branches the game from any
 * snapshot, discarding what came after.
 * Mobile-first: turn counter top-right, rewind bottom-left, a two-row action queue of short chips
 * ("RCM→RST 0%") at the bottom that scrolls when a turn has more. Removing a chip that others depended
 * on says so in a toast at the foot of the pitch with Undo; the trash asks ("Clear 4?") before clearing.
 * The bottom panel's rows have fixed heights so the pitch never resizes mid-plan; defenders draw
 * under our team and the holder on top.
 * The game is a Play (setup + one step per turn): the header's Save stores it through the editor's
 * save path, and leaving with unsaved turns asks first (back arrow confirm + beforeunload).
 * There is no turn limit (Stefan, 2026-10-27): the counter reads "Turn N", and a goal shows the GOAL!
 * banner and adds to the score chip while play carries on.
 * A game saved from here carries builder bookkeeping on each step; /builder/[id] reopens it and the
 * history, score and holder are rebuilt by re-simulating the steps (engine/builderReplay.ts).
 * @props { initialPlay?: Play } — a saved game to reopen; omitted = a new game
 * @dataDependencies engine/turnBuilder, engine/teamShape, engine/builderReplay, engine/simulator (simulateStep/sampleTimeline), engine/defaultPlay, engine/follow
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, CircleDot, Eye, Minus, Play as PlayIcon, Plus, SkipBack, SkipForward, Square, Trash2, X } from 'lucide-react'
import type { Play } from '@/lib/types/play'
import { mToSvg, svgToFullM, PITCH_W, PITCH_H } from '@/lib/engine/pitch'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { H, initialState, sampleTimeline, simulateStep, type PlayerState, type SimState, type StepTimeline } from '@/lib/engine/simulator'
import { GOAL_CENTRE_X, GOAL_HALF_W, GOAL_LINE_Y, NET_DEPTH_M, detectGoal } from '@/lib/engine/goal'
import { SHOT_RANGE_M, distToSegment, rollShot, shotChance } from '@/lib/engine/shot'
import { dribbleRisk, passRisk, rollRisk, type Defender, type Risk } from '@/lib/engine/risk'
import { newFollowTrack } from '@/lib/engine/follow'
import { drawOrder } from '@/lib/engine/builderHints'
import { planTeamShape, supportMovesToPlayerMoves, type SupportMove } from '@/lib/engine/teamShape'
import { builderTitle, hasUnsavedWork } from '@/lib/engine/builderSave'
import { replayGame } from '@/lib/engine/builderReplay'
import { SaveButton } from '@/components/editor/SaveButton'
import { PitchMarkings } from '@/components/editor/PitchMarkings'
import { PitchSurface } from '@/components/editor/PitchSurface'
import {
  actionInRange,
  actionLabel,
  allowedKinds,
  buildSnapshots,
  capToRange,
  editableKinds,
  holderAfter,
  queueAction,
  removeAction,
  replaceAction,
  retimeAction,
  scheduleTurn,
  shortLabel,
  turnStep,
  PASS_RANGE_M,
  RUN_RANGE_M,
  TACKLE_S,
  turnSeconds,
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
/** A queued action's end ring (run / dribble / shot) or pass midpoint grabs within this radius: tap to
 *  edit the action, drag to move its end. */
const GRAB_M = 3
/** Edit bar: ± this much on the action's start time. */
const NUDGE_S = 0.5
const EDIT = '#4cc9f0'
const KIND_NAME: Record<ActionKind, string> = { pass: 'Pass', dribble: 'Dribble', shot: 'Shoot', run: 'Run' }
/**
 * Bottom panel rows have FIXED heights, so the pitch above never resizes while you plan — a queue
 * chip or the timeline appearing used to shrink the pitch and move every player under your thumb.
 * The timeline box fits two lanes and scrolls for more.
 */
const STATUS_H = 32
/** Two rows of chips: every queued action stays visible at phone width (more scroll inside the box). */
const QUEUE_H = 54
const TIMELINE_H = 62
const LANE_H = 20
const CONTROLS_H = 48
const PANEL_BODY_H = STATUS_H + 8 + QUEUE_H + 8 + TIMELINE_H + 10 + CONTROLS_H
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

export function BuilderClient({ initialPlay }: { initialPlay?: Play | null } = {}) {
  const [play, setPlay] = useState<Play | null>(null)
  // How many steps the last save stored; the game is "dirty" when there is more (or a queue).
  const [savedStepCount, setSavedStepCount] = useState(0)

  const [phase, setPhase] = useState<Phase>('setup')
  const [holder, setHolder] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [queue, setQueue] = useState<BuilderAction[]>([])
  const [turn, setTurn] = useState(1)
  // Latest resolved point of the game; null until the first turn resolves.
  const [chain, setChain] = useState<{ state: SimState; ball: Pt; holder: string } | null>(null)
  const [history, setHistory] = useState<TurnSnapshot[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  // A toast at the foot of the pitch, near the thumb; one with `undo` stays longer and offers it.
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const setFlash = useCallback((text: string | null) => setToast(text ? { text } : null), [])
  // Trash: the first tap asks ("Clear 5?"), the second clears; the question times out after 3 s.
  const [confirmClear, setConfirmClear] = useState(false)
  // Goals scored so far (header chip) and the GOAL! / SAVED banner, shown the moment it happens in playback.
  const [score, setScore] = useState(0)
  const [goalBanner, setGoalBanner] = useState<{ kind: BannerKind; title: string; sub: string; preview: boolean } | null>(null)
  const [timeline, setTimeline] = useState<StepTimeline | null>(null)
  const [progress, setProgress] = useState(0)
  // Timeline scrubber: 0..1 through the queued (draft) turn; null = not scrubbing.
  const [scrubT, setScrubT] = useState<number | null>(null)
  // A block being dragged to a new start time: visual position until the pointer lifts.
  const [blockDrag, setBlockDrag] = useState<{ index: number; start: number } | null>(null)
  useEffect(() => setScrubT(null), [queue, phase, historyIdx])
  // The queued action being edited (tap its chip, end ring or timeline block): drag its end, change
  // its type, nudge its start or delete it. `pickTarget` = waiting for a teammate tap to pass to.
  const [editing, setEditing] = useState<number | null>(null)
  const [pickTarget, setPickTarget] = useState(false)
  useEffect(() => {
    setEditing(null)
    setPickTarget(false)
  }, [phase, historyIdx])
  useEffect(() => {
    if (editing !== null && editing >= queue.length) setEditing(null)
  }, [editing, queue.length])
  useEffect(() => setPickTarget(false), [editing])

  // A new game (crypto.randomUUID → client only), or a saved one rebuilt turn by turn.
  useEffect(() => {
    if (!initialPlay) {
      // Public like every other saved play (MVP has no auth): the library lists public plays only,
      // so a private game could be saved but never found again.
      const fresh = createDefaultPlay()
      setPlay({ ...fresh, title: builderTitle(new Date()), meta: { ...fresh.meta, isPublic: true } })
      return
    }
    const nameOf = (id: string) => initialPlay.players.find((p) => p.id === id)?.label ?? id
    const game = replayGame(initialPlay, nameOf)
    if (!game) {
      // An editor play: start a fresh game from its formation.
      setPlay({ ...initialPlay, steps: initialPlay.steps.slice(0, 1) })
      setToast({ text: 'Not a Turn Builder game — starting from its formation' })
      return
    }
    setPlay(game.play)
    setSavedStepCount(game.play.steps.length)
    setHolder(game.holder)
    setChain(game.chain)
    setHistory(game.history)
    setTurn(game.turn)
    setScore(game.score)
    setPhase('plan')
    const turns = game.turn - 1
    setToast({
      text: game.skipped > 0 ? `Reopened ${turns} of ${turns + game.skipped} turns — the rest had no builder data` : `Reopened — ${turns} turn${turns === 1 ? '' : 's'} played, ${game.score} goal${game.score === 1 ? '' : 's'}`,
    })
  }, [initialPlay])

  const svgRef = useRef<SVGSVGElement>(null)
  const tlRef = useRef<HTMLDivElement>(null)
  // The chip box shows two rows; a third row scrolls, so the newest chip is brought into view.
  const queueRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = queueRef.current
    if (box && box.scrollHeight > box.clientHeight) box.scrollTop = box.scrollHeight
  }, [queue.length])
  const plansRef = useRef<ActionPlan[]>([])
  // The play including the running turn's step; only committed when a real Play finishes (not Preview).
  const pendingPlayRef = useRef<Play | null>(null)
  // Banner moments of the running turn (goal crossing, keeper save), in playback seconds; popped as reached.
  const bannerQueueRef = useRef<BannerEvent[]>([])
  // Who holds the ball when the turn ends, when the dice overrode the plan: after a shot (saved or
  // scored) or a lost ball, it comes back to that player for the next turn — no turnover.
  const returnToRef = useRef<string | null>(null)

  const running = phase === 'playing' || phase === 'preview'
  const dirty = !!play && hasUnsavedWork({ stepCount: play.steps.length, queued: queue.length, savedStepCount })

  // Leaving with unsaved turns: the browser's own prompt on reload / close…
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  // …and a confirm on the back arrow.
  const confirmLeave = (e: React.MouseEvent) => {
    if (!dirty) return
    if (!window.confirm('Leave the Turn Builder? This game is not saved and will be lost.')) e.preventDefault()
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2200)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    if (!confirmClear) return
    const t = setTimeout(() => setConfirmClear(false), 3000)
    return () => clearTimeout(t)
  }, [confirmClear])
  useEffect(() => setConfirmClear(false), [queue, phase])

  /** Offer Undo back to `before` in the toast. */
  const undoToast = (text: string, before: BuilderAction[]) =>
    setToast({
      text,
      undo: () => {
        setQueue(before)
        setToast(null)
      },
    })
  const needed = (n: number) => `${n} action${n === 1 ? '' : 's'} that needed it`

  /** Remove one chip; if other actions depended on it they go too. The toast offers Undo either way. */
  const removeChip = (i: number) => {
    const before = queue
    const { queue: next, dropped } = removeAction(queue, i, holder)
    setQueue(next)
    setEditing(null)
    undoToast(dropped.length === 0 ? `Removed ${shortLabel(before[i], labelOf)}` : `Removed ${shortLabel(before[i], labelOf)} and ${needed(dropped.length)}`, before)
  }

  /** Swap the chip at `i` for an edited version; dependents that no longer make sense go, with Undo. */
  const editChip = (i: number, action: BuilderAction) => {
    const before = queue
    const { queue: next, dropped } = replaceAction(queue, i, action, holder)
    setQueue(next)
    setEditing(next.includes(action) ? next.indexOf(action) : null)
    if (dropped.length > 0) undoToast(`Changed ${shortLabel(before[i], labelOf)} — removed ${needed(dropped.length)}`, before)
  }
  const startEdit = (i: number) => {
    setSelected(null)
    setScrubT(null)
    setEditing(i)
  }

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
  const tlDuration = schedule ? turnSeconds(schedule) : 0
  // The edited action as scheduled (where it departs from, where it ends, when).
  const editAction = editing !== null ? queue[editing] : undefined
  const editPlan = editAction ? schedule?.plans.find((p) => p.action === editAction) : undefined

  // Attacking AI (engine/teamShape.ts): where the teammates the user did not command go while the
  // queued turn plays. Pure and deterministic, so the arrows, Preview, Play and a reopened game agree.
  const support = useMemo<SupportMove[]>(() => {
    if (!play || !schedule || queue.length === 0) return []
    return planTeamShape({
      players: play.players.map((p) => ({ id: p.id, team: p.team, label: p.label })),
      positions: basePositions,
      homes: Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt])),
      attackingTeam: 'ours',
      holder,
      queue,
      schedule,
    })
  }, [play, schedule, queue, basePositions, holder])
  const supportMoves = useMemo(() => supportMovesToPlayerMoves(support), [support])

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
    const step = turnStep(queue, basePositions, stepIndex, {}, supportMoves)
    const nextPlay: Play = { ...play, steps: [...play.steps, step] }
    const start = chain ? chain.state : initialState(nextPlay)
    const startBall: Pt = chain ? chain.ball : (basePositions[holder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2])
    const tl = simulateStep(nextPlay, stepIndex, start, holder, startBall)
    return { nextPlay, tl }
  }, [play, phase, inHistory, queue, basePositions, chain, holder, supportMoves])

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
    if (editing !== null) {
      // Editing a pass (or turning an action into one): the tapped teammate becomes its receiver.
      const a = queue[editing]
      const plan = editPlan
      if (a && plan && (pickTarget || a.kind === 'pass') && id !== a.playerId) {
        const pass: BuilderAction = { kind: 'pass', playerId: a.playerId, to: id, ...(a.delay !== undefined && { delay: a.delay }) }
        if (!actionInRange(pass, { ...planned, [a.playerId]: plan.from })) {
          setFlash(`Too far — a pass can travel up to ${PASS_RANGE_M}m`)
          return
        }
        editChip(editing, pass)
        setPickTarget(false)
        return
      }
      // anyone else: stop editing and select him as usual
      setEditing(null)
      setSelected(id === selected ? null : id)
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
    // An end-ring drag just finished: its click must not also queue an action.
    if (performance.now() - grabClickRef.current < 500) return
    // While editing, a tap on open pitch just closes the editor.
    if (editing !== null) {
      setEditing(null)
      return
    }
    const m = toMeters(e)
    if (!m || !selected) return
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
    const to = capToRange(from, m, RUN_RANGE_M)
    if (to !== m) {
      setFlash(`Max range — ${labelOf(selected)} ${kind === 'dribble' ? 'dribbles' : 'runs'} ${Math.round(RUN_RANGE_M)}m toward it`)
    }
    setQueue((q) => queueAction(q, { kind, playerId: selected, toX: to[0], toY: to[1] }))
    // A dribbler stays selected: the next tap on a teammate passes from the dribble's end, the goal
    // mouth shoots from there (dribble → pass / dribble → shot in one turn).
    setSelected(kind === 'dribble' ? selected : null)
  }

  // ---- editing a queued action: grab its end ring (tap = edit, drag = move the end) ----
  const grabRef = useRef<{ index: number; pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const grabClickRef = useRef(0) // when the last grab ended (performance.now)
  /** Where action `a` ends if its end is dragged to `m`: runs / dribbles capped to the run range, a
   *  shot slides along the goal mouth. */
  const draggedEnd = (a: BuilderAction, from: Pt, m: Pt): BuilderAction | null => {
    if (a.kind === 'run' || a.kind === 'dribble') {
      const to = capToRange(from, m, RUN_RANGE_M)
      return { ...a, toX: to[0], toY: to[1] }
    }
    if (a.kind === 'shot') {
      const to = shotTarget(m[0])
      return { ...a, toX: to[0], toY: to[1] }
    }
    return null
  }
  const onGrabDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation()
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      // capture can fail for exotic pointers; the drag still works per-event
    }
    grabRef.current = { index, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
  }
  const onGrabMove = (e: React.PointerEvent) => {
    const g = grabRef.current
    if (!g || e.pointerId !== g.pointerId) return
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return
    const a = queue[g.index]
    const plan = schedule?.plans.find((p) => p.action === a)
    const m = toMeters(e)
    if (!a || !plan || !m) return
    const next = draggedEnd(a, plan.from, m)
    if (!next) return
    if (!g.moved) {
      g.moved = true
      setSelected(null)
      setEditing(g.index)
    }
    // An end move never changes who has the ball, so nothing downstream can fall away.
    setQueue((q) => q.map((x, j) => (j === g.index ? next : x)))
  }
  const onGrabUp = (e: React.PointerEvent) => {
    const g = grabRef.current
    if (!g || e.pointerId !== g.pointerId) return
    grabRef.current = null
    grabClickRef.current = performance.now()
    if (!g.moved) startEdit(g.index)
  }

  /** The edit bar's type buttons. A pass needs a receiver, so it waits for a teammate tap. */
  const changeKind = (kind: ActionKind) => {
    if (editing === null || !editAction || !editPlan || kind === editAction.kind) return
    const { playerId } = editAction
    const keep = editAction.delay !== undefined ? { delay: editAction.delay } : {}
    if (kind === 'pass') {
      setPickTarget(true)
      return
    }
    if (kind === 'shot') {
      const target = shotTarget(editAction.kind === 'pass' ? GOAL_CENTRE_X : editPlan.to[0])
      if (Math.hypot(target[0] - editPlan.from[0], target[1] - editPlan.from[1]) > SHOT_RANGE_M) {
        setFlash(`Too far to shoot (max ${SHOT_RANGE_M}m)`)
        return
      }
      editChip(editing, { kind: 'shot', playerId, toX: target[0], toY: target[1], ...keep })
      return
    }
    // → dribble: toward where the pass / shot was going, within the run range and short of the goal line
    const aim: Pt = [editPlan.to[0], Math.min(editPlan.to[1], GOAL_LINE_Y - 2)]
    const to = capToRange(editPlan.from, aim, RUN_RANGE_M)
    editChip(editing, { kind: 'dribble', playerId, toX: to[0], toY: to[1], ...keep })
  }
  const nudge = (ds: number) => {
    if (editing === null || !editPlan) return
    setQueue((q) => retimeAction(q, editing, Math.max(0, editPlan.start + ds)))
  }

  const startGame = () => {
    if (!play || !holder) return
    // The setup step records where the ball starts, so a saved game opens in the editor with the ball there.
    const h = basePositions[holder]
    setPlay({
      ...play,
      steps: [{ ...play.steps[0], ...(h ? { ballPosition: { x: h[0], y: h[1] } } : {}), builder: { ...play.steps[0].builder, kickoffHolder: holder } }, ...play.steps.slice(1)],
    })
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
        const step = turnStep(queue, basePositions, stepIndex, outcomes, supportMoves)
        nextPlay = { ...play, steps: [...play.steps, step] }
        const start = chain ? chain.state : initialState(nextPlay)
        const startBall: Pt = chain ? chain.ball : (basePositions[holder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2])
        tl = simulateStep(nextPlay, stepIndex, start, holder, startBall)
      }
    }
    const plans = scheduleTurn(queue, basePositions, outcomes).plans
    plansRef.current = plans
    const lastShot = plans.filter((p) => p.action.kind === 'shot').at(-1)
    const lost: { index: number; player: string } | null = lostBy
    const returnTo = lost ? lost.player : lastShot ? lastShot.action.playerId : null
    returnToRef.current = returnTo
    const goal = detectGoal(tl.frames)
    if (commit) {
      // Builder bookkeeping on the step, so a saved game can be reopened here with its history.
      const last = nextPlay.steps.length - 1
      const step = {
        ...nextPlay.steps[last],
        builder: { actions: queue, outcomes, startHolder: holder, endHolder: returnTo ?? holderAfter(holder, queue), goal: !!goal },
      }
      nextPlay = { ...nextPlay, steps: [...nextPlay.steps.slice(0, last), step] }
    }
    pendingPlayRef.current = commit ? nextPlay : null
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
  const blockDragRef = useRef<{ index: number; pointerId: number; grabOffset: number; durS: number; x: number; moved: boolean } | null>(null)
  const onBlockPointerDown = (e: React.PointerEvent, index: number, plan: ActionPlan) => {
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // capture can fail for exotic pointers; dragging still works per-event
    }
    blockDragRef.current = { index, pointerId: e.pointerId, grabOffset: tlTimeAt(e.clientX) * tlDuration - plan.start, durS: plan.end - plan.start, x: e.clientX, moved: false }
    setBlockDrag({ index, start: plan.start })
  }
  const onBlockPointerMove = (e: React.PointerEvent) => {
    const d = blockDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    if (!d.moved && Math.abs(e.clientX - d.x) < 4) return
    d.moved = true
    const start = clamp(tlTimeAt(e.clientX) * tlDuration - d.grabOffset, 0, Math.max(0, tlDuration - d.durS))
    setBlockDrag({ index: d.index, start })
  }
  const onBlockPointerUp = (e: React.PointerEvent) => {
    const d = blockDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    blockDragRef.current = null
    // a tap (no drag) on a block opens that action in the editor
    if (!d.moved) {
      setBlockDrag(null)
      startEdit(d.index)
      return
    }
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
              : editAction
                ? pickTarget || editAction.kind === 'pass'
                  ? `Editing ${actionLabel(editAction, labelOf)} — tap a teammate to pass to him instead`
                  : `Editing ${actionLabel(editAction, labelOf)} — drag the blue ring to move the end, or change it below`
              : selected
                ? allowedKinds(selected, projectedHolder).includes('pass')
                  ? selected === holder && queue.some((a) => a.playerId === selected && a.kind === 'dribble')
                    ? `${labelOf(selected)} dribbles first — tap a teammate to pass from there, the goal to shoot, or ${labelOf(selected)} to finish`
                    : selected !== holder
                    ? `${labelOf(selected)} will have the ball — tap a teammate to pass, or the pitch to run and meet it`
                    : `${labelOf(selected)} has the ball — tap a teammate to pass, the pitch to dribble, or the goal to shoot`
                  : `${labelOf(selected)} — tap the pitch to queue a run (beyond the area = max-distance run)`
                : support.length > 0
                    ? `${support.length} teammate${support.length === 1 ? '' : 's'} move with the plan (dotted) — tap one to command him instead`
                    : 'Tap a blue player to select; actions chain in queue order'

  // timeline lanes: one row per player that has actions, in order of first appearance
  const lanes: string[] = []
  if (schedule) for (const p of schedule.plans) if (!lanes.includes(p.action.playerId)) lanes.push(p.action.playerId)

  return (
    <div className="flex h-dvh flex-col bg-[var(--app-bg)] text-[#e8edf2]">
      {/* top bar: back + title, turn counter top-right */}
      <header className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" aria-label="Home" onClick={confirmLeave} data-testid="builder-back" className="flex size-9 items-center justify-center rounded-lg text-[var(--app-muted)] hover:text-white">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="truncate text-base font-bold">Turn Builder</h1>
        </div>
        <div className="relative flex items-center gap-1.5">
          {phase !== 'setup' && (
            <div data-testid="score" aria-label={`${score} goals`} className="rounded-full border border-white/10 bg-[var(--app-card)] px-3 py-1 text-sm font-semibold tabular-nums">
              ⚽ {score}
            </div>
          )}
          <div data-testid="turn-counter" className="rounded-full border border-white/10 bg-[var(--app-card)] px-3 py-1 text-sm font-semibold">
            {phase === 'setup' ? 'Setup' : inHistory && viewSnapshot ? `Turn ${viewSnapshot.turn}` : `Turn ${turn}`}
          </div>
          {/* Save the game as a play (the editor's own save path): setup + one step per resolved turn */}
          {phase !== 'setup' && (
            <div className="relative" title={dirty ? 'Save this game' : 'Saved'}>
              <SaveButton play={play} onSaved={(saved) => setSavedStepCount(saved.steps.length)} />
            </div>
          )}
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

          {/* pass range: a second, white disc when the selected player will have the ball — teammates
              beyond it are dimmed, so a refused pass is no surprise (playtest issue 10) */}
          {selected && phase === 'plan' && !inHistory && scrubT === null && allowedKinds(selected, projectedHolder).includes('pass') && (planned[selected] ?? basePositions[selected]) && (() => {
            const p0 = planned[selected] ?? basePositions[selected]
            const c = pt(p0[0], p0[1])
            const r = PASS_RANGE_M * 10
            // label sits where the arc crosses the pitch's vertical centre line, toward the opponent goal
            const lx = c.x
            const ly = clamp(c.y - r, 20, 1030)
            return (
              <g clipPath="url(#builder-pitch-clip)" pointerEvents="none" data-testid="pass-range">
                <circle cx={c.x} cy={c.y} r={r} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.7)" strokeWidth={2.5} strokeDasharray="14 10" />
                {c.y - r > 0 && (
                  <>
                    <rect x={lx - 44} y={ly - 24} width={88} height={22} rx={11} fill="rgba(11,16,21,0.75)" />
                    <text x={lx} y={ly - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill="rgba(255,255,255,0.9)">
                      pass range
                    </text>
                  </>
                )}
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

          {/* attacking-AI moves (thin dotted green, no chips): the teammates moving with the plan */}
          {!frame &&
            !inHistory &&
            phase === 'plan' &&
            support.map((m) => {
              const f = pt(m.from[0], m.from[1])
              const t = pt(m.to[0], m.to[1])
              const d = Math.hypot(t.x - f.x, t.y - f.y) || 1
              const ux = (t.x - f.x) / d
              const uy = (t.y - f.y) / d
              return (
                <g key={`support-${m.playerId}`} pointerEvents="none" data-testid={`support-${m.playerId}`} data-reason={m.reason}>
                  <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke="#86efac" strokeWidth={2.5} strokeDasharray="3 7" strokeLinecap="round" opacity={0.7} />
                  <polyline
                    points={`${t.x - ux * 12 - uy * 6},${t.y - uy * 12 + ux * 6} ${t.x},${t.y} ${t.x - ux * 12 + uy * 6},${t.y - uy * 12 - ux * 6}`}
                    fill="none"
                    stroke="#86efac"
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    opacity={0.7}
                  />
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
              const isEdit = editAction === action
              const stroke = isEdit ? EDIT : isShot ? SHOT_ARROW : GHOST
              const chance = shotChances[i]
              return (
                <g key={`${action.playerId}-${i}`} pointerEvents="none" data-testid={`arrow-${i}`} data-editing={isEdit || undefined}>
                  <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={stroke} strokeWidth={isShot || isEdit ? 4 : 3} strokeDasharray={isShot ? undefined : action.kind === 'pass' ? '4 8' : '12 8'} />
                  <polyline
                    points={`${t.x - ux * 18 - uy * 9},${t.y - uy * 18 + ux * 9} ${t.x},${t.y} ${t.x - ux * 18 + uy * 9},${t.y - uy * 18 - ux * 9}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  {action.kind !== 'pass' && (isEdit || action.kind !== 'shot') ? (
                    <circle cx={t.x} cy={t.y} r={isEdit ? 20 : 16} fill={isEdit ? 'rgba(76,201,240,0.2)' : 'none'} stroke={stroke} strokeWidth={isEdit ? 3.5 : 2.5} strokeDasharray="5 4" />
                  ) : null}
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

          {/* grab handles: a queued action's end ring (pass: its midpoint) — tap to edit, drag to move the end.
              Under the players, so a tap on a disc still selects / passes. */}
          {!frame &&
            !inHistory &&
            phase === 'plan' &&
            schedule?.plans.map(({ action, from, to }) => {
              const qi = queue.indexOf(action)
              if (qi < 0) return null
              const at = action.kind === 'pass' ? pt((from[0] + to[0]) / 2, (from[1] + to[1]) / 2) : pt(to[0], to[1])
              return (
                <circle
                  key={`grab-${qi}`}
                  data-testid={`grab-${qi}`}
                  cx={at.x}
                  cy={at.y}
                  r={GRAB_M * 10}
                  fill="transparent"
                  style={{ cursor: action.kind === 'pass' ? 'pointer' : 'grab', touchAction: 'none' }}
                  onPointerDown={(e) => onGrabDown(e, qi)}
                  onPointerMove={onGrabMove}
                  onPointerUp={onGrabUp}
                  onPointerCancel={() => (grabRef.current = null)}
                  onClick={(e) => e.stopPropagation()}
                />
              )
            })}

          {/* the selected player's chain end: where his next action starts from (after a dribble, the pass goes from here) */}
          {!frame && !inHistory && phase === 'plan' && selected && planned[selected] && basePositions[selected] &&
            Math.hypot(planned[selected][0] - basePositions[selected][0], planned[selected][1] - basePositions[selected][1]) > 0.5 && (() => {
              const c = pt(planned[selected][0], planned[selected][1])
              return <circle data-testid="chain-end" cx={c.x} cy={c.y} r={21} fill="none" stroke={BALL} strokeWidth={3.5} strokeDasharray="6 4" pointerEvents="none" />
            })()}

          {/* players — defenders underneath, our team above, the ball holder on top (never covered) */}
          {drawOrder(play.players, shownHolder).map((p) => {
            const pos = renderPositions[p.id] ?? [p.x, p.y]
            const c = pt(pos[0], pos[1])
            const isOurs = p.team === 'ours'
            const isSel = selected === p.id
            const isHolder = shownHolder === p.id
            const tappable = isOurs && !running && !inHistory
            // a teammate the selected carrier cannot reach with a pass is dimmed
            const outOfPassRange =
              isOurs &&
              !!selected &&
              selected !== p.id &&
              phase === 'plan' &&
              !inHistory &&
              scrubT === null &&
              allowedKinds(selected, projectedHolder).includes('pass') &&
              !actionInRange({ kind: 'pass', playerId: selected, to: p.id }, planned)
            return (
              <g
                key={p.id}
                transform={`translate(${c.x}, ${c.y})`}
                opacity={outOfPassRange ? 0.45 : 1}
                data-out-of-range={outOfPassRange || undefined}
                // a disc you can't tap (defenders, or anyone mid-playback) lets the tap through to an
                // end ring under it — a run often ends right on the man marking him
                pointerEvents={tappable ? undefined : 'none'}
                onClick={(e) => {
                  if (!tappable) return
                  e.stopPropagation()
                  onPlayerTap(p.id)
                }}
                style={{ cursor: tappable ? 'pointer' : 'default' }}
              >
                {/* generous tap target; the holder gets a larger one still */}
                {tappable && <circle r={isHolder ? 34 : 26} fill="transparent" />}
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
        {/* edit bar: the tapped queued action — change its type, nudge its start, delete it */}
        {editAction && editPlan && editing !== null && phase === 'plan' && !inHistory && (
          <div className="absolute inset-x-2 bottom-2 rounded-2xl border border-[#4cc9f0]/50 bg-[rgba(11,16,21,0.94)] p-1.5 shadow-2xl backdrop-blur" data-testid="edit-bar">
            <div className="flex h-8 items-center gap-1">
              <span className="min-w-0 flex-1 truncate pl-1.5 text-xs font-bold text-[#4cc9f0]">
                {editing + 1} · {shortLabel(editAction, labelOf)}
              </span>
              <button onClick={() => nudge(-NUDGE_S)} aria-label="Start earlier" data-testid="edit-earlier" className="flex size-8 touch-manipulation items-center justify-center rounded-lg border border-[var(--app-line)] text-[var(--app-muted)] active:scale-95">
                <Minus className="size-4" />
              </button>
              <span className="w-12 text-center text-[11px] font-semibold tabular-nums text-[#e8edf2]" data-testid="edit-start">
                {editPlan.start.toFixed(1)}s
              </span>
              <button onClick={() => nudge(NUDGE_S)} aria-label="Start later" data-testid="edit-later" className="flex size-8 touch-manipulation items-center justify-center rounded-lg border border-[var(--app-line)] text-[var(--app-muted)] active:scale-95">
                <Plus className="size-4" />
              </button>
              <button onClick={() => removeChip(editing)} aria-label="Delete this action" data-testid="edit-delete" className="flex size-8 touch-manipulation items-center justify-center rounded-lg border border-red-400/50 text-red-300 active:scale-95">
                <Trash2 className="size-4" />
              </button>
              <button onClick={() => setEditing(null)} aria-label="Done editing" data-testid="edit-done" className="flex size-8 touch-manipulation items-center justify-center rounded-lg bg-[#4cc9f0] text-[#0b1015] active:scale-95">
                <Check className="size-4" />
              </button>
            </div>
            <div className="mt-1 flex h-8 items-center gap-1">
              {editableKinds(queue, editing, holder).map((k) => {
                const on = pickTarget ? k === 'pass' : editAction.kind === k
                return (
                  <button
                    key={k}
                    onClick={() => changeKind(k)}
                    data-testid={`edit-kind-${k}`}
                    data-on={on || undefined}
                    className={`h-8 flex-1 touch-manipulation rounded-lg text-xs font-bold active:scale-95 ${on ? 'bg-[#4cc9f0] text-[#0b1015]' : 'border border-[var(--app-line)] text-[#e8edf2]'}`}
                  >
                    {KIND_NAME[k]}
                  </button>
                )
              })}
              {editAction.kind === 'run' && <span className="flex-[2] px-1 text-[10px] leading-tight text-[var(--app-muted)]">No ball here — he can only run</span>}
              <button
                onClick={() => {
                  setEditing(null)
                  setSelected(editAction.playerId)
                }}
                data-testid="edit-next"
                className="h-8 flex-1 touch-manipulation rounded-lg border border-[var(--app-line)] text-xs font-semibold text-[var(--app-muted)] active:scale-95"
              >
                Then…
              </button>
            </div>
          </div>
        )}
        {toast && (
          <div className={`pointer-events-none absolute inset-x-0 flex justify-center ${editAction ? 'bottom-[92px]' : 'bottom-3'}`} data-testid="toast">
            <div className="flex items-center gap-3 rounded-full bg-[rgba(11,16,21,0.92)] py-1.5 pl-4 pr-1.5 text-xs font-semibold text-[#ffd43b] shadow-lg backdrop-blur">
              {toast.text}
              {toast.undo ? (
                <button
                  onClick={toast.undo}
                  data-testid="toast-undo"
                  className="pointer-events-auto flex h-8 touch-manipulation items-center rounded-full bg-[var(--app-accent)] px-3 text-xs font-bold text-[var(--app-accent-ink)] active:scale-95"
                >
                  Undo
                </button>
              ) : (
                <span className="w-2" />
              )}
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
      <div
        data-testid="bottom-panel"
        className="shrink-0 rounded-t-2xl border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2.5"
      >
        <div className="mb-2 overflow-hidden text-xs leading-tight text-[var(--app-muted)]" style={{ height: STATUS_H }} aria-live="polite">
          {status}
        </div>

        {phase === 'setup' ? (
          <div className="flex items-center" style={{ height: PANEL_BODY_H - STATUS_H - 8 }}>
            <button
              onClick={startGame}
              disabled={!holder}
              className="flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-[14px] bg-[var(--app-accent)] text-base font-bold text-[var(--app-accent-ink)] transition-all duration-100 active:scale-[0.97] disabled:opacity-40"
            >
              Start planning
            </button>
          </div>
        ) : (
          <>
            <div
              ref={queueRef}
              className="no-scrollbar mb-2 flex flex-wrap content-start items-start gap-1 overflow-y-auto"
              style={{ height: QUEUE_H }}
              data-testid="action-queue"
            >
              {inHistory ? (
                <span className="text-xs text-[var(--app-muted)]">{viewSnapshot?.label}</span>
              ) : queue.length === 0 ? (
                <span className="text-xs text-[#5b6977]">No actions queued</span>
              ) : (
                queue.map((a, i) => (
                  <span
                    key={`${a.playerId}-${i}`}
                    data-testid={`queue-chip-${i}`}
                    data-editing={editing === i || undefined}
                    className={`flex h-6 shrink-0 items-center gap-1 rounded-md border pr-0.5 text-[11px] font-semibold leading-none ${
                      editing === i ? 'border-[#4cc9f0] bg-[#4cc9f0]/20' : 'border-[var(--app-line)] bg-[var(--app-chip)]'
                    }`}
                  >
                    {/* tap the chip to edit that action */}
                    <button
                      onClick={() => (editing === i ? setEditing(null) : startEdit(i))}
                      disabled={phase !== 'plan'}
                      aria-label={`Edit ${actionLabel(a, labelOf)}`}
                      data-testid={`chip-edit-${i}`}
                      className="flex h-full touch-manipulation items-center gap-1 pl-1.5"
                    >
                      <span className="text-[9px] text-[var(--app-muted)]">{i + 1}</span>
                      {a.kind !== 'run' && <CircleDot className="size-3 text-[#ffd43b]" aria-hidden />}
                      {shortLabel(a, labelOf)}
                      {a.kind === 'shot' && shotChances[i] !== undefined && (
                        <span className="rounded px-1 text-[9px] text-white" style={{ background: chanceColor(shotChances[i]) }}>
                          {pct(shotChances[i])}
                        </span>
                      )}
                      {risks[i] && (
                        <span className="rounded px-1 text-[9px] text-white" style={{ background: riskColor(risks[i].risk) }}>
                          {pct(risks[i].risk)}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => removeChip(i)}
                      aria-label={`Remove ${actionLabel(a, labelOf)}`}
                      className="flex size-6 items-center justify-center rounded text-[var(--app-muted)] hover:text-red-400"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* turn timeline: scrub to preview any moment, drag a block to retime its action.
                The box is always there at a fixed height (two lanes; more scroll) so the pitch never moves. */}
            <div
              ref={tlRef}
              data-testid="turn-timeline"
              className={`relative mb-2.5 touch-none select-none overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] ${schedule && queue.length > 0 && !inHistory && phase === 'plan' ? '' : 'opacity-40'}`}
              style={{ height: TIMELINE_H }}
              onPointerDown={onTlPointerDown}
              onPointerMove={onTlPointerMove}
            >
              {schedule && queue.length > 0 && !inHistory && phase === 'plan' ? (
                <div className="relative" style={{ height: Math.max(TIMELINE_H - 2, 22 + lanes.length * LANE_H) }}>
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
                        top: 3 + lane * LANE_H,
                        left: `${(start / tlDuration) * 100}%`,
                        width: `${w}%`,
                        background: BLOCK_COLORS[plan.action.kind],
                        outline: active ? '2px solid #ffd43b' : blockDrag?.index === i || queue[editing ?? -1] === plan.action ? `2px solid ${EDIT}` : 'none',
                      }}
                      onPointerDown={(e) => onBlockPointerDown(e, i, plan)}
                      onPointerMove={onBlockPointerMove}
                      onPointerUp={onBlockPointerUp}
                    >
                      {shortLabel(plan.action, labelOf)}
                    </div>
                  )
                })}
                {/* playhead */}
                {scrubT !== null && (
                  <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-[#ffd43b]" style={{ left: `${scrubT * 100}%` }} />
                )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-[var(--app-muted)]">
                  {inHistory ? 'History' : 'Timeline — queue an action to scrub and retime it'}
                </div>
              )}
            </div>

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
                  if (!confirmClear) {
                    setConfirmClear(true)
                    return
                  }
                  setQueue([])
                  setSelected(null)
                  setConfirmClear(false)
                }}
                disabled={inHistory || phase !== 'plan' || queue.length === 0}
                aria-label={confirmClear ? `Tap again to clear ${queue.length} queued action${queue.length === 1 ? '' : 's'}` : 'Clear queued actions'}
                data-testid="clear-queue"
                data-confirm={confirmClear || undefined}
                className={`flex h-12 touch-manipulation items-center justify-center gap-1 rounded-[14px] border transition-all duration-100 active:scale-95 disabled:opacity-35 ${
                  confirmClear ? 'w-auto border-red-400/60 bg-red-500/20 px-3 text-sm font-bold text-red-300' : 'size-12 border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)]'
                }`}
              >
                <Trash2 className="size-5" />
                {confirmClear && <span>Clear {queue.length}?</span>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
