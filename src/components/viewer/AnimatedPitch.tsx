'use client'

// The animation engine (viewer mode) — ported from the futcal reference.
// 60fps requestAnimationFrame loop driving simulateStep(), trapezoid easing,
// pass flight, defender zone/mark AI. Scaffolded: full port coming next.

import { useEffect, useRef } from 'react'
import type { Play } from '@/lib/types/play'
import { X, Y } from '@/lib/engine/pitch'

interface AnimatedPitchProps {
  play: Play
  stepIndex: number
  isPlaying: boolean
  speed?: number
  onStepEnd?: () => void
}

export function AnimatedPitch({ play, isPlaying }: AnimatedPitchProps) {
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isPlaying) return
    const loop = () => {
      // TODO: advance time, run simulateStep, update player transforms
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying])

  return (
    <svg
      viewBox="0 0 580 890"
      className="w-full h-full max-h-[85vh] bg-emerald-900 rounded-lg"
      role="img"
      aria-label="Animated soccer play"
    >
      <rect x={20} y={40} width={520} height={830} fill="none" stroke="white" strokeOpacity={0.5} strokeWidth={2} />
      {play.players.map((p) => (
        <g key={p.id} transform={`translate(${X(p.x)}, ${Y(p.y)})`} opacity={p.isContext ? 0.4 : 1}>
          <circle r={14} fill={p.team === 'ours' ? '#3b82f6' : '#ef4444'} />
          <text textAnchor="middle" dy={5} fontSize={11} fill="white" fontWeight={700}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
