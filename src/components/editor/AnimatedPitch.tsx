'use client'

/**
 * @description Animated SVG pitch with an rAF-based playback engine and a playback bar.
 * `fill` renders it as Play mode of the editor: the same pitch wrapper, graphics and overlay as the
 * edit view, with the playback bar in the slot the step bar occupies in Edit mode. Without `fill` it
 * is a self-contained block (shared-play viewer).
 * @props { play: Play; stepIndex: number; onStepChange?: (n: number) => void; fill?: boolean }
 * @dataDependencies useAnimationEngine
 */

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleDot, Gauge, Pause, Play as PlayIcon, RotateCcw } from 'lucide-react'
import type { Play } from '@/lib/types/play'
import { mToSvg } from '@/lib/engine/pitch'
import { useAnimationEngine } from '@/lib/hooks/useAnimationEngine'
import { PitchMarkings } from './PitchMarkings'
import { PitchSurface } from './PitchSurface'
import { StepNote } from './StepNote'

interface AnimatedPitchProps {
  play: Play
  stepIndex: number
  onStepChange?: (n: number) => void
  /** Start playing on mount and whenever the step changes. Default true. */
  autoPlay?: boolean
  /** Fill the parent (editor Play mode) instead of sizing itself (viewer). */
  fill?: boolean
}

const SPEEDS = [0.5, 1, 1.5, 2]

type Pt = [number, number]
const svg = (p: Pt) => mToSvg(p[0], p[1])
const lerpPt = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** Polyline through `points`, truncated to the first `progress` share of its length. */
function trailPath(points: Pt[], progress: number): string {
  const pts = points.map(svg).map((p) => [p.svgX, p.svgY] as Pt)
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  let remaining = lens.reduce((a, b) => a + b, 0) * progress
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const len = lens[i - 1]
    if (len === 0) continue
    const f = Math.min(1, remaining / len)
    const q = lerpPt(pts[i - 1], pts[i], f)
    d += ` L ${q[0]} ${q[1]}`
    remaining -= len
    if (remaining <= 0) break
  }
  return d
}

const ctrl =
  'flex h-11 touch-manipulation select-none flex-col items-center justify-center gap-0.5 rounded-[10px] text-[10px] font-medium transition-all duration-100 active:scale-95 disabled:opacity-40 disabled:active:scale-100'

