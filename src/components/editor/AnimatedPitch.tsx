'use client'

/**
 * @description Animated SVG pitch viewer with rAF-based playback engine
 * @props { play: Play; stepIndex: number; onStepChange?: (n: number) => void }
 * @dataDependencies useAnimationEngine
 */

import { useEffect, useState } from 'react'
import type { Play } from '@/lib/types/play'
import { mToSvg } from '@/lib/engine/pitch'
import { useAnimationEngine } from '@/lib/hooks/useAnimationEngine'
import { PitchMarkings } from './PitchMarkings'
import { PitchSurface } from './PitchSurface'
import { Button } from '@/components/ui/button'
import { CircleDot } from 'lucide-react'

interface AnimatedPitchProps {
  play: Play
  stepIndex: number
  onStepChange?: (n: number) => void
  /** Start playing on mount and whenever the step changes. Default true. */
  autoPlay?: boolean
  /** Leave present mode (shown as an Edit button in the bottom bar). */
  onExit?: () => void
  /** Render the playback bar in normal flow instead of fixed to the bottom of the phone frame. */
  inline?: boolean
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

export function AnimatedPitch({ play, stepIndex, onStepChange, autoPlay = true, onExit, inline = false }: AnimatedPitchProps) {
  const [speed, setSpeed] = useState(1)
  const engine = useAnimationEngine(play, stepIndex, speed)
  const { frame, isPlaying, progress } = engine
  const startPlayback = engine.play

  useEffect(() => {
    if (autoPlay) startPlayback()
  }, [autoPlay, play.id, stepIndex, startPlayback])

  const total = play.steps.length

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

  return (
    <div className="flex w-full flex-col gap-2" data-testid="animated-pitch">
      <div className="relative">
      <svg
        data-testid="animated-pitch-svg"
        viewBox="-20 -20 720 1090"
        className="mx-auto h-auto max-h-[75vh] w-full select-none rounded-lg bg-[var(--pitch)]"
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

        {frame?.players.map((p) => {
          const s = mToSvg(p.x, p.y)
          return (
            <g key={p.id} data-testid={`anim-player-${p.id}`} data-team={p.team} transform={`translate(${s.svgX}, ${s.svgY})`}>
              <circle r={20} fill={p.team === 'ours' ? '#2f8cff' : '#e5484d'} stroke="white" strokeWidth={2.5} />
              <text textAnchor="middle" dy={4} fontSize={12} fill="white" fontWeight={700} pointerEvents="none">
                {p.label}
              </text>
            </g>
          )
        })}

        {frame?.ball && (() => {
          const b = mToSvg(frame.ball.x, frame.ball.y)
          const lift = frame.ball.height ?? 0
          return (
            <g data-testid="ball" transform={`translate(${b.svgX + (frame.activePass ? 0 : 20)}, ${b.svgY + (frame.activePass ? 0 : 18)})`}>
              <circle r={15 + lift * 5} fill="none" stroke="#ffd43b" strokeWidth={3} className="ball-pulse" />
              <circle r={10 + lift * 5} fill="#fff" stroke="#111" strokeWidth={2.5} />
              <circle r={3.5 + lift * 2} fill="#111" />
            </g>
          )
        })()}
      </svg>
      {holderLabel && (
        <div data-testid="ball-chip" className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[rgba(11,16,21,0.88)] px-3 py-1 text-xs font-semibold text-[#e8edf2] shadow-lg backdrop-blur-md">
          <CircleDot className="size-3.5 text-[#ffd43b]" aria-hidden />
          Ball: {holderLabel}
        </div>
      )}
      </div>

      {/* Present mode: playback bar replaces the editor toolbar at the bottom of the screen. */}
      {!inline && <div className="h-28" aria-hidden />}
      <div
        className={
          inline
            ? 'flex w-full flex-col gap-2 rounded-lg bg-[var(--app-card)] p-3'
            : 'fixed bottom-0 left-1/2 z-20 flex w-full max-w-[390px] -translate-x-1/2 flex-col gap-2 border-t border-slate-800 bg-[var(--app-bg)]/95 p-3 backdrop-blur'
        }
        role="group"
        aria-label="Playback controls"
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
        <div className="flex items-center gap-2">
          <Button size="sm" data-testid="play-toggle" aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={isPlaying ? engine.pause : engine.play}>
            {isPlaying ? '⏸' : '▶'}
          </Button>
          <Button size="sm" variant="secondary" data-testid="reset" onClick={engine.reset}>Restart</Button>
          <Button size="sm" variant="ghost" data-testid="speed" aria-label={`Playback speed ${speed}x`}
            onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}>
            {speed}x
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous step" disabled={!onStepChange || stepIndex <= 0}
              onClick={() => onStepChange?.(stepIndex - 1)}>◀</Button>
            <span data-testid="anim-step-indicator" className="px-1 text-sm tabular-nums text-slate-300">
              Step {stepIndex + 1} of {total}
            </span>
            <Button size="sm" variant="ghost" aria-label="Next step" disabled={!onStepChange || stepIndex >= total - 1}
              onClick={() => onStepChange?.(stepIndex + 1)}>▶</Button>
          </div>
          {onExit && (
            <Button size="sm" variant="outline" data-testid="mode-select" onClick={onExit}>Edit</Button>
          )}
        </div>
      </div>
    </div>
  )
}
