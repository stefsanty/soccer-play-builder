'use client'

/**
 * @description Interactive SVG pitch editor for building soccer plays
 * @props { play?: Play; onUpdate?: (play: Play) => void }
 * @dataDependencies editorStore (useEditorStore)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore, type EditorMode } from '@/lib/store/editorStore'
import { mToSvg, svgToFullM, PITCH_W, PITCH_H } from '@/lib/engine/pitch'
import { PitchMarkings } from './PitchMarkings'
import { PitchSurface } from './PitchSurface'
import { AnimatedPitch } from './AnimatedPitch'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import type { Play } from '@/lib/types/play'
import { ballHolderAfter } from '@/lib/engine/ballHolder'
import { haptic } from '@/lib/haptics'
import { Check, ChevronDown, CircleDot, MousePointer2, MoveUpRight, Pencil, Play as PlayIcon, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface PitchEditorProps {
  play?: Play
  onUpdate?: (play: Play) => void
}

type Pos = { x: number; y: number }

const MODES: { mode: EditorMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'select', label: 'Select', Icon: MousePointer2 },
  { mode: 'pass', label: 'Pass', Icon: MoveUpRight },
  { mode: 'run', label: 'Run', Icon: Zap },
  { mode: 'preview', label: 'Preview', Icon: PlayIcon },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Player positions as shown at the end of `stepIndex`: initial position, then moves from steps 1..stepIndex (step 0 is setup). */
function positionsAt(play: Play, stepIndex: number): Map<string, Pos> {
  const map = new Map<string, Pos>()
  for (const p of play.players) map.set(p.id, { x: p.x, y: p.y })
  for (let i = 1; i <= stepIndex; i++) {
    for (const m of play.steps[i]?.moves ?? []) map.set(m.playerId, { x: m.toX, y: m.toY })
  }
  return map
}

