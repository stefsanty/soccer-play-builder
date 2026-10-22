'use client'

// The step's text, below the pitch: step title (large, bold) and the text lines (small, scrollable).
// Same fixed-height panel in Edit and Play mode, so the pitch above it never changes size when you switch.
// `body` replaces the text (Edit mode uses it for the run list).

import type { ReactNode } from 'react'

export const STEP_PANEL_HEIGHT = 124 // px

interface StepTextPanelProps {
  badge: string | number
  title: string
  /** e.g. "Step 5 of 5" */
  stepLabel?: ReactNode
  ours: string[]
  opp: string[]
  body?: ReactNode
}

export function StepTextPanel({ badge, title, stepLabel, ours, opp, body }: StepTextPanelProps) {
  return (
    <section
      data-testid="step-text-panel"
      aria-label="Step notes"
      className="flex shrink-0 flex-col border-t border-[var(--app-line)] bg-[var(--bg-base)] px-3 pt-2"
      style={{ height: STEP_PANEL_HEIGHT }}
    >
      <div className="flex shrink-0 items-start gap-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--app-accent)] text-[11px] font-bold text-[var(--app-accent-ink)]">
          {badge}
        </span>
        <h2 data-testid="step-title" className="m-0 line-clamp-2 min-w-0 flex-1 text-[17px] font-bold leading-[1.2] text-[#e8edf2]">
          {title}
        </h2>
        {stepLabel && <span className="mt-1 shrink-0 text-xs text-[var(--app-muted)]">{stepLabel}</span>}
      </div>
      <div data-testid="step-text" className="mt-1.5 min-h-0 flex-1 overflow-y-auto pb-2 text-[13px] leading-[1.4]">
        {body ?? (
          <>
            {ours.length === 0 && opp.length === 0 && <p className="m-0 text-[var(--app-muted)]">No notes for this step.</p>}
            {ours.map((line, i) => (
              <p key={`o${i}`} className="m-0 mb-1 text-[#cbd5e1]">{line}</p>
            ))}
            {opp.map((line, i) => (
              <p key={`p${i}`} className="m-0 mb-1 text-[#ff9aa0]">
                <span className="font-semibold">Opponent: </span>
                {line}
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  )
}
