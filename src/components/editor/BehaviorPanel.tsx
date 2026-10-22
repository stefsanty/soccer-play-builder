'use client'

// Edit-mode "Behavior" panel: the defensive-AI controls for one step, per team.
//   - an on/off switch for the team's defensive AI
//   - quick-set presets Low / Mid / High (aggressiveness 20/50/80, line height 30/50/70, width 40/50/60); moving any
//     slider turns the presets into a "Custom" pill
//   - three sliders (aggressiveness, line height, width) with a live helper line
// Every change goes straight into the play, so the pitch behind the panel re-simulates as you drag.

import { useState } from 'react'
import { X } from 'lucide-react'
import type { AiConfig, PlayStep } from '@/lib/types/play'
import { PRESETS, resolveAiParams, type Intensity } from '@/lib/engine/ai'
import { useEditorStore } from '@/lib/store/editorStore'
import { BAR_HEIGHT } from './RunsPanel'
import { STEP_PANEL_HEIGHT, STRIP_HEIGHT } from './StepTextPanel'

/** The panel replaces the text panel, step strip and bottom bar, so the pitch above never changes size. */
export const BEHAVIOR_HEIGHT = STEP_PANEL_HEIGHT + STRIP_HEIGHT + BAR_HEIGHT

type Team = 'ours' | 'opp'
type SliderKey = 'aggressiveness' | 'lineHeight' | 'width'

const helper: Record<SliderKey, (v: number) => string> = {
  aggressiveness: (v) => (v <= 30 ? 'Holds shape, no individual pressing' : v <= 60 ? 'One presser breaks, rest hold' : 'Multiple players press, gaps in behind'),
  lineHeight: (v) => (v <= 30 ? 'Defends the box' : v <= 60 ? 'Mid-block' : 'High press line'),
  width: () => 'How far wide players hold the width of the formation',
}

const SLIDERS: { key: SliderKey; label: string; scale: string }[] = [
  { key: 'aggressiveness', label: 'Aggressiveness', scale: 'Compact ←→ Press' },
  { key: 'lineHeight', label: 'Line height', scale: 'Deep ←→ High' },
  { key: 'width', label: 'Width', scale: 'Narrow ←→ Wide' },
]

const seg = 'flex h-8 touch-manipulation select-none items-center justify-center rounded-full px-3 text-xs font-semibold transition-all duration-100 active:scale-95'

export function BehaviorPanel({ step, stepIndex, onClose }: { step: PlayStep; stepIndex: number; onClose: () => void }) {
  const updateStepAi = useEditorStore((s) => s.updateStepAi)
  const [team, setTeam] = useState<Team>('opp')

  const cfg: AiConfig | undefined = step.ai?.[team]
  const on = !!cfg?.on
  const p = resolveAiParams(cfg ?? {})
  const values: Record<SliderKey, number> = { aggressiveness: p.aggressiveness, lineHeight: p.lineHeight, width: p.width }
  const touched = !!cfg && (cfg.aggressiveness !== undefined || cfg.lineHeight !== undefined || cfg.width !== undefined)
  // presets show while the config is a preset (or untouched, which is "Mid"); once a slider moves it is "Custom"
  const custom = !cfg?.intensity && touched

  const patch = (u: Partial<AiConfig>) => updateStepAi(stepIndex, team, u)
  const applyPreset = (name: Intensity) => patch({ intensity: name, ...PRESETS[name] })
  const setSlider = (key: SliderKey, v: number) =>
    // materialise the current values first, so moving one slider never changes the other two
    patch({ aggressiveness: p.aggressiveness, lineHeight: p.lineHeight, width: p.width, [key]: v, intensity: undefined })

  return (
    <section
      data-testid="behavior-panel"
      aria-label="Defense AI behavior"
      className="flex shrink-0 flex-col border-t border-[var(--app-line)] bg-[var(--bg-base)] px-3 pt-2"
      style={{ height: BEHAVIOR_HEIGHT }}
    >
      <div className="flex shrink-0 items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[15px] font-bold text-[#e8edf2]">Defense AI</h2>
        <div role="group" aria-label="Team" className="flex rounded-full bg-[var(--app-card)] p-0.5">
          {(['opp', 'ours'] as const).map((t) => (
            <button key={t} type="button" data-testid={`behavior-team-${t}`} aria-pressed={team === t} onClick={() => setTeam(t)}
              className={`${seg} h-7 ${team === t ? 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]' : 'text-[var(--app-muted)]'}`}>
              {t === 'opp' ? 'Opponent' : 'Ours'}
            </button>
          ))}
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label="Defense AI on" data-testid="behavior-on" onClick={() => patch({ on: !on })}
          className={`relative h-6 w-11 shrink-0 touch-manipulation rounded-full transition-colors duration-150 ${on ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-chip)]'}`}>
          <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all duration-150 ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <button type="button" aria-label="Close behavior" data-testid="behavior-close" onClick={onClose}
          className="flex size-8 shrink-0 touch-manipulation items-center justify-center rounded-full text-[var(--app-muted)] transition-transform duration-100 hover:bg-white/10 active:scale-90">
          <X className="size-[18px]" aria-hidden />
        </button>
      </div>

      <div className="mt-1 flex shrink-0 items-center gap-1" role="group" aria-label="Presets">
        {custom ? (
          <>
            <span data-testid="behavior-custom" className={`${seg} bg-[#14b8a6] text-[#0f172a]`}>Custom</span>
            <button type="button" data-testid="behavior-reset" onClick={() => applyPreset('mid')}
              className={`${seg} text-[var(--app-muted)] hover:bg-white/10`}>Reset to Mid</button>
          </>
        ) : (
          (['low', 'mid', 'high'] as const).map((name) => {
            const active = (cfg?.intensity ?? 'mid') === name
            return (
              <button key={name} type="button" data-testid={`behavior-preset-${name}`} aria-pressed={active} onClick={() => applyPreset(name)}
                className={`${seg} flex-1 ${active ? 'bg-[#14b8a6] text-[#0f172a]' : 'bg-[var(--app-card)] text-[#cbd5e1] hover:bg-white/5'}`}>
                {name[0].toUpperCase() + name.slice(1)}
              </button>
            )
          })
        )}
      </div>

      <div className={`mt-0.5 min-h-0 flex-1 overflow-y-auto pb-1 ${on ? '' : 'opacity-50'}`}>
        {SLIDERS.map(({ key, label, scale }) => (
          <div key={key} className="py-0.5">
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor={`slider-${key}`} className="font-semibold text-[#e8edf2]">{label}</label>
              <span className="min-w-0 flex-1 truncate text-[var(--app-muted)]">{scale}</span>
              <output data-testid={`value-${key}`} htmlFor={`slider-${key}`} className="min-w-8 rounded-full bg-[var(--app-card)] px-2 py-0.5 text-center text-[11px] font-bold tabular-nums text-[var(--app-accent)]">
                {Math.round(values[key])}
              </output>
            </div>
            <input
              id={`slider-${key}`}
              data-testid={`slider-${key}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(values[key])}
              onChange={(e) => setSlider(key, Number(e.target.value))}
              className="block h-[18px] w-full touch-manipulation accent-[#4cc9f0]"
            />
            <p data-testid={`helper-${key}`} className="m-0 truncate text-[11px] leading-[1.15] text-[var(--app-muted)]">{helper[key](values[key])}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