export function AnimatedPitch({ play, stepIndex, onStepChange, autoPlay = true, fill = false }: AnimatedPitchProps) {
  const [speed, setSpeed] = useState(1)
  const engine = useAnimationEngine(play, stepIndex, speed)
  const { frame, isPlaying, progress } = engine
  const startPlayback = engine.play

  useEffect(() => {
    if (autoPlay) startPlayback()
  }, [autoPlay, play.id, stepIndex, startPlayback])

  const total = play.steps.length
  const step = play.steps[stepIndex]

  // Who has the ball right now: nobody while a pass is in flight, otherwise the player standing on it.
  const holderLabel = (() => {
    if (!frame?.ball) return null
    if (frame.activePass) return 'in flight'
    const b = frame.ball
    let best: { label: string; d: number } | null = null
    for (const p of frame.players) {
      const d = Math.hypot(p.x - b.x, p.y - b.y)
      if (!best || d < best.d) best = { label: p.label, d }
    }
    return best && best.d < 2 ? best.label : null
  })()

  const ballChip = holderLabel && (
    <div
      data-testid="ball-chip"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[rgba(11,16,21,0.88)] px-3 py-1 text-xs font-semibold text-[#e8edf2] shadow-lg backdrop-blur-md"
    >
      <CircleDot className="size-3.5 text-[#ffd43b]" aria-hidden />
      Ball: {holderLabel}
    </div>
  )

  const pitch = (
    <svg
      data-testid="animated-pitch-svg"
      viewBox="-20 -20 720 1090"
      preserveAspectRatio="xMidYMin meet"
      className={fill ? 'block h-full w-full select-none' : 'mx-auto h-auto max-h-[75vh] w-full select-none rounded-lg bg-[var(--pitch)]'}
      role="img"
      aria-label="Animated soccer play"
    >
      <PitchSurface />
      <PitchMarkings />

      {frame?.runTrails.map((trail) => (
        <path
          key={`run-${trail.playerId}`}
          data-testid="run-trail"
          d={trailPath(trail.points, trail.progress)}
          fill="none"
          stroke="#ffd43b"
          strokeWidth={3}
          strokeDasharray="8 6"
          strokeLinecap="round"
        />
      ))}

      {frame?.activePass && (() => {
        const a = svg(frame.activePass.from)
        const tip = svg(lerpPt(frame.activePass.from, frame.activePass.to, frame.activePass.progress))
        return (
          <line data-testid="pass-line" x1={a.svgX} y1={a.svgY} x2={tip.svgX} y2={tip.svgY}
            stroke="white" strokeWidth={3} strokeLinecap="round" />
        )
      })()}

      {/* Players are display-only in Play mode: no handlers, no hover/selection states. */}
      {frame?.players.map((p) => {
        const s = mToSvg(p.x, p.y)
        return (
          <g key={p.id} data-testid={`anim-player-${p.id}`} data-team={p.team} transform={`translate(${s.svgX}, ${s.svgY})`} pointerEvents="none">
            <circle r={20} fill={p.team === 'ours' ? '#2f8cff' : '#e5484d'} stroke="white" strokeWidth={2.5} />
            <text textAnchor="middle" dy={4} fontSize={12} fill="white" fontWeight={700}>
              {p.label}
            </text>
          </g>
        )
      })}

      {frame?.ball && (() => {
        const b = mToSvg(frame.ball.x, frame.ball.y)
        const lift = frame.ball.height ?? 0
        return (
          <g data-testid="ball" pointerEvents="none" transform={`translate(${b.svgX + (frame.activePass ? 0 : 20)}, ${b.svgY + (frame.activePass ? 0 : 18)})`}>
            <circle r={15 + lift * 5} fill="none" stroke="#ffd43b" strokeWidth={3} className="ball-pulse" />
            <circle r={10 + lift * 5} fill="#fff" stroke="#111" strokeWidth={2.5} />
            <circle r={3.5 + lift * 2} fill="#111" />
          </g>
        )
      })()}
    </svg>
  )

  const controls = (
    <div
      role="group"
      aria-label="Playback controls"
      className={
        fill
          ? 'absolute inset-x-3 bottom-3 rounded-2xl border border-white/10 bg-[rgba(11,16,21,0.92)] p-2 shadow-2xl backdrop-blur-md'
          : 'rounded-lg bg-[var(--app-card)] p-3'
      }
    >
      <input
        type="range"
        data-testid="progress-bar"
        aria-label="Playback progress"
        className="w-full accent-[#4cc9f0]"
        min={0}
        max={1000}
        value={Math.round(progress * 1000)}
        onChange={(e) => engine.seek(Number(e.target.value) / 1000)}
      />
      <div className="mt-0.5 flex items-center justify-between text-xs text-[var(--app-muted)]">
        <span data-testid="anim-step-indicator" className="tabular-nums">
          Step {stepIndex + 1} of {total}
        </span>
        <span className="min-w-0 truncate pl-3">{step?.title}</span>
      </div>

      <div className="mt-2 grid grid-cols-5 gap-1">
        <button type="button" data-testid="reset" aria-label="Restart" onClick={engine.reset}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <RotateCcw className="size-5" aria-hidden />
          Restart
        </button>
        <button type="button" aria-label="Previous step" disabled={!onStepChange || stepIndex <= 0}
          onClick={() => onStepChange?.(stepIndex - 1)}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <ChevronLeft className="size-5" aria-hidden />
          Prev
        </button>
        <button type="button" data-testid="play-toggle" aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={isPlaying ? engine.pause : engine.play}
          className={`${ctrl} bg-[var(--app-accent)] text-[var(--app-accent-ink)] active:brightness-125`}>
          {isPlaying ? <Pause className="size-5" aria-hidden /> : <PlayIcon className="size-5" aria-hidden />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" aria-label="Next step" disabled={!onStepChange || stepIndex >= total - 1}
          onClick={() => onStepChange?.(stepIndex + 1)}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <ChevronRight className="size-5" aria-hidden />
          Next
        </button>
        <button type="button" data-testid="speed" aria-label={`Playback speed ${speed}x`}
          onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <Gauge className="size-5" aria-hidden />
          {speed}x
        </button>
      </div>
    </div>
  )

  // Same strip as the Edit-mode step bar (same slot, same height): one pill per step.
  const stepBar = (
    <div data-testid="step-bar" className={fill ? 'shrink-0 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-3 pt-2' : 'rounded-lg bg-[var(--app-card)] p-3'}>
      {/* Step bubbles: same pills as the Edit-mode step bar. */}
      <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Steps">
        {play.steps.map((st, i) => (
          <button
            key={st.id}
            type="button"
            data-testid={`anim-step-chip-${i}`}
            aria-label={`Step ${i}`}
            aria-current={i === stepIndex ? 'step' : undefined}
            disabled={!onStepChange}
            onClick={() => onStepChange?.(i)}
            className={`h-9 min-w-9 shrink-0 touch-manipulation select-none rounded-full px-2 text-[13px] font-bold transition-all duration-100 active:scale-90 ${
              i === stepIndex ? 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]' : 'bg-[var(--app-chip)] text-[#e8edf2]'
            }`}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  )

  if (fill) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col" data-testid="animated-pitch">
        <div className="relative min-h-0 flex-1 bg-[var(--pitch)]">
          {pitch}
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-center gap-2">
            {step && <StepNote key={step.id} index={stepIndex} title={step.title} detail={step.narrativeOurs.join(' ')} />}
            {ballChip}
          </div>
          {controls}
        </div>
        {stepBar}
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2" data-testid="animated-pitch">
      <div className="relative">
        {pitch}
        {holderLabel && <div className="pointer-events-none absolute left-3 top-3">{ballChip}</div>}
      </div>
      {controls}
      {stepBar}
    </div>
  )
}
