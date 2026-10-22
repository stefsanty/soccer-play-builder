'use client'

/**
 * @description Formation ghosts overlay and formation picker. FormationGhosts shows faint markers at
 * OPP starting positions. FormationToggle opens a picker to apply a standard formation to either team.
 * @props FormationGhosts: { players: PlayerPosition[] }; FormationToggle: { hasOpp: boolean }
 * @dataDependencies useEditorStore (showFormation, applyFormation)
 */

import { useState } from 'react'
import { Users } from 'lucide-react'
import type { PlayerPosition } from '@/lib/types/play'
import { mToSvg } from '@/lib/engine/pitch'
import { useEditorStore } from '@/lib/store/editorStore'
import { FORMATION_KEYS, type FormationKey } from '@/lib/engine/formations'

/** SVG fragment: one semi-transparent red circle per OPP player at their formation (starting) position. */
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

/** Formation picker button + dropdown panel for the top-right corner of the pitch. */
export function FormationToggle({ hasOpp }: { hasOpp: boolean }) {
  const show = useEditorStore((s) => s.showFormation)
  const setShow = useEditorStore((s) => s.setShowFormation)
  const applyFormation = useEditorStore((s) => s.applyFormation)
  const [open, setOpen] = useState(false)
  const [activeTeam, setActiveTeam] = useState<'ours' | 'opp'>('ours')

  function apply(f: FormationKey) {
    applyFormation(activeTeam, f)
    setOpen(false)
  }

  return (
    <div className="pointer-events-auto relative flex flex-col items-end gap-1">
      <button
        type="button"
        data-testid="formation-toggle"
        aria-pressed={open}
        aria-label="Formation picker"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex touch-manipulation select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold shadow-lg backdrop-blur-md transition-all duration-100 active:scale-95 ${
          open
            ? 'border-[var(--app-accent)]/60 bg-[rgba(11,16,21,0.92)] text-[var(--app-accent)]'
            : 'border-white/10 bg-[rgba(11,16,21,0.88)] text-[var(--app-muted)]'
        }`}
      >
        <Users className="size-3.5" aria-hidden />
        Formation
      </button>

      {open && (
        <div
          data-testid="formation-picker"
          className="flex w-56 flex-col gap-2 rounded-2xl border border-white/10 bg-[rgba(11,16,21,0.95)] p-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Team selector */}
          <div role="group" aria-label="Team" className="flex rounded-full bg-[var(--app-card)] p-0.5">
            {(['ours', 'opp'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={activeTeam === t}
                onClick={() => setActiveTeam(t)}
                className={`flex-1 rounded-full py-1 text-xs font-semibold transition-all duration-100 ${
                  activeTeam === t
                    ? t === 'ours' ? 'bg-[#2f8cff] text-white' : 'bg-[#e5484d] text-white'
                    : 'text-[var(--app-muted)]'
                }`}
              >
                {t === 'ours' ? 'Ours' : 'OPP'}
              </button>
            ))}
          </div>

          {/* Formation grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {FORMATION_KEYS.map((f) => (
              <button
                key={f}
                type="button"
                data-testid={`formation-${f}`}
                onClick={() => apply(f)}
                className="flex h-10 touch-manipulation items-center justify-center rounded-[10px] bg-[var(--app-card)] text-sm font-bold text-[#e8edf2] transition-all duration-100 hover:bg-[var(--app-accent)] hover:text-[var(--app-accent-ink)] active:scale-95"
              >
                {f}
              </button>
            ))}
          </div>

          {/* Ghost toggle row */}
          {hasOpp && (
            <button
              type="button"
              aria-pressed={show}
              onClick={() => setShow(!show)}
              className={`flex items-center justify-center gap-1.5 rounded-[10px] py-1.5 text-xs font-medium transition-all duration-100 ${
                show ? 'bg-[rgba(60,16,20,0.6)] text-[#ffc9cc]' : 'bg-[var(--app-card)] text-[var(--app-muted)]'
              }`}
            >
              <Users className="size-3.5" aria-hidden />
              {show ? 'Hide OPP ghosts' : 'Show OPP ghosts'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
