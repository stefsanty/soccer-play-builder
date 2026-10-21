'use client'

/**
 * @description Animated SVG pitch viewer with rAF-based playback engine
 * @props { play: Play; stepIndex: number; onStepChange?: (n: number) => void }
 * @dataDependencies useAnimationEngine
 */

import { useEffect } from 'react'
import type { Play } from '@/lib/types/play'
import { mToSvg } from '@/lib/engine/pitch'
import { useAnimationEngine } from '@/lib/hooks/useAnimationEngine'
import { PitchMarkings } from './PitchMarkings'
import { Button } from '@/components/ui/button'

interface AnimatedPitchProps {
  play: Play
  stepIndex: number
  onStepChange?: (n: number) => void
  /** Start playing on mount and whenever the step changes. Default true. */
  autoPlay?: boolean
}

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

export function AnimatedPitch({ play, stepIndex, onStepChange, autoPlay = true }: AnimatedPitchProps) {
  const engine = useAnimationEngine(play, stepIndex)
  const { frame, isPlaying, progress } = engine
  const startPlayback = engine.play

  useEffect(() => {
    if (autoPlay) startPlayback()
  }, [autoPlay, play.id, stepIndex, startPlayback])

  const total = play.steps.length

  return (
    <div className="flex w-full flex-col gap-2" data-testid="animated-pitch">
      <svg
        data-testid="animated-pitch-svg"
        viewBox="-20 -20 720 1090"
        className="mx-auto h-auto max-h-[75vh] w-full select-none rounded-lg bg-emerald-700"
        role="img"
        aria-label="Animated soccer play"
      >
        <PitchMarkings />

        {frame?.runTrails.map((trail) => (
          <path
            key={`run-${trail.playerId}`}
            data-testid="run-trail"
            d={trailPath(trail.points, trail.progress)}
            fill="none"
            stroke="#fde047"
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
              <circle r={16} fill={p.team === 'ours' ? '#2563eb' : '#dc2626'} stroke="white" strokeWidth={2} />
              <text textAnchor="middle" dy={4} fontSize={11} fill="white" fontWeight={700} pointerEvents="none">
                {p.label}
              </text>
            </g>
          )
        })}

        {frame?.ball && (() => {
          const b = mToSvg(frame.ball.x, frame.ball.y)
          const lift = frame.ball.height ?? 0
          return (
            <g data-testid="ball">
              <circle cx={b.svgX} cy={b.svgY} r={7 + lift * 5} fill="#fefce8" stroke="#1e293b" strokeWidth={2} />
            </g>
          )
        })()}
      </svg>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Playback controls">
        <Button size="sm" data-testid="play-toggle" aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={isPlaying ? engine.pause : engine.play}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </Button>
        <Button size="sm" variant="secondary" data-testid="reset" onClick={engine.reset}>Reset</Button>
        <input
          type="range"
          data-testid="progress-bar"
          aria-label="Playback progress"
          className="min-w-32 flex-1 accent-emerald-500"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => engine.seek(Number(e.target.value) / 1000)}
        />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" aria-label="Previous step" disabled={!onStepChange || stepIndex <= 0}
            onClick={() => onStepChange?.(stepIndex - 1)}>◀</Button>
          <span data-testid="anim-step-indicator" className="px-1 text-sm tabular-nums">
            Step {stepIndex + 1} of {total}
          </span>
          <Button size="sm" variant="outline" aria-label="Next step" disabled={!onStepChange || stepIndex >= total - 1}
            onClick={() => onStepChange?.(stepIndex + 1)}>▶</Button>
        </div>
      </div>
    </div>
  )
}
