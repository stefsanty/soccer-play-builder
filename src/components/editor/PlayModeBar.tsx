'use client'

/**
 * @description The editor's default bottom panel. A full-play timeline across every step, with step 0
 * (SETUP) muted and the rest numbered, and a Play-all button that chain-plays each step's animation
 * end to end (step 1, then step 2, …). Chain-play is driven by `isPlayingAll` in the store: PitchEditor
 * swaps the static pitch for an `AnimatedPitch` when it is true, and PlayModeBar advances the step
 * when PitchEditor's `onComplete` lands.
 * @props { onEnterEdit: () => void }
 * @dataDependencies editorStore (play, currentStepIndex, setCurrentStep, isPlayingAll, setPlayingAll)
 */

import { ChevronLeft, ChevronRight, Pause, Pencil, Play as PlayIcon, RotateCcw } from 'lucide-react'
import { useEditorStore } from '@/lib/store/editorStore'
import { haptic } from '@/lib/haptics'
import { BAR_HEIGHT } from './RunsPanel'
import { STRIP_HEIGHT } from './StepTextPanel'

/** How many leading step indexes are the pre-play setup block (starting positions). The rest are play. */
export const SETUP_COUNT = 1

interface PlayModeBarProps {
  onEnterEdit: () => void
}

export function PlayModeBar({ onEnterEdit }: PlayModeBarProps) {
  const play = useEditorStore((s) => s.play)
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex)
  const setCurrentStep = useEditorStore((s) => s.setCurrentStep)
  const isPlayingAll = useEditorStore((s) => s.isPlayingAll)
  const setPlayingAll = useEditorStore((s) => s.setPlayingAll)

  const stepsLength = play?.steps.length ?? 0
  const firstPlayStep = Math.min(SETUP_COUNT, Math.max(0, stepsLength - 1))
  const atStart = currentStepIndex <= 0
  const atEnd = currentStepIndex >= stepsLength - 1

  // Start chain-play from step 1 (first play step). PitchEditor sees isPlayingAll and renders
  // AnimatedPitch; its onComplete advances the step; the chain stops at the last step on its own.
  const startPlayAll = () => {
    if (stepsLength <= firstPlayStep) return
    haptic(8)
    if (currentStepIndex !== firstPlayStep) setCurrentStep(firstPlayStep)
    setPlayingAll(true)
  }

  const togglePlay = () => {
    if (isPlayingAll) {
      haptic(8)
      setPlayingAll(false)
    } else {
      startPlayAll()
    }
  }

  const goTo = (i: number) => {
    if (isPlayingAll) setPlayingAll(false)
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
    <div className="shrink-0" data-testid="play-mode-bar">
      {/* The timeline. SETUP chip is muted and wider; play chips are the familiar numbered pills. Edit
          sits in the same row, outside the scrollable chip area, so it never covers a chip and the
          chips never scroll under it. */}
      <div
        data-testid="play-timeline"
        className="shrink-0 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-3 pt-2"
        style={{ height: STRIP_HEIGHT }}
      >
        <div className="flex h-full items-center gap-2">
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" role="group" aria-label="Full-play timeline">
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
          <button
            type="button"
            data-testid="enter-edit"
            aria-label="Switch to Edit mode"
            onClick={() => { haptic(10); onEnterEdit() }}
            className="flex h-9 shrink-0 touch-manipulation items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 text-[11px] font-semibold text-[#cbd5e1] transition-all duration-100 hover:border-white/25 hover:bg-white/10 active:scale-95"
          >
            <Pencil className="size-3.5" aria-hidden />
            Edit
          </button>
        </div>
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
          disabled={atStart && !isPlayingAll}
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
          aria-label={isPlayingAll ? 'Pause' : 'Play all steps'}
          onClick={togglePlay}
          className="flex h-11 flex-1 touch-manipulation items-center justify-center gap-2 rounded-[10px] bg-[var(--app-accent)] px-4 text-sm font-bold text-[var(--app-accent-ink)] transition-all duration-100 active:scale-95 active:brightness-125"
        >
          {isPlayingAll ? <Pause className="size-5" aria-hidden /> : <PlayIcon className="size-5" aria-hidden />}
          {isPlayingAll ? 'Pause' : 'Play all'}
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
