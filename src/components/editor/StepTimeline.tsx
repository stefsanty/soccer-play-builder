'use client'

import type { ReactNode } from 'react'
import { Pause, Play as PlayIcon } from 'lucide-react'
import type { PlayStep } from '@/lib/types/play'
import type { AnimationEngine } from '@/lib/hooks/useAnimationEngine'

export const STEP_PANEL_HEIGHT = 124 // px (matches StepTextPanel)

interface StepTimelineProps {
  badge: string | number
  title: string
  stepLabel?: ReactNode
  step: PlayStep
  engine: AnimationEngine
  body?: ReactNode
}

export function StepTimeline({ badge, title, stepLabel, step, engine, body }: StepTimelineProps) {
  const dur = step.duration > 0 ? step.duration : 3

  const handleTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    engine.seek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
  }

  const handleTrackMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const rect = e.currentTarget.getBoundingClientRect()
    engine.seek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
  }

  return (
    <section
      data-testid="step-timeline"
      aria-label="Step timeline"
      className="flex shrink-0 flex-col border-t border-[var(--app-line)] bg-[var(--bg-base)] px-3 pt-2"
      style={{ height: STEP_PANEL_HEIGHT }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-start gap-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--app-accent)] text-[11px] font-bold text-[var(--app-accent-ink)]">
          {badge}
        </span>
        <h2 data-testid="step-title" className="m-0 line-clamp-2 min-w-0 flex-1 text-[17px] font-bold leading-[1.2] text-[#e8edf2]">
          {title}
        </h2>
        {stepLabel && <span className="mt-1 shrink-0 text-xs text-[var(--app-muted)]">{stepLabel}</span>}
      </div>

      {body ? (
        <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto pb-2 text-[13px] leading-[1.4]">
          {body}
        </div>
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 items-center gap-2 pb-2">
          {/* Play / pause */}
          <button
            type="button"
            aria-label={engine.isPlaying ? 'Pause' : 'Play step'}
            data-testid="timeline-play"
            onClick={engine.isPlaying ? engine.pause : engine.play}
            className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--app-accent-ink)] transition-all duration-100 active:scale-95"
          >
            {engine.isPlaying ? <Pause className="size-4" aria-hidden /> : <PlayIcon className="size-4" aria-hidden />}
          </button>

          {/* Track */}
          <div
            role="slider"
            aria-label="Timeline scrubber"
            aria-valuenow={Math.round(engine.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="relative flex-1 touch-none cursor-pointer overflow-hidden rounded-full"
            style={{ height: 24, backgroundColor: 'rgba(255,255,255,0.08)' }}
            onPointerDown={handleTrackDown}
            onPointerMove={handleTrackMove}
          >
            {/* Run blocks (yellow) */}
            {step.moves.map((m) => {
              const left = (m.startTime / dur) * 100
              const width = Math.max(1.5, ((m.endTime - m.startTime) / dur) * 100)
              return (
                <div
                  key={`run-${m.playerId}`}
                  className="absolute top-1 bottom-1 rounded-sm"
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: '#ffd43b', opacity: 0.75 }}
                />
              )
            })}
            {/* Pass blocks (white) */}
            {step.passes.map((p, i) => {
              const left = (p.startTime / dur) * 100
              const width = Math.max(1.5, ((p.endTime - p.startTime) / dur) * 100)
              return (
                <div
                  key={`pass-${i}`}
                  className="absolute top-1 bottom-1 rounded-sm"
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: 'rgba(255,255,255,0.72)' }}
                />
              )
            })}
            {/* Scrubber */}
            <div
              className="absolute top-0 bottom-0 w-0.5 rounded-full bg-white"
              style={{
                left: `${engine.progress * 100}%`,
                pointerEvents: 'none',
                boxShadow: '0 0 4px rgba(255,255,255,0.6)',
              }}
            />
          </div>

          {/* Time display */}
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--app-muted)]"
            style={{ minWidth: 64 }}
          >
            {engine.time.toFixed(1)}s&thinsp;/&thinsp;{dur.toFixed(1)}s
          </span>
        </div>
      )}
    </section>
  )
}
