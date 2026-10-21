'use client'

/**
 * @description Shared-play viewer. Stacked on mobile; on >=640px the pitch sits left and a
 * sidebar (title, author, step list) sits right, breaking out of the 390px phone container.
 * @props { play: Play }
 */

import { useState } from 'react'
import type { Play } from '@/lib/types/play'
import { AnimatedPitch } from '@/components/editor/AnimatedPitch'

export function PlayViewer({ play }: { play: Play }) {
  const [stepIndex, setStepIndex] = useState(0)

  return (
    <div
      data-testid="play-viewer"
      className="min-h-screen bg-[var(--app-bg)] text-white sm:fixed sm:inset-0 sm:z-30 sm:overflow-auto"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col sm:flex-row sm:gap-6 sm:p-6">
        <section className="min-w-0 flex-1 p-3 sm:p-0">
          <AnimatedPitch play={play} stepIndex={stepIndex} onStepChange={setStepIndex} inline />
        </section>

        <aside
          data-testid="viewer-sidebar"
          className="flex flex-col gap-4 p-4 sm:w-80 sm:shrink-0 sm:self-start sm:rounded-xl sm:bg-[var(--app-card)]"
        >
          <div>
            <h1 className="text-xl font-bold">{play.title}</h1>
            <p className="text-xs text-slate-400">by {play.authorName}</p>
            {play.description && <p className="mt-2 text-sm text-slate-300">{play.description}</p>}
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-300">Steps</h2>
            <ol className="flex flex-col gap-1" data-testid="viewer-step-list">
              {play.steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStepIndex(i)}
                    aria-current={i === stepIndex ? 'step' : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      i === stepIndex
                        ? 'bg-[#14b8a6] font-semibold text-[#0f172a]'
                        : 'bg-[var(--app-bg)] text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {i + 1}. {s.title}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  )
}
