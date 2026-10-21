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
import { AnimatedPitch } from './AnimatedPitch'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import type { Play } from '@/lib/types/play'
import { ChevronLeft, ChevronRight, MousePointer2, MoveUpRight, Play as PlayIcon, Plus, Zap } from 'lucide-react'
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

  const commitPosition = (id: string, m: Pos) => {
    if (currentStepIndex === 0) updatePlayerPosition(id, m.x, m.y)
    else movePlayer(id, m.x, m.y, currentStepIndex)
  }

  const onPlayerDown = (e: React.PointerEvent<SVGGElement>, id: string) => {
    if (!canEdit || !step) return
    e.stopPropagation()
    selectPlayer(id)
    if (mode === 'pass') {
      if (!pendingFrom) setPendingFrom(id)
      else if (pendingFrom !== id) {
        addPass({ from: pendingFrom, to: id, startTime: 0, endTime: step.duration }, currentStepIndex)
        setPendingFrom(null)
      }
      return
    }
    if (mode === 'run') {
      setPendingFrom(id)
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

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {mode === 'preview' && play ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AnimatedPitch play={play} stepIndex={currentStepIndex} onStepChange={setCurrentStep} onExit={() => setMode('select')} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 bg-[#16a34a]">
        <svg
          ref={svgRef}
          data-testid="pitch-svg"
          viewBox="-20 -20 720 1090"
          className="block h-full w-full touch-none select-none"
          role="img"
          aria-label="Soccer pitch editor"
          onPointerDown={onPitchDown}
        >
          <defs>
            <marker id="arrow-pass" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="white" />
            </marker>
            <marker id="arrow-run" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#fde047" />
            </marker>
          </defs>
          <PitchMarkings />

          {prevPositions && step?.moves.map((m) => {
            const from = prevPositions.get(m.playerId)
            if (!from) return null
            const a = mToSvg(from.x, from.y)
            const b = mToSvg(m.toX, m.toY)
            return (
              <line key={`run-${m.playerId}`} x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY}
                stroke="#fde047" strokeWidth={3} strokeDasharray="8 6" markerEnd="url(#arrow-run)" data-testid="run-arrow" />
            )
          })}

          {step?.passes.map((pass, i) => {
            const a = svgPos(pass.from)
            const b = svgPos(pass.to)
            if (!a || !b) return null
            return (
              <line key={`pass-${i}`} x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY}
                stroke="white" strokeWidth={3} markerEnd="url(#arrow-pass)" data-testid="pass-arrow" />
            )
          })}

          {play?.players.map((p) => {
            const s = svgPos(p.id)
            if (!s) return null
            const active = selectedPlayerId === p.id || pendingFrom === p.id
            return (
              <g
                key={p.id}
                data-testid={`player-${p.id}`}
                data-team={p.team}
                transform={`translate(${s.svgX}, ${s.svgY})`}
                onPointerDown={(e) => onPlayerDown(e, p.id)}
                onPointerMove={onPlayerMove}
                onPointerUp={onPlayerUp}
                onPointerCancel={onPlayerUp}
                className={canEdit ? (mode === 'select' ? 'cursor-grab' : 'cursor-pointer') : ''}
                style={{ touchAction: 'none' }}
                opacity={p.isContext ? 0.4 : 1}
              >
                <circle
                  r={24}
                  fill={p.team === 'ours' ? '#0ea5e9' : '#ef4444'}
                  stroke={active ? '#fde047' : p.team === 'ours' ? '#0369a1' : '#b91c1c'}
                  strokeWidth={active ? 5 : 3}
                />
                <text textAnchor="middle" dy={6} fontSize={17} fill="white" fontWeight={700} pointerEvents="none">
                  {p.label}
                </text>
              </g>
            )
          })}
        </svg>
        </div>
      )}
      {mode !== 'preview' && (
        <div
          className="shrink-0 border-t border-slate-800 bg-[var(--bg-toolbar)] px-2 pb-2 pt-1.5"
          role="toolbar"
          aria-label="Pitch editor toolbar"
        >
          <div className="grid grid-cols-4 gap-1">
            {MODES.map(({ mode: m, label, Icon }) => (
              <button
                key={m}
                type="button"
                aria-label={label}
                aria-pressed={mode === m}
                data-testid={`mode-${m}`}
                onClick={() => setMode(m)}
                className={`flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium transition-colors ${
                  mode === m ? 'bg-[#14b8a6] text-[#0f172a]' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-slate-800 pt-1.5">
            <div className="flex items-center">
              <button type="button" aria-label="Prev Step" disabled={currentStepIndex <= 0}
                onClick={() => setCurrentStep(currentStepIndex - 1)}
                className="flex size-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 disabled:opacity-30">
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <span data-testid="step-counter" className="px-2 text-sm tabular-nums text-slate-300" aria-live="polite">
                Step {currentStepIndex + 1}/{play?.steps.length ?? 1}
              </span>
              <button type="button" aria-label="Next Step" disabled={!play || currentStepIndex >= play.steps.length - 1}
                onClick={() => setCurrentStep(currentStepIndex + 1)}
                className="flex size-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 disabled:opacity-30">
                <ChevronRight className="size-5" aria-hidden />
              </button>
            </div>
            <button type="button" aria-label="Add Step" onClick={addStep}
              className="flex h-8 items-center gap-1 rounded-md border border-slate-600 px-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800">
              <Plus className="size-3.5" aria-hidden /> Step
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
