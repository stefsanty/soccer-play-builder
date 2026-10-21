'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

/** Step note pill over the pitch: step number badge + title; tap to expand the detail line. */
export function StepNote({ index, title, detail }: { index: number; title: string; detail: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`Step ${index} notes: tap to ${open ? 'collapse' : 'expand'}`}
      data-testid="step-note"
      onClick={() => setOpen((o) => !o)}
      className={`pointer-events-auto flex w-full touch-manipulation select-none items-start gap-2.5 border border-white/10 transition-[border-radius,transform] duration-100 active:scale-[0.98] bg-[rgba(11,16,21,0.88)] py-2 pl-[9px] pr-3 text-left text-[13px] font-medium leading-[1.35] text-[#e8edf2] shadow-xl backdrop-blur-md ${
        open ? 'rounded-[14px]' : 'rounded-[20px]'
      }`}
    >
      <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[var(--app-accent)] text-[11px] font-bold text-[var(--app-accent-ink)]">{index}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px] pt-0.5">
        <span className={`font-semibold ${open ? '' : 'truncate'}`}>{title}</span>
        {open && <span className="text-[12.5px] font-normal leading-[1.4] text-[var(--app-muted)]">{detail || 'No notes for this step.'}</span>}
      </span>
      <ChevronDown className={`mt-[3px] size-4 shrink-0 text-[var(--app-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
    </button>
  )
}
