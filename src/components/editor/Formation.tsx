'use client'

// OPP formation ghosts: faint, label-less markers at the OPP starting positions (the shape they begin in),
// so the reader has a fixed reference while the real OPP players move. Toggled by the "Formation" button.

import { Users } from 'lucide-react'
import type { PlayerPosition } from '@/lib/types/play'
import { mToSvg } from '@/lib/engine/pitch'
import { useEditorStore } from '@/lib/store/editorStore'

/** SVG fragment: one semi-transparent red circle per OPP player at his formation (starting) position. */
export function FormationGhosts({ players }: { players: PlayerPosition[] }) {
  const show = useEditorStore((s) => s.showFormation)
  const opp = players.filter((p) => p.team === 'opp')
  if (!show || opp.length === 0) return null
  return (
    <g data-testid="formation-ghosts" pointerEvents="none" aria-hidden>
      {opp.map((p) => {
        const s = mToSvg(p.x, p.y)
        return (
          <circle key={p.id} data-testid="formation-ghost" cx={s.svgX} cy={s.svgY} r={20}
            fill="#e5484d" fillOpacity={0.2} stroke="#e5484d" strokeOpacity={0.4} strokeWidth={2} />
        )
      })}
    </g>
  )
}

/** Small "Formation" button for the top-right corner of the pitch. */
export function FormationToggle({ hasOpp }: { hasOpp: boolean }) {
  const show = useEditorStore((s) => s.showFormation)
  const set = useEditorStore((s) => s.setShowFormation)
  if (!hasOpp) return null
  return (
    <button
      type="button"
      data-testid="formation-toggle"
      aria-pressed={show}
      aria-label="Formation"
      onClick={() => set(!show)}
      className={`pointer-events-auto inline-flex touch-manipulation select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold shadow-lg backdrop-blur-md transition-all duration-100 active:scale-95 ${
        show
          ? 'border-[#e5484d]/60 bg-[rgba(60,16,20,0.85)] text-[#ffc9cc]'
          : 'border-white/10 bg-[rgba(11,16,21,0.88)] text-[var(--app-muted)]'
      }`}
    >
      <Users className="size-3.5" aria-hidden />
      Formation
    </button>
  )
}