export function PitchEditor({ play: playProp, onUpdate }: PitchEditorProps = {}) {
  const play = useEditorStore((s) => s.play)
  const mode = useEditorStore((s) => s.mode)
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex)
  const selectedPlayerId = useEditorStore((s) => s.selectedPlayerId)
  const setPlay = useEditorStore((s) => s.setPlay)
  const setMode = useEditorStore((s) => s.setMode)
  const selectPlayer = useEditorStore((s) => s.selectPlayer)
  const setCurrentStep = useEditorStore((s) => s.setCurrentStep)
  const addStep = useEditorStore((s) => s.addStep)
  const movePlayer = useEditorStore((s) => s.movePlayer)
  const addPass = useEditorStore((s) => s.addPass)
  const updatePlayerPosition = useEditorStore((s) => s.updatePlayerPosition)

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  // First click of a pass/run gesture: the source player.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  // Brief confirmation of the last action; `at` (meters) also pulses a marker on the pitch.
  const [flash, setFlash] = useState<{ id: number; text: string; at?: Pos } | null>(null)
  const announce = (text: string, at?: Pos) => setFlash({ id: Date.now(), text, at })
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(t)
  }, [flash])

  // Prop play wins; otherwise keep the store's play or build a default 4-4-2.
  useEffect(() => {
    if (playProp) setPlay(playProp)
    else if (!useEditorStore.getState().play) setPlay(createDefaultPlay())
  }, [playProp, setPlay])

  useEffect(() => {
    if (play) onUpdate?.(play)
  }, [play, onUpdate])

  useEffect(() => { setPendingFrom(null) }, [mode, currentStepIndex])

  const positions = useMemo(() => (play ? positionsAt(play, currentStepIndex) : new Map<string, Pos>()), [play, currentStepIndex])
  const prevPositions = useMemo(
    () => (play && currentStepIndex > 0 ? positionsAt(play, currentStepIndex - 1) : null),
    [play, currentStepIndex],
  )

  const toMeters = (e: { clientX: number; clientY: number }): Pos | null => {
    const ctm = svgRef.current?.getScreenCTM()?.inverse()
    if (!ctm) return null
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm)
    const m = svgToFullM(pt.x, pt.y)
    return { x: clamp(m.x, 0, PITCH_W), y: clamp(m.y, 0, PITCH_H) }
  }

  const step = play?.steps[currentStepIndex]
  const canEdit = mode !== 'preview'

  const labelOf = (id: string) => play?.players.find((p) => p.id === id)?.label ?? id

  const commitPosition = (id: string, m: Pos) => {
    if (currentStepIndex === 0) updatePlayerPosition(id, m.x, m.y)
    else movePlayer(id, m.x, m.y, currentStepIndex)
    haptic(15)
    announce(currentStepIndex === 0 ? `Moved ${labelOf(id)}` : `Run set for ${labelOf(id)}`, m)
  }

  const changeMode = (m: EditorMode) => {
    if (m !== mode) haptic(8)
    setMode(m)
  }
  const goToStep = (i: number) => {
    if (i !== currentStepIndex) haptic(8)
    setCurrentStep(i)
  }
  const handleAddStep = () => {
    addStep()
    haptic(15)
    announce(`Step ${(play?.steps.length ?? 0)} added`)
  }

  const onPlayerDown = (e: React.PointerEvent<SVGGElement>, id: string) => {
    if (!canEdit || !step) return
    e.stopPropagation()
    selectPlayer(id)
    haptic(8)
    if (mode === 'pass') {
      if (!pendingFrom) setPendingFrom(id)
      else if (pendingFrom === id) setPendingFrom(null) // tap the passer again to cancel
      else {
        addPass({ from: pendingFrom, to: id, startTime: 0, endTime: step.duration }, currentStepIndex)
        setPendingFrom(null)
        haptic(15)
        announce(`Pass added: ${labelOf(pendingFrom)} to ${labelOf(id)}`)
      }
      return
    }
    if (mode === 'run') {
      setPendingFrom(pendingFrom === id ? null : id)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { id, moved: false }
    const pos = positions.get(id)
    if (pos) setDrag({ id, ...pos })
  }

  const onPlayerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragRef.current) return
    const m = toMeters(e)
    if (!m) return
    dragRef.current.moved = true
    setDrag({ id: dragRef.current.id, ...m })
  }

  const onPlayerUp = (e: React.PointerEvent<SVGGElement>) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const m = toMeters(e)
    setDrag(null)
    if (d.moved && m) commitPosition(d.id, m)
  }

  // Run tool, second click: the pitch point is the destination.
  const onPitchDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'select') selectPlayer(null)
    if (mode !== 'run' || !pendingFrom) return
    const m = toMeters(e)
    if (!m) return
    commitPosition(pendingFrom, m)
    setPendingFrom(null)
  }

  const svgPos = (id: string) => {
    const p = drag?.id === id ? drag : positions.get(id)
    return p ? mToSvg(p.x, p.y) : null
  }

  const holderId = play ? ballHolderAfter(play, currentStepIndex) : null
  const holderPos = holderId ? svgPos(holderId) : null

  const tip =
    mode === 'pass' ? (pendingFrom ? 'Now tap the receiving player' : 'Tap the passer, then the receiver')
    : mode === 'run' ? (pendingFrom ? 'Tap the pitch to set the run destination' : 'Tap a player, then a destination')
    : null

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {mode === 'preview' && play ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AnimatedPitch play={play} stepIndex={currentStepIndex} onStepChange={setCurrentStep} onExit={() => setMode('select')} />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-[var(--pitch)]">
        <svg
          ref={svgRef}
          data-testid="pitch-svg"
          viewBox="-20 -20 720 1090"
          className={`block h-full w-full touch-none select-none ${mode === 'run' && pendingFrom ? 'cursor-crosshair' : ''}`}
          role="img"
          aria-label="Soccer pitch editor"
          onPointerDown={onPitchDown}
        >
          <defs>
            <marker id="arrow-pass" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="white" />
            </marker>
            <marker id="arrow-run" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#ffd43b" />
            </marker>
          </defs>
          <PitchSurface />
          <PitchMarkings />

          {prevPositions && step?.moves.map((m) => {
            const from = prevPositions.get(m.playerId)
            if (!from) return null
            const a = mToSvg(from.x, from.y)
            const b = mToSvg(m.toX, m.toY)
            return (
              <line key={`run-${m.playerId}`} x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY}
                stroke="#ffd43b" strokeWidth={3} strokeDasharray="8 6" markerEnd="url(#arrow-run)" data-testid="run-arrow" className="arrow-in" />
            )
          })}

          {step?.passes.map((pass, i) => {
            const a = svgPos(pass.from)
            const b = svgPos(pass.to)
            if (!a || !b) return null
            return (
              <line key={`pass-${i}`} x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY}
                stroke="white" strokeWidth={3} markerEnd="url(#arrow-pass)" data-testid="pass-arrow" className="arrow-in" />
            )
          })}

          {flash?.at && (() => {
            const t = mToSvg(flash.at.x, flash.at.y)
            return (
              <ellipse key={flash.id} cx={t.svgX} cy={t.svgY} rx={22} ry={22} fill="none" stroke="#ffd43b" strokeWidth={4}
                className="landing-pulse" pointerEvents="none" data-testid="action-marker" />
            )
          })()}

          {holderPos && (
            <ellipse cx={holderPos.svgX} cy={holderPos.svgY} rx={29} ry={29} fill="none" stroke="#ffd43b" strokeWidth={3}
              strokeDasharray="6 5" pointerEvents="none" data-testid="ball-holder-ring" />
          )}

          {play?.players.map((p) => {
            const s = svgPos(p.id)
            if (!s) return null
            const selected = selectedPlayerId === p.id
            const pending = pendingFrom === p.id
            return (
              <g
                key={p.id}
                data-testid={`player-${p.id}`}
                data-team={p.team}
                data-selected={selected || undefined}
                transform={`translate(${s.svgX}, ${s.svgY})`}
                onPointerDown={(e) => onPlayerDown(e, p.id)}
                onPointerMove={onPlayerMove}
                onPointerUp={onPlayerUp}
                onPointerCancel={onPlayerUp}
                className={`group ${canEdit ? (mode === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : ''}`}
                style={{ touchAction: 'none' }}
                opacity={p.isContext ? 0.4 : 1}
              >
                {/* oversized invisible hit area: easier to tap on a phone */}
                <ellipse rx={30} ry={30} fill="transparent" />
                <g className="origin-center [transform-box:fill-box] transition-transform duration-100 group-hover:scale-110 group-active:scale-95">
                  <ellipse rx={27} ry={27} fill="none" stroke="white" strokeWidth={2}
                    className="opacity-0 transition-opacity group-hover:opacity-70" pointerEvents="none" />
                  {pending && (
                    <ellipse rx={30} ry={30} fill="none" stroke="#4cc9f0" strokeWidth={4} className="animate-pulse" pointerEvents="none" data-testid="pending-ring" />
                  )}
                  {selected && !pending && (
                    <ellipse rx={29} ry={29} fill="none" stroke="#ffd43b" strokeWidth={4} pointerEvents="none" data-testid="selected-ring"
                      style={{ filter: 'drop-shadow(0 0 8px #ffd43b)' }} />
                  )}
                  <circle
                    r={20}
                    fill={p.team === 'ours' ? '#2f8cff' : '#e5484d'}
                    stroke={selected || pending ? '#ffd43b' : 'white'}
                    strokeWidth={selected || pending ? 4 : 2.5}
                  />
                  <text textAnchor="middle" dy={4} fontSize={12} fill="white" fontWeight={700} pointerEvents="none">
                    {p.label}
                  </text>
                </g>
              </g>
            )
          })}

          {holderPos && (
            <g transform={`translate(${holderPos.svgX + 20}, ${holderPos.svgY + 18})`} pointerEvents="none" data-testid="ball">
              <circle r={15} fill="none" stroke="#ffd43b" strokeWidth={3} className="ball-pulse" />
              <circle r={10} fill="#fff" stroke="#111" strokeWidth={2.5} />
              <circle r={3.5} fill="#111" />
            </g>
          )}
        </svg>
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-center gap-2">
          {step && <StepNote key={step.id} index={currentStepIndex} title={step.title} detail={step.narrativeOurs.join(' ')} />}
          {holderId && (
            <div data-testid="ball-chip" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[rgba(11,16,21,0.88)] px-3 py-1 text-xs font-semibold text-[#e8edf2] shadow-lg backdrop-blur-md">
              <CircleDot className="size-3.5 text-[#ffd43b]" aria-hidden />
              Ball: {labelOf(holderId)}
            </div>
          )}
          {flash && (
            <div key={flash.id} role="status" data-testid="action-flash"
              className="flash-in inline-flex items-center gap-1.5 rounded-full bg-[var(--app-accent)] px-3 py-1.5 text-xs font-bold text-[var(--app-accent-ink)] shadow-lg">
              <Check className="size-3.5" strokeWidth={3} aria-hidden />
              {flash.text}
            </div>
          )}
          {tip && !flash && (
            <div role="status" data-testid="editor-hint" className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border border-[#14b8a6]/50 bg-[#14b8a6]/15 py-1.5 pl-[9px] pr-3 text-xs font-medium text-[#ccfbf1] shadow-lg backdrop-blur-md">
              <Pencil className="size-[13px] shrink-0 text-[#14b8a6]" aria-hidden />
              {tip}
            </div>
          )}
        </div>
        </div>
      )}
      {mode !== 'preview' && (
        <>
          <div
            className="grid shrink-0 grid-cols-4 gap-1 border-t border-[var(--app-line)] bg-[var(--bg-toolbar)] px-3 py-1"
            role="toolbar"
            aria-label="Pitch editor toolbar"
          >
            {MODES.map(({ mode: m, label, Icon }) => (
              <button
                key={m}
                type="button"
                aria-label={label}
                aria-pressed={mode === m}
                data-testid={`mode-${m}`}
                onClick={() => changeMode(m)}
                className={`flex h-11 touch-manipulation select-none flex-col items-center justify-center gap-0.5 rounded-[10px] text-[10px] font-medium transition-all duration-100 active:scale-95 ${
                  mode === m ? 'bg-[#14b8a6] text-[#0f172a] active:bg-[#5eead4]' : 'text-[#cbd5e1] hover:bg-white/5 active:bg-white/15'
                }`}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <div className="shrink-0 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-3 pt-2" data-testid="step-bar">
            <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Steps">
              {play?.steps.map((st, i) => (
                <button
                  key={st.id}
                  type="button"
                  data-testid={`step-chip-${i}`}
                  aria-label={`Step ${i}`}
                  aria-current={i === currentStepIndex ? 'step' : undefined}
                  onClick={() => goToStep(i)}
                  className={`h-9 min-w-9 shrink-0 touch-manipulation select-none rounded-full px-2 text-[13px] font-bold transition-all duration-100 active:scale-90 ${
                    i === currentStepIndex ? 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]' : 'bg-[var(--app-chip)] text-[#e8edf2]'
                  }`}
                >
                  {i}
                </button>
              ))}
              <button type="button" aria-label="Add Step" onClick={handleAddStep}
                className="h-9 min-w-9 shrink-0 touch-manipulation select-none rounded-full border border-[#34455a] px-2 text-lg leading-none text-[var(--app-muted)] transition-all duration-100 hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] active:scale-90 active:bg-white/10">
                +
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Step note pill over the pitch: step number badge + title; tap to expand the detail line. */
function StepNote({ index, title, detail }: { index: number; title: string; detail: string }) {
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
