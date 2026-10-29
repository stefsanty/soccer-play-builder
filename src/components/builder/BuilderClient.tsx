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
 * old ✓/× suggestion chips are gone.
 * Live feedback (Stefan, 2026-10-30): a new command plays out at once — the queued turn re-simulates
 * from that action's start to its end at double speed, and the pitch then rests on the turn's planned
 * end (players where the plan leaves them, the AI's answer included); arrows stay as the paths taken.
 * Drag a player's disc to move the end of his last run / dribble. Play still rolls the dice.
 * One game timeline (engine/gameTimeline.ts): every resolved turn keeps its simulation; the strip at
 * the top of the timeline box spans all turns plus the draft, with a tick per action end. Drag it, or
 * ⏪ / ▶️, to go back: the pitch shows the exact simulated frame there. Nothing is deleted until you
 * tap one of your players there — then the game branches from that point (later turns and later
 * actions dropped; the toast offers Undo).
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
import { H, initialState, sampleTimeline, simulateStep, type SimState, type StepTimeline } from '@/lib/engine/simulator'
import { GOAL_CENTRE_X, GOAL_HALF_W, GOAL_LINE_Y, NET_DEPTH_M, detectGoal } from '@/lib/engine/goal'
import { SHOT_RANGE_M, distToSegment, rollShot, shotChance } from '@/lib/engine/shot'
import { dribbleRisk, passRisk, rollRisk, type Defender, type Risk } from '@/lib/engine/risk'
import { drawOrder } from '@/lib/engine/builderHints'
import { planTeamShape, supportMovesToPlayerMoves, type SupportMove } from '@/lib/engine/teamShape'
import { builderTitle, hasUnsavedWork } from '@/lib/engine/builderSave'
import { replayGame } from '@/lib/engine/builderReplay'
import { actionsDoneBy, atTurnEnd, buildMarkers, nearestMarker, type ResolvedTurn, type TimelinePoint } from '@/lib/engine/gameTimeline'
import { SaveButton } from '@/components/editor/SaveButton'
import { PitchMarkings } from '@/components/editor/PitchMarkings'
import { PitchSurface } from '@/components/editor/PitchSurface'
import {
  actionInRange,
  actionLabel,
  allowedKinds,
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
/** The game strip across all turns, at the top of the timeline box. */
const STRIP_H = 16
const CONTROLS_H = 48
/** Live feedback plays the new command at this many times real speed, and never longer than LIVE_MAX_S. */
const LIVE_SPEED = 2
const LIVE_MAX_S = 1.2
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
  // Every resolved turn with its simulation — the one game timeline — and the point being looked at
  // (null = now). Looking back deletes nothing; a command there branches the game (branchFrom).
  const [turns, setTurns] = useState<ResolvedTurn[]>([])
  const [view, setView] = useState<TimelinePoint | null>(null)
  // Live feedback for the command just queued (queue index): it plays out from its start at LIVE_SPEED.
  // `prev` = what the pitch showed, eased out over the first part so nobody jumps.
  const [liveAnim, setLiveAnim] = useState<{ index: number; prev: Record<string, Pt>; startMs: number } | null>(null)
  const [liveNow, setLiveNow] = useState(0)
  useEffect(() => {
    if (!liveAnim) return
    let raf = 0
    const tick = (now: number) => {
      setLiveNow(now)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [liveAnim])
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
  useEffect(() => setScrubT(null), [queue, phase, view])
  // The queued action being edited (tap its chip, end ring or timeline block): drag its end, change
  // its type, nudge its start or delete it. `pickTarget` = waiting for a teammate tap to pass to.
  const [editing, setEditing] = useState<number | null>(null)
  const [pickTarget, setPickTarget] = useState(false)
  useEffect(() => {
    setEditing(null)
    setPickTarget(false)
  }, [phase, view])
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
    setTurns(game.turns)
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
  // When the running turn's goal goes in (seconds), for the game timeline's score at any point.
  const goalAtRef = useRef<number | null>(null)

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

  const inHistory = view !== null

  // The queued chain laid out in time: ghost arrows come from its plans and the range disc / gating
  // from its planned (post-move) positions, so a second queued run departs from the first one's target.
  // Kept while looking back: the draft is the last stretch of the game timeline.
  const schedule = useMemo(() => (phase === 'plan' ? scheduleTurn(queue, basePositions) : null), [phase, queue, basePositions])
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
    if (!play || phase !== 'plan' || queue.length === 0) return null
    const stepIndex = play.steps.length
    const step = turnStep(queue, basePositions, stepIndex, {}, supportMoves)
    const nextPlay: Play = { ...play, steps: [...play.steps, step] }
    const start = chain ? chain.state : initialState(nextPlay)
    const startBall: Pt = chain ? chain.ball : (basePositions[holder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2])
    const tl = simulateStep(nextPlay, stepIndex, start, holder, startBall)
    return { nextPlay, tl }
  }, [play, phase, queue, basePositions, chain, holder, supportMoves])

  // The game timeline's step markers: kick-off, every action end of every turn, the draft's last.
  const markers = useMemo(
    () => buildMarkers(turns, phase === 'plan' && draft && schedule ? { plans: schedule.plans, duration: draft.tl.duration } : null, labelOf),
    [turns, phase, draft, schedule, labelOf],
  )
  const markerIdx = view ? markers.findIndex((m) => m.turn === view.turn && Math.abs(m.t - view.t) < 1e-6) : markers.length - 1
  const viewMarker = markerIdx >= 0 ? markers[markerIdx] : null
  // The simulation the viewed point belongs to: a resolved turn, or the draft.
  const viewTl = view ? (view.turn <= turns.length ? turns[view.turn - 1].tl : (draft?.tl ?? null)) : null

  // Live feedback: the new command's stretch of the draft, at LIVE_SPEED.
  const live = (() => {
    if (!liveAnim || !draft || !schedule || running || inHistory) return null
    const plan = schedule.plans.find((p) => p.action === queue[liveAnim.index])
    if (!plan) return null
    const t0 = Math.min(plan.start, draft.tl.duration)
    const span = draft.tl.duration - t0
    const wall = clamp(span / LIVE_SPEED, 0.35, LIVE_MAX_S)
    const u = clamp((liveNow - liveAnim.startMs) / 1000 / wall, 0, 1)
    return { t0, t: t0 + span * u, u }
  })()
  useEffect(() => {
    if (liveAnim && (!live || live.u >= 1)) setLiveAnim(null)
  }, [liveAnim, live])

  // Moving frames (playback, live feedback, a scrub) hide the planning overlays.
  const frame =
    timeline && running
      ? sampleTimeline(timeline, progress * timeline.duration)
      : live && draft
        ? sampleTimeline(draft.tl, live.t)
        : scrubT !== null && draft
          ? sampleTimeline(draft.tl, scrubT * draft.tl.duration)
          : null
  // Still frames: a point looked back at, or — while planning — the queued turn's planned end.
  const stillFrame = frame ?? (view && viewTl ? sampleTimeline(viewTl, view.t) : !inHistory && draft ? sampleTimeline(draft.tl, draft.tl.duration) : null)
  const shownPositions = useMemo<Record<string, Pt>>(() => {
    if (!stillFrame) return basePositions
    const out: Record<string, Pt> = Object.fromEntries(Object.entries(stillFrame.players).map(([id, p]) => [id, [p.x, p.y] as Pt]))
    if (live && liveAnim && draft) {
      // ease out of what the pitch showed before the command (its stretch start may differ a little)
      const w = Math.max(0, 1 - live.u / 0.4) ** 2
      if (w > 0) {
        const s0 = sampleTimeline(draft.tl, live.t0).players
        for (const [id, p] of Object.entries(out)) {
          const prev = liveAnim.prev[id]
          const at0 = s0[id]
          if (prev && at0) out[id] = [p[0] + (prev[0] - at0.x) * w, p[1] + (prev[1] - at0.y) * w]
        }
      }
    }
    // the selected player stands where his next command starts (an AI-moved teammate goes back to his spot)
    if (!frame && !inHistory && selected && basePositions[selected] && !queue.some((a) => a.playerId === selected)) out[selected] = basePositions[selected]
    return out
  }, [stillFrame, frame, basePositions, live, liveAnim, draft, inHistory, selected, queue])

  const shownHolder = stillFrame ? stillFrame.ball.holder : holder

  // ⏪/▶️ tween the pitch between timeline points instead of teleporting — an instant flip to a
  // slightly different arrangement reads as nothing happening. Each step bumps tweenKey.
  const displayedRef = useRef<Record<string, Pt> | null>(null)
  const targetRef = useRef<Record<string, Pt> | null>(null)
  targetRef.current = shownPositions
  const [tweenKey, setTweenKey] = useState(0)
  const [animPositions, setAnimPositions] = useState<Record<string, Pt> | null>(null)
  const animRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (running || tweenKey === 0) return
    const from = displayedRef.current
    const target = targetRef.current
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
  }, [tweenKey])

  const renderPositions = !frame && animPositions ? animPositions : shownPositions
  displayedRef.current = renderPositions

  const shownBall: Pt | null = stillFrame && !(animPositions && !frame)
    ? [stillFrame.ball.x, stillFrame.ball.y]
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
      const actions = pendingPlayRef.current?.steps.at(-1)?.builder?.actions ?? plans.map((pl) => pl.action)
      const endPositions = positionsOf(timeline.end)
      const lastBall = timeline.frames.at(-1)?.ball
      // After a shot or a lost ball the ball returns to that player (Stefan: no turnover; play carries on).
      const override = returnToRef.current
      returnToRef.current = null
      const nextHolder = override ?? holderAfter(holder, actions)
      const returned = override !== null
      if (pendingPlayRef.current) setPlay(pendingPlayRef.current)
      pendingPlayRef.current = null
      const after = {
        state: timeline.end,
        ball: (lastBall && !returned ? [lastBall.x, lastBall.y] : (endPositions[nextHolder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2])) as Pt,
        holder: nextHolder ?? '',
      }
      setChain(after)
      setTurns((ts) => [...ts, { tl: timeline, plans, actions, startHolder: holder, after, goalAt: goalAtRef.current }])
      setHolder(nextHolder)
      setTurn((t) => t + 1)
      setQueue([])
      setTimeline(null)
      setPhase('plan')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, phase, timeline, play, holder])

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

  /** Queue a new command and play it out at once (live feedback). */
  const queueCommand = (action: BuilderAction) => {
    setQueue((q) => queueAction(q, action))
    setLiveAnim({ index: queue.length, prev: displayedRef.current ?? {}, startMs: performance.now() })
  }

  const onPlayerTap = (id: string) => {
    if (running || !play) return
    if (performance.now() - grabClickRef.current < 500) return // a disc drag just ended
    if (inHistory) {
      // A command at a point looked back at: play on from there.
      if (play.players.find((p) => p.id === id)?.team !== 'ours' || !view) return
      branchFrom(view)
      setSelected(id)
      return
    }
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
      queueCommand(pass)
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
        queueCommand({ kind: 'shot', playerId: selected, toX: target[0], toY: target[1] })
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
    queueCommand({ kind, playerId: selected, toX: to[0], toY: to[1] })
    // A dribbler stays selected: the next tap on a teammate passes from the dribble's end, the goal
    // mouth shoots from there (dribble → pass / dribble → shot in one turn).
    setSelected(kind === 'dribble' ? selected : null)
  }

  // ---- editing a queued action: grab its end ring (tap = edit, drag = move the end) ----
  const grabRef = useRef<{ index: number; pointerId: number; x: number; y: number; moved: boolean; disc?: boolean } | null>(null)
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
  /** `disc`: grabbed by the player's own disc (he stands on his run's end) — a plain tap still selects him. */
  const onGrabDown = (e: React.PointerEvent, index: number, disc = false) => {
    e.stopPropagation()
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      // capture can fail for exotic pointers; the drag still works per-event
    }
    grabRef.current = { index, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, disc }
  }
  /** The player's last run / dribble in the queue (where his disc rests while planning), or -1. */
  const lastMoveOf = (id: string) => queue.findLastIndex((a) => a.playerId === id && (a.kind === 'run' || a.kind === 'dribble'))
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
    if (g.disc && !g.moved) return // a tap on the disc: the click selects him as usual
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
    goalAtRef.current = goal ? goal.frameIndex * H : null
    setLiveAnim(null)
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

  // ---- the game timeline: look back, then branch on a command ----
  const canRewind = phase === 'plan' && markerIdx > 0
  const canForward = inHistory
  /** Look at marker `i` (the last one = now). */
  const goToMarker = (i: number, tween = true) => {
    setSelected(null)
    setLiveAnim(null)
    setView(i >= markers.length - 1 ? null : { turn: markers[i].turn, t: markers[i].t })
    if (tween) setTweenKey((k) => k + 1)
  }
  const rewind = () => {
    if (canRewind) goToMarker(markerIdx - 1)
  }
  const forward = () => {
    if (canForward) goToMarker(markerIdx + 1)
  }

  /** Play on from point `v`: later turns go, and so do the actions of v's turn that had not ended by
   *  then (the ones that had stay queued, to replay without dice). The toast offers Undo. */
  const branchFrom = (v: TimelinePoint) => {
    if (!play) return
    const before = { play, chain, turns, holder, turn, score, queue }
    setView(null)
    setLiveAnim(null)
    if (v.turn > turns.length) {
      // inside the draft: drop the queued actions that end later
      const kept = schedule ? actionsDoneBy(queue, schedule.plans, v.t) : []
      if (kept.length === queue.length) return
      setQueue(kept)
      setToast({ text: `Removed ${queue.length - kept.length} later action${queue.length - kept.length === 1 ? '' : 's'}`, undo: () => restore(before) })
      return
    }
    const tr = turns[v.turn - 1]
    const atEnd = atTurnEnd(turns, v)
    const keep = atEnd ? v.turn : v.turn - 1
    const after = keep > 0 ? turns[keep - 1].after : null
    setPlay({ ...play, steps: play.steps.slice(0, keep + 1) })
    setChain(after)
    setHolder(after ? after.holder || null : (play.steps[0]?.builder?.kickoffHolder ?? holder))
    setTurns(turns.slice(0, keep))
    setTurn(keep + 1)
    setScore(turns.slice(0, keep).filter((x) => x.goalAt !== null).length)
    setQueue(atEnd ? [] : actionsDoneBy(tr.actions, tr.plans, v.t))
    if (atEnd && keep === turns.length && queue.length === 0) return // already now: nothing removed
    setToast({
      text: `Playing on from ${keep === 0 && v.t === 0 ? 'kick-off' : `turn ${v.turn}`} — later moves removed`,
      undo: () => restore(before),
    })
  }
  const restore = (g: { play: Play; chain: typeof chain; turns: ResolvedTurn[]; holder: string | null; turn: number; score: number; queue: BuilderAction[] }) => {
    setPlay(g.play)
    setChain(g.chain)
    setTurns(g.turns)
    setHolder(g.holder)
    setTurn(g.turn)
    setScore(g.score)
    setQueue(g.queue)
    setView(null)
    setSelected(null)
    setToast(null)
  }

  // ---- timeline scrub & retime ----
  const tlTimeAt = (clientX: number): number => {
    const r = tlRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return clamp((clientX - r.left) / r.width, 0, 1)
  }
  const onTlPointerDown = (e: React.PointerEvent) => {
    if (!(view && viewTl) && !draft) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture can fail for exotic pointers; scrubbing still works per-event
    }
    // looking back: scrub within that turn (snaps to a step on release); now: peek into the draft
    if (view && viewTl) setView({ turn: view.turn, t: tlTimeAt(e.clientX) * viewTl.duration })
    else setScrubT(tlTimeAt(e.clientX))
  }
  const onTlPointerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    if (view && viewTl) setView({ turn: view.turn, t: tlTimeAt(e.clientX) * viewTl.duration })
    else if (draft) setScrubT(tlTimeAt(e.clientX))
  }
  const onTlPointerUp = () => {
    if (view) goToMarker(nearestMarker(markers, view), false)
  }

  // ---- the game strip: every turn side by side (equal widths), the draft last ----
  const stripRef = useRef<HTMLDivElement>(null)
  const stripTurns = turns.length + (draft ? 1 : 0)
  const durationOf = (turnNo: number) => (turnNo <= turns.length ? turns[turnNo - 1].tl.duration : (draft?.tl.duration ?? 1))
  const stripX = (p: TimelinePoint) => (stripTurns === 0 ? 0 : (p.turn - 1 + clamp(p.t / (durationOf(p.turn) || 1), 0, 1)) / stripTurns)
  const stripPoint = (clientX: number): TimelinePoint | null => {
    const r = stripRef.current?.getBoundingClientRect()
    if (!r || r.width === 0 || stripTurns === 0) return null
    const f = clamp((clientX - r.left) / r.width, 0, 0.99999) * stripTurns
    const turnNo = Math.floor(f) + 1
    return { turn: turnNo, t: (f - Math.floor(f)) * durationOf(turnNo) }
  }
  const onStripPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (phase !== 'plan') return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture can fail for exotic pointers; scrubbing still works per-event
    }
    const p = stripPoint(e.clientX)
    if (!p) return
    setSelected(null)
    setLiveAnim(null)
    setView(p)
  }
  const onStripPointerMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const p = stripPoint(e.clientX)
    if (p) setView(p)
  }
  const onStripPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    const p = stripPoint(e.clientX)
    if (p) goToMarker(nearestMarker(markers, p), false)
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
      : view
        ? viewMarker
          ? `${viewMarker.label === 'Kick-off' ? 'Kick-off' : `Turn ${view.turn} · after ${viewMarker.label}`} — tap a blue player to play on from here (later moves go), ▶ to return`
          : `Turn ${view.turn} · ${view.t.toFixed(1)}s`
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

  const compactControls = markers.length > 1

  // timeline lanes: the turn being looked at (a played one is read-only), else the draft; one row per
  // player that has actions, in order of first appearance
  const pastTurn = view && view.turn <= turns.length ? turns[view.turn - 1] : null
  const lanePlans = pastTurn ? pastTurn.plans : (schedule?.plans ?? [])
  const laneDuration = pastTurn ? pastTurn.tl.duration || 1 : tlDuration
  const showLanes = phase === 'plan' && (!!pastTurn || (!!schedule && queue.length > 0))
  const playheadS = view ? view.t : scrubSeconds
  const lanes: string[] = []
  for (const p of lanePlans) if (!lanes.includes(p.action.playerId)) lanes.push(p.action.playerId)
  // goals up to the point looked at
  const shownScore = view ? turns.filter((x, i) => i + 1 < view.turn || (i + 1 === view.turn && x.goalAt !== null && view.t >= x.goalAt)).filter((x) => x.goalAt !== null).length : score

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
            <div data-testid="score" aria-label={`${shownScore} goals`} className="rounded-full border border-white/10 bg-[var(--app-card)] px-3 py-1 text-sm font-semibold tabular-nums">
              ⚽ {shownScore}
            </div>
          )}
          <div data-testid="turn-counter" className="rounded-full border border-white/10 bg-[var(--app-card)] px-3 py-1 text-sm font-semibold">
            {phase === 'setup' ? 'Setup' : view ? `Turn ${view.turn}` : `Turn ${turn}`}
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
                pointerEvents={tappable || (isOurs && inHistory && !running) ? undefined : 'none'}
                // drag the disc of a player who runs / dribbles to move that move's end (he rests on it)
                onPointerDown={(e) => {
                  if (!tappable || phase !== 'plan') return
                  const i = lastMoveOf(p.id)
                  if (i >= 0) onGrabDown(e, i, true)
                }}
                onPointerMove={onGrabMove}
                onPointerUp={onGrabUp}
                onClick={(e) => {
                  if (!tappable && !(isOurs && inHistory)) return
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
              onClick={() => goToMarker(markers.length - 1)}
              data-testid="back-to-now"
              className="touch-manipulation rounded-full bg-[var(--app-accent)] px-5 py-2 text-xs font-bold text-[var(--app-accent-ink)] shadow-lg transition-all duration-100 active:scale-95"
            >
              Back to now
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
                <span className="text-xs text-[var(--app-muted)]">{viewMarker ? (viewMarker.label === 'Kick-off' ? 'Kick-off' : `Turn ${viewMarker.turn} · after ${viewMarker.label}`) : `Turn ${view?.turn}`}</span>
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

            {/* timeline: on top the game strip — every turn played plus the one being planned, a tick per
                action end; drag it or ⏪/▶️ to go back. Below, the lanes of the turn under the playhead:
                scrub to see any moment, drag a block of the planned turn to retime it. The box is always
                there at a fixed height (strip + two lanes; more scroll) so the pitch never moves. */}
            <div
              ref={tlRef}
              data-testid="turn-timeline"
              className="relative mb-2.5 touch-none select-none overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)]"
              style={{ height: TIMELINE_H }}
              onPointerDown={onTlPointerDown}
              onPointerMove={onTlPointerMove}
              onPointerUp={onTlPointerUp}
            >
              <div
                ref={stripRef}
                data-testid="game-strip"
                className="sticky top-0 z-10 flex border-b border-[var(--app-line)] bg-[var(--app-bg)]"
                style={{ height: STRIP_H }}
                onPointerDown={onStripPointerDown}
                onPointerMove={onStripPointerMove}
                onPointerUp={onStripPointerUp}
              >
                {stripTurns === 0 ? (
                  <span className="flex flex-1 items-center justify-center text-[9px] text-[var(--app-muted)]">Game timeline — each turn appears here</span>
                ) : (
                  Array.from({ length: stripTurns }, (_, i) => {
                    const isDraft = i === turns.length
                    const here = (view ? view.turn : stripTurns) === i + 1
                    return (
                      <div
                        key={i}
                        data-testid={`strip-turn-${i + 1}`}
                        className={`relative flex flex-1 items-center justify-center border-r border-white/10 text-[8px] font-bold leading-none ${isDraft ? 'bg-[#ffd43b]/10 text-[#ffd43b]' : here ? 'bg-white/10 text-[#e8edf2]' : 'text-[var(--app-muted)]'}`}
                      >
                        {stripTurns <= 12 || here ? (isDraft ? 'plan' : i + 1) : ''}
                        {turns[i]?.goalAt != null && <span className="absolute right-0.5 top-0 text-[7px]">⚽</span>}
                      </div>
                    )
                  })
                )}
                {/* step markers and the playhead */}
                {stripTurns > 0 &&
                  markers.map((m, i) => (
                    <div key={i} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-white/50" style={{ left: `${stripX(m) * 100}%` }} />
                  ))}
                {stripTurns > 0 && (
                  <div
                    data-testid="strip-playhead"
                    className="pointer-events-none absolute -bottom-px top-0 w-0.5 bg-[#ffd43b]"
                    style={{ left: `calc(${stripX(view ?? markers[markers.length - 1]) * 100}% - 1px)` }}
                  />
                )}
              </div>
              {showLanes ? (
                <div className="relative" style={{ height: Math.max(TIMELINE_H - 2 - STRIP_H, 22 + lanes.length * LANE_H) }}>
                {/* second ticks */}
                {Array.from({ length: Math.floor(laneDuration) }, (_, i) => i + 1).map((s) => (
                  <div key={s} className="absolute bottom-0 top-0 w-px bg-white/10" style={{ left: `${(s / laneDuration) * 100}%` }}>
                    <span className="absolute bottom-0 left-0.5 text-[8px] leading-none text-[var(--app-muted)]">{s}s</span>
                  </div>
                ))}
                {/* action blocks (a played turn's are read-only) */}
                {lanePlans.map((plan, i) => {
                  const lane = lanes.indexOf(plan.action.playerId)
                  const start = !view && blockDrag?.index === i ? blockDrag.start : plan.start
                  const w = Math.max(3, ((plan.end - plan.start) / laneDuration) * 100)
                  const active = playheadS !== null && playheadS >= start && playheadS <= start + (plan.end - plan.start)
                  return (
                    <div
                      key={i}
                      data-testid={`tl-block-${i}`}
                      className={`absolute flex h-4 items-center overflow-hidden whitespace-nowrap rounded px-1 text-[9px] font-bold leading-none text-[#0b1015] ${view ? 'pointer-events-none opacity-80' : 'cursor-grab'}`}
                      style={{
                        top: 3 + lane * LANE_H,
                        left: `${(start / laneDuration) * 100}%`,
                        width: `${w}%`,
                        background: BLOCK_COLORS[plan.action.kind],
                        outline: active ? '2px solid #ffd43b' : !view && (blockDrag?.index === i || queue[editing ?? -1] === plan.action) ? `2px solid ${EDIT}` : 'none',
                      }}
                      onPointerDown={view ? undefined : (e) => onBlockPointerDown(e, i, plan)}
                      onPointerMove={view ? undefined : onBlockPointerMove}
                      onPointerUp={view ? undefined : onBlockPointerUp}
                    >
                      {shortLabel(plan.action, labelOf)}
                    </div>
                  )
                })}
                {/* playhead */}
                {playheadS !== null && (
                  <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-[#ffd43b]" style={{ left: `${clamp(playheadS / laneDuration, 0, 1) * 100}%` }} />
                )}
                </div>
              ) : (
                <div className="flex items-center justify-center text-[10px] text-[var(--app-muted)] opacity-60" style={{ height: TIMELINE_H - 2 - STRIP_H }}>
                  {phase === 'plan' ? 'Queue an action — it plays out at once; scrub here, drag a block to retime' : ''}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* rewind controls, bottom-left; appear once there is history to walk. With them the row is
                  full at 375 px, so they are 40 px wide and Preview is icon-only — the trash stays on screen. */}
              {compactControls && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={rewind}
                    disabled={!canRewind}
                    aria-label="Rewind one action"
                    data-testid="rewind"
                    className="flex h-12 w-10 touch-manipulation items-center justify-center rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] transition-all duration-100 active:scale-95 disabled:opacity-35"
                  >
                    <SkipBack className="size-5" />
                  </button>
                  <span className="w-9 text-center text-xs font-semibold tabular-nums text-[var(--app-muted)]" data-testid="history-pos">
                    {Math.max(0, markerIdx) + 1}/{markers.length}
                  </span>
                  <button
                    onClick={forward}
                    disabled={!canForward}
                    aria-label="Forward one action"
                    data-testid="forward"
                    className="flex h-12 w-10 touch-manipulation items-center justify-center rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] transition-all duration-100 active:scale-95 disabled:opacity-35"
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
                className={`flex h-12 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] ${compactControls ? 'w-12' : 'px-3.5'} text-sm font-semibold text-[var(--app-muted)] transition-all duration-100 active:scale-95 disabled:opacity-35`}
              >
                {phase === 'preview' ? <Square className="size-4" /> : <Eye className="size-4" />}
                {!compactControls && (phase === 'preview' ? 'Stop' : 'Preview')}
              </button>
              <button
                onClick={() => beginTurn(true)}
                disabled={queue.length === 0 || phase !== 'plan' || inHistory}
                data-testid="play-turn"
                className="flex h-12 min-w-0 flex-1 touch-manipulation items-center justify-center gap-2 rounded-[14px] bg-[var(--app-accent)] text-base font-bold text-[var(--app-accent-ink)] transition-all duration-100 active:scale-[0.97] disabled:opacity-40"
              >
                <PlayIcon className="size-5 shrink-0" />
                {/* "Clear 4?" widens the trash; with the rewind controls there is room for the icon only */}
                {!(compactControls && confirmClear) && 'Play'}
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
                className={`flex h-12 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-[14px] border transition-all duration-100 active:scale-95 disabled:opacity-35 ${
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
