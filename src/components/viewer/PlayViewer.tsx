'use client'

/**
 * @description Shared-play viewer. Header with title + "Get the app"; pitch on the left with the current
 * step's headline and detail, step list on the right (branch options dashed and indented). Stacked on
 * mobile; on >=640px it breaks out of the 390px phone container.
 * @props { play: Play }
 */

import { useState } from 'react'
import Link from 'next/link'
import type { Play } from '@/lib/types/play'
import { AnimatedPitch } from '@/components/editor/AnimatedPitch'

export function PlayViewer({ play }: { play: Play }) {
  const [stepIndex, setStepIndex] = useState(0)
  const step = play.steps[stepIndex]
  const options = play.steps.filter((s) => s.isAltBranch).length
  const mainSteps = play.steps.length - options
  const meta = [
    play.authorName ? `Shared by ${play.authorName}.` : 'Shared play.',
    `${mainSteps} step${mainSteps === 1 ? '' : 's'}${options ? `, ${options} option${options === 1 ? '' : 's'}` : ''}.`,
  ].join(' ')
  const detail = step?.narrativeOurs.join(' ')

  return (
    <div
      data-testid="play-viewer"
      className="min-h-screen bg-[var(--app-bg)] text-[#e8edf2] sm:fixed sm:inset-0 sm:z-30 sm:overflow-auto"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-line)] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <svg width="32" height="32" viewBox="0 0 96 96" role="img" aria-label="App mark" className="shrink-0">
            <rect x="4" y="4" width="88" height="88" rx="20" fill="#2c7a3b" />
            <path d="M26 72 L62 34" stroke="#ffd43b" strokeWidth="6" strokeDasharray="8 6" fill="none" strokeLinecap="round" />
            <path d="M58 28 L70 26 L68 38 Z" fill="#ffd43b" />
            <circle cx="26" cy="72" r="9" fill="#2f8cff" stroke="#fff" strokeWidth="3" />
          </svg>
          <div className="flex min-w-0 flex-col">
            <h1 className="m-0 truncate text-lg font-bold">{play.title}</h1>
            <p className="m-0 text-[13px] text-[var(--app-muted)]">{meta}</p>
          </div>
        </div>
        <Link
          href="/"
          className="flex h-10 items-center rounded-[10px] border border-[#34455a] bg-[var(--app-card)] px-4 text-sm font-semibold whitespace-nowrap text-[#e8edf2] no-underline"
        >
          Get the app
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 p-4 sm:flex-row sm:flex-wrap sm:p-6">
        <section className="flex min-w-0 flex-col gap-3 sm:flex-[999_1_560px]">
          {step && <div className="text-[17px] font-semibold leading-[1.3]">{step.title}</div>}
          <AnimatedPitch play={play} stepIndex={stepIndex} onStepChange={setStepIndex} />
          {detail && <div className="text-[15px] leading-[1.3]">{detail}</div>}
          <div className="text-[13px] text-[var(--app-muted)]">Tap a step to play it.</div>
        </section>

        <aside data-testid="viewer-sidebar" className="flex min-w-0 flex-col gap-2.5 sm:flex-[1_1_300px]">
          <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--app-muted)]">Steps</h2>
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="viewer-step-list">
            {play.steps.map((s, i) => {
              const current = i === stepIndex
              const branch = !!s.isAltBranch
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStepIndex(i)}
                    aria-current={current ? 'step' : undefined}
                    className={`flex w-full touch-manipulation items-center gap-3 rounded-[10px] border py-2.5 pr-3 text-left text-sm text-[#e8edf2] transition-all duration-100 hover:brightness-125 active:scale-[0.98] ${
                      branch ? 'border-dashed border-[#4cc9f0] pl-9' : current ? 'border-[#4cc9f0] pl-3' : 'border-transparent pl-3'
                    } ${current ? 'bg-[#17303d]' : 'bg-[var(--app-card)]'}`}
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        current ? 'bg-[#4cc9f0] text-[#04202b]' : branch ? 'bg-[#1c242d]' : 'bg-[var(--app-chip)]'
                      }`}
                    >
                      {branch ? (s.altLabel ?? i) : i}
                    </span>
                    {s.title}
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="mt-2 rounded-xl bg-[var(--app-card)] p-3.5 text-[13px] leading-[1.45] text-[var(--app-muted)]">
            This play was shared with a link. Nothing to install. To make your own plays, get the app.
          </p>
        </aside>
      </div>
    </div>
  )
}
