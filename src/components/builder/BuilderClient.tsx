'use client'

/**
 * @description Turn-based play builder (/builder): designate a ball carrier in a setup phase, queue
 * passes / dribbles / runs for a turn, then play the turn — all actions animate simultaneously through
 * the step simulator while the full defensive AI (aggression, line height, width, gravity) moves the
 * opposition. The attacking AI (engine/attackingAI.ts) suggests support runs and spacing moves as
 * dashed green arrows — ✓ queues the run, × dismisses it for the turn. Every resolved action becomes
 * a rewind snapshot: ⏪ / ▶️ step through them read-only.
 * Mobile-first: turn counter top-right, rewind bottom-left, scrollable action queue at the bottom.
 * @props {}
 * @dataDependencies engine/turnBuilder, engine/simulator (simulateStep/sampleTimeline), engine/attackingAI, engine/defaultPlay
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CircleDot, Play as PlayIcon, SkipBack, SkipForward, Trash2, X } from 'lucide-react'
import type { Play } from '@/lib/types/play'
import { mToSvg, svgToFullM, PITCH_W, PITCH_H } from '@/lib/engine/pitch'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { initialState, sampleTimeline, simulateStep, type SimState, type StepTimeline } from '@/lib/engine/simulator'
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
  turnStep,
  PASS_RANGE_M,
  RUN_RANGE_M,
  type BuilderAction,
  type TurnSnapshot,
} from '@/lib/engine/turnBuilder'

type Pt = [number, number]
type Phase = 'setup' | 'plan' | 'playing'

const OURS = '#2f8cff'
const OPP = '#e5484d'
const BALL = '#ffd43b'
const GHOST = 'rgba(255, 215, 40, 0.75)'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pt = (x: number, y: number) => {
  const s = mToSvg(x, y)
  return { x: s.svgX, y: s.svgY }
}
const positionsOf = (state: SimState): Record<string, Pt> =>
  Object.fromEntries(Object.entries(state).map(([id, p]) => [id, [p.x, p.y] as Pt]))

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
  const [timeline, setTimeline] = useState<StepTimeline | null>(null)
  const [progress, setProgress] = useState(0)
  // Attacking-AI suggestions the user has waved away; cleared when a new turn starts.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  useEffect(() => setDismissed(new Set()), [turn])

  const svgRef = useRef<SVGSVGElement>(null)
  const actionsRef = useRef<BuilderAction[]>([])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2200)
    return () => clearTimeout(t)
  }, [flash])

  const labelOf = useCallback((id: string) => play?.players.find((p) => p.id === id)?.label ?? id, [play])

  // Positions being edited against (turn start): the last resolved state, or kick-off.
  const basePositions = useMemo<Record<string, Pt>>(() => {
    if (!play) return {}
    if (chain) return positionsOf(chain.state)
    return Object.fromEntries(play.players.map((p) => [p.id, [p.x, p.y] as Pt]))
  }, [play, chain])

  const inHistory = historyIdx !== null
  const viewSnapshot = inHistory ? history[historyIdx] : null

  // What the pitch shows right now: playback frame > history snapshot > planning state.
  const frame = timeline && phase === 'playing' ? sampleTimeline(timeline, progress * timeline.duration) : null
  const shownPositions = useMemo<Record<string, Pt>>(() => {
    if (frame) return Object.fromEntries(Object.entries(frame.players).map(([id, p]) => [id, [p.x, p.y] as Pt]))
    if (viewSnapshot) return viewSnapshot.positions
    return basePositions
  }, [frame, viewSnapshot, basePositions])

  // Attacking-AI suggestions (engine/attackingAI.ts): recomputed against the queued turn so a queued
  // pass yields the passer's support run; hidden mid-gesture (a player selected), in history and playback.
  const suggestions = useMemo(() => {
    if (!play || phase !== 'plan' || inHistory || selected) return []
    const draft = turnStep(queue, basePositions, play.steps.length)
    const holderPos = holder ? basePositions[holder] : null
    const state: PitchState = {
      players: play.players.map((p) => {
        const pos = basePositions[p.id] ?? [p.x, p.y]
        return { id: p.id, team: p.team, x: pos[0], y: pos[1] }
      }),
      ball: { x: holderPos?.[0] ?? PITCH_W / 2, y: holderPos?.[1] ?? PITCH_H / 2, holderId: holder },
      attackingTeam: 'ours',
    }
    return computeAutoMovements(draft, state, new Set()).filter((s) => !dismissed.has(s.playerId))
  }, [play, phase, inHistory, selected, queue, basePositions, holder, dismissed])

  const shownHolder = frame ? frame.ball.holder : viewSnapshot ? viewSnapshot.holder : holder

  // ⏪/▶️ tween the pitch between history states instead of teleporting — an instant flip to a
  // slightly different arrangement reads as nothing happening.
  const displayedRef = useRef<Record<string, Pt> | null>(null)
  const [animPositions, setAnimPositions] = useState<Record<string, Pt> | null>(null)
  const animRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (phase === 'playing') return
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

  // ---- playback loop ----
  useEffect(() => {
    if (phase !== 'playing' || !timeline || !play) return
    let raf = 0
    let last: number | null = null
    let p = 0
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000
      last = now
      p = Math.min(1, p + dt / timeline.duration)
      setProgress(p)
      if (p < 1) {
        raf = requestAnimationFrame(tick)
        return
      }
      // Turn resolved: commit end state, holder, per-action snapshots.
      const actions = actionsRef.current
      const startPositions = positionsOf(timeline.start)
      const endPositions = positionsOf(timeline.end)
      const lastBall = timeline.frames.at(-1)?.ball
      const nextHolder = holderAfter(holder, actions)
      setChain({
        state: timeline.end,
        ball: lastBall ? [lastBall.x, lastBall.y] : (endPositions[nextHolder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2]),
        holder: nextHolder ?? '',
      })
      setHistory((h) => [...h, ...buildSnapshots(turn, actions, startPositions, endPositions, holder, labelOf)])
      setHolder(nextHolder)
      setTurn((t) => t + 1)
      setQueue([])
      setTimeline(null)
      setPhase('plan')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, timeline, play, holder, turn, labelOf])

  // ---- interactions ----
  const toMeters = (e: { clientX: number; clientY: number }): Pt | null => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()?.inverse()
    if (!svg || !ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm)
    const m = svgToFullM(p.x, p.y)
    return [clamp(m.x, 2, PITCH_W - 2), clamp(m.y, 2, PITCH_H - 2)]
  }

  const onPlayerTap = (id: string) => {
    if (phase === 'playing' || inHistory || !play) return
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
    // A second player tapped: the ball carrier passes; anyone else just can't.
    if (allowedKinds(selected, holder).includes('pass')) {
      const pass: BuilderAction = { kind: 'pass', playerId: selected, to: id }
      if (!actionInRange(pass, basePositions)) {
        setFlash(`Too far — a pass can travel up to ${PASS_RANGE_M}m this turn`)
        return
      }
      setQueue((q) => queueAction(q, pass))
      setSelected(null)
    } else {
      setFlash(`${labelOf(selected)} doesn't have the ball — runs only`)
      setSelected(id)
    }
  }

  const onPitchTap = (e: React.MouseEvent) => {
    if (phase !== 'plan' || inHistory || !selected) return
    const m = toMeters(e)
    if (!m) return
    const kind = allowedKinds(selected, holder).includes('dribble') ? 'dribble' : 'run'
    const action: BuilderAction = { kind, playerId: selected, toX: m[0], toY: m[1] }
    // XCOM-style budget: outside the highlighted range the tap is refused, selection kept.
    if (!actionInRange(action, basePositions)) {
      setFlash(`Too far — ${labelOf(selected)} can ${kind === 'dribble' ? 'dribble' : 'run'} up to ${RUN_RANGE_M}m this turn`)
      return
    }
    setQueue((q) => queueAction(q, action))
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

  const playTurn = () => {
    if (!play || queue.length === 0 || phase !== 'plan' || inHistory) return
    const stepIndex = play.steps.length
    const step = turnStep(queue, basePositions, stepIndex)
    const nextPlay: Play = { ...play, steps: [...play.steps, step] }
    const start = chain ? chain.state : initialState(nextPlay)
    const startBall: Pt = chain ? chain.ball : (basePositions[holder ?? ''] ?? [PITCH_W / 2, PITCH_H / 2])
    const tl = simulateStep(nextPlay, stepIndex, start, holder, startBall)
    actionsRef.current = queue
    setPlay(nextPlay)
    setSelected(null)
    setTimeline(tl)
    setProgress(0)
    setPhase('playing')
  }

  // ---- rewind ----
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

  if (!play) return <div className="flex h-dvh items-center justify-center bg-[var(--app-bg)]" />

  const queuedTargets = queue.map((a) => {
    const from = basePositions[a.playerId]
    const to: Pt = a.kind === 'pass' ? (basePositions[a.to] ?? from) : [a.toX, a.toY]
    return { a, from, to }
  })

  const status =
    phase === 'setup'
      ? holder
        ? `${labelOf(holder)} starts with the ball — tap Start, or pick someone else`
        : 'Tap one of your (blue) players to give them the ball'
      : inHistory && viewSnapshot
        ? viewSnapshot.turn === 0
          ? 'History — Kick-off'
          : `History — Turn ${viewSnapshot.turn}, action ${viewSnapshot.actionIndex}/${viewSnapshot.actionCount}: ${viewSnapshot.label}`
        : phase === 'playing'
          ? 'Playing…'
          : selected
            ? allowedKinds(selected, holder).includes('pass')
              ? `${labelOf(selected)} has the ball — tap a teammate to pass, or dribble inside the highlighted area`
              : `${labelOf(selected)} — tap inside the highlighted area to queue a run`
            : 'Tap a blue player to select, then queue an action'

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
        <div data-testid="turn-counter" className="rounded-full border border-white/10 bg-[var(--app-card)] px-3 py-1 text-sm font-semibold">
          {phase === 'setup' ? 'Setup' : `Turn ${inHistory && viewSnapshot ? viewSnapshot.turn : turn}`}
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

          {/* XCOM-style movement range: the selected player can only move inside this area */}
          {selected && phase === 'plan' && !inHistory && basePositions[selected] && (() => {
            const c = pt(basePositions[selected][0], basePositions[selected][1])
            const r = RUN_RANGE_M * 10
            return (
              <g clipPath="url(#builder-pitch-clip)" pointerEvents="none" data-testid="move-range">
                <circle cx={c.x} cy={c.y} r={r} fill="rgba(76,201,240,0.13)" />
                <circle cx={c.x} cy={c.y} r={r} fill="none" stroke="rgba(76,201,240,0.55)" strokeWidth={2.5} strokeDasharray="10 8" />
              </g>
            )
          })()}

          {/* attacking-AI suggestions (dashed green) — ✓ queues the run, × dismisses it */}
          {suggestions.map((s) => {
            const from = basePositions[s.playerId]
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
                    const fp = basePositions[s.playerId]
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

          {/* queued ghost arrows */}
          {!frame &&
            !inHistory &&
            queuedTargets.map(({ a, from, to }, i) => {
              if (!from) return null
              const f = pt(from[0], from[1])
              const t = pt(to[0], to[1])
              const d = Math.hypot(t.x - f.x, t.y - f.y) || 1
              const ux = (t.x - f.x) / d
              const uy = (t.y - f.y) / d
              return (
                <g key={`${a.playerId}-${i}`} pointerEvents="none">
                  <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={GHOST} strokeWidth={3} strokeDasharray={a.kind === 'pass' ? '4 8' : '12 8'} />
                  <polyline
                    points={`${t.x - ux * 18 - uy * 9},${t.y - uy * 18 + ux * 9} ${t.x},${t.y} ${t.x - ux * 18 + uy * 9},${t.y - uy * 18 - ux * 9}`}
                    fill="none"
                    stroke={GHOST}
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  {a.kind !== 'pass' && <circle cx={t.x} cy={t.y} r={16} fill="none" stroke={GHOST} strokeWidth={2.5} strokeDasharray="5 4" />}
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
            const tappable = isOurs && phase !== 'playing' && !inHistory
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

        {flash && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="rounded-full bg-[rgba(11,16,21,0.9)] px-4 py-1.5 text-xs font-semibold text-[#ffd43b] shadow-lg backdrop-blur">
              {flash}
            </div>
          </div>
        )}
        {inHistory && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="rounded-full border border-white/10 bg-[rgba(11,16,21,0.9)] px-4 py-1.5 text-xs font-semibold text-[var(--app-muted)]">
              Read-only history view
            </div>
          </div>
        )}
      </div>

      {/* bottom panel: status, queue, controls */}
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
            <div className="no-scrollbar mb-2.5 flex min-h-[38px] items-center gap-1.5 overflow-x-auto" data-testid="action-queue">
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
                    {a.kind !== 'run' && <CircleDot className="size-3.5 text-[#ffd43b]" aria-hidden />}
                    {actionLabel(a, labelOf)}
                    <button
                      onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}
                      aria-label={`Remove ${actionLabel(a, labelOf)}`}
                      className="-mr-1 flex size-5 items-center justify-center rounded text-[var(--app-muted)] hover:text-red-400"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))
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
                onClick={playTurn}
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
