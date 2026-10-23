'use client'

/**
 * @description The editor's default bottom panel. A full-play timeline across every step, with the first
 * two indexes (SETUP) muted and the rest numbered, and a Play-all button that advances through them on a
 * timer. The pitch above does not change: this is a step-level slideshow of what the editor would be
 * showing anyway, not the frame-level animation of `AnimatedPitch` (preview mode).
 * @props { onEnterEdit: () => void }
 * @dataDependencies editorStore (play, currentStepIndex, setCurrentStep)
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Pencil, Play as PlayIcon, RotateCcw } from 'lucide-react'
import { useEditorStore } from '@/lib/store/editorStore'
import { haptic } from '@/lib/haptics'
import { BAR_HEIGHT } from './RunsPanel'
import { STRIP_HEIGHT } from './StepTextPanel'

/** Indexes 0 and 1 are the pre-play setup block: starting positions and the opening frame. 2+ are play. */
export const SETUP_COUNT = 2

/** How long each step is held before Play-all advances. ~1.5s reads as "slide" pace, not animation. */
const STEP_INTERVAL_MS = 1500

interface PlayModeBarProps {
  onEnterEdit: () => void
}

export function PlayModeBar({ onEnterEdit }: PlayModeBarProps) {
  const play = useEditorStore((s) => s.play)
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex)
  const setCurrentStep = useEditorStore((s) => s.setCurrentStep)

  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef<number | null>(null)

  const stop = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsPlaying(false)
  }

  // Clear on unmount so navigating away never leaves a stray timer firing step changes.
  useEffect(() => () => stop(), [])

  const stepsLength = play?.steps.length ?? 0
  const atStart = currentStepIndex <= 0
  const atEnd = currentStepIndex >= stepsLength - 1

  const start = () => {
    if (stepsLength === 0) return
    haptic(8)
    // Tapping Play at the end restarts from Setup; otherwise it picks up from where you are.
    const from = currentStepIndex >= stepsLength - 1 ? 0 : currentStepIndex
    if (from !== currentStepIndex) setCurrentStep(from)
    setIsPlaying(true)
    intervalRef.current = window.setInterval(() => {
      // Reading from the store keeps the timer in sync with manual jumps (tap another chip while playing).
      const i = useEditorStore.getState().currentStepIndex
      const next = i + 1
      if (next >= stepsLength) {
        stop()
      } else {
        setCurrentStep(next)
      }
    }, STEP_INTERVAL_MS)
  }

  const togglePlay = () => {
    if (isPlaying) {
      haptic(8)
      stop()
    } else {
      start()
    }
  }

  const goTo = (i: number) => {
    stop()
    haptic(8)
    setCurrentStep(i)
  }

  if (!play) return null

  const label = (i: number, title: string, isAlt: boolean, altLabel: string | undefined) => {
    if (i < SETUP_COUNT) return 'SETUP'
    // Play steps are 1-indexed from the first non-setup step: step 2 is play step "1", step 3 is "2", etc.
    const n = i - (SETUP_COUNT - 1)
    return isAlt ? (altLabel ?? `${n}`) : `${n}`
  }
  const ariaLabel = (i: number, title: string) =>
    i < SETUP_COUNT ? `Setup — ${title}` : `Step ${i - (SETUP_COUNT - 1)} — ${title}`

  return (
    <div className="relative shrink-0" data-testid="play-mode-bar">
      {/* The timeline. SETUP chips are muted and wider; play chips are the familiar numbered pills. */}
      <div
        data-testid="play-timeline"
        className="shrink-0 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-3 pt-2"
        style={{ height: STRIP_HEIGHT }}
      >
        <div className="flex items-center gap-1.5 overflow-x-auto pr-[72px]" role="group" aria-label="Full-play timeline">
          {play.steps.map((st, i) => {
            const setup = i < SETUP_COUNT
            const active = i === currentStepIndex
            return (
              <button
                key={st.id}
                type="button"
                data-testid={`play-step-chip-${i}`}
                aria-label={ariaLabel(i, st.title)}
                aria-current={active ? 'step' : undefined}
                onClick={() => goTo(i)}
                className={`h-9 shrink-0 touch-manipulation select-none rounded-full transition-all duration-100 active:scale-90 ${
                  setup
                    ? `min-w-[70px] px-3 text-[10px] font-bold uppercase tracking-wider ${
                        active
                          ? 'bg-white/15 text-[#e8edf2] ring-2 ring-[var(--app-accent)]'
                          : 'bg-white/5 text-[var(--app-muted)]'
                      }`
                    : `min-w-9 px-2.5 text-[13px] font-bold ${
                        active
                          ? 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]'
                          : 'bg-[var(--app-chip)] text-[#e8edf2]'
                      } ${st.isAltBranch ? 'border border-dashed border-[#4cc9f0]' : ''}`
                }`}
              >
                {label(i, st.title, !!st.isAltBranch, st.altLabel)}
              </button>
            )
          })}
        </div>
        {/* Edit toggle: pinned top-right so it is always findable regardless of how the timeline scrolls. */}
        <button
          type="button"
          data-testid="enter-edit"
          aria-label="Switch to Edit mode"
          onClick={() => { haptic(10); onEnterEdit() }}
          className="absolute right-2 top-2 flex h-7 touch-manipulation items-center gap-1 rounded-full border border-white/10 bg-[rgba(11,16,21,0.9)] px-2.5 text-[11px] font-semibold text-[#cbd5e1] shadow-sm backdrop-blur transition-all duration-100 hover:border-white/25 hover:bg-[rgba(11,16,21,0.95)] active:scale-95"
        >
          <Pencil className="size-3.5" aria-hidden />
          Edit
        </button>
      </div>

      {/* Playback controls. Play-all is the primary action; restart and prev/next sit beside it. */}
      <div
        role="group"
        aria-label="Playback controls"
        className="flex shrink-0 items-center gap-1.5 border-t border-[var(--app-line)] bg-[var(--bg-toolbar)] px-3"
        style={{ height: BAR_HEIGHT }}
      >
        <button
          type="button"
          data-testid="play-restart"
          aria-label="Restart from the beginning"
          onClick={() => goTo(0)}
          disabled={atStart && !isPlaying}
          className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-[10px] text-[#cbd5e1] transition-all duration-100 hover:bg-white/5 active:scale-95 active:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          <RotateCcw className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          data-testid="play-prev"
          aria-label="Previous step"
          onClick={() => goTo(Math.max(0, currentStepIndex - 1))}
          disabled={atStart}
          className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-[10px] text-[#cbd5e1] transition-all duration-100 hover:bg-white/5 active:scale-95 active:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <button
          type="button"
          data-testid="play-all"
          aria-label={isPlaying ? 'Pause' : 'Play all steps'}
          onClick={togglePlay}
          className="flex h-11 flex-1 touch-manipulation items-center justify-center gap-2 rounded-[10px] bg-[var(--app-accent)] px-4 text-sm font-bold text-[var(--app-accent-ink)] transition-all duration-100 active:scale-95 active:brightness-125"
        >
          {isPlaying ? <Pause className="size-5" aria-hidden /> : <PlayIcon className="size-5" aria-hidden />}
          {isPlaying ? 'Pause' : 'Play all'}
        </button>
        <button
          type="button"
          data-testid="play-next"
          aria-label="Next step"
          onClick={() => goTo(Math.min(stepsLength - 1, currentStepIndex + 1))}
          disabled={atEnd}
          className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-[10px] text-[#cbd5e1] transition-all duration-100 hover:bg-white/5 active:scale-95 active:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          <ChevronRight className="size-6" aria-hidden />
        </button>
      </div>
    </div>
  )
}
