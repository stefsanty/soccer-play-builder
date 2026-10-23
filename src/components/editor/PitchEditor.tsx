'use client'

/**
 * @description Interactive SVG pitch editor for building soccer plays
 * @props { play?: Play; onUpdate?: (play: Play) => void }
 * @dataDependencies editorStore (useEditorStore)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore, type EditorMode } from '@/lib/store/editorStore'
import { mToSvg, svgToFullM, PITCH_W, PITCH_H } from '@/lib/engine/pitch'
import { PitchMarkings } from './PitchMarkings'
import { PitchSurface } from './PitchSurface'
import { StepTextPanel, STRIP_HEIGHT } from './StepTextPanel'
import { StepTimeline } from './StepTimeline'
import { ActionBar } from './ActionBar'
import { BehaviorPanel } from './BehaviorPanel'
import { RunsBar, RunsList } from './RunsPanel'
import { FormationGhosts, FormationToggle } from './Formation'
import { AnimatedPitch } from './AnimatedPitch'
import { PlayModeBar, SETUP_COUNT } from './PlayModeBar'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import type { Play } from '@/lib/types/play'
import { ballHolderAfter, stepChain } from '@/lib/engine/ballHolder'
import { BALL_OFFSET, getTimeline } from '@/lib/engine/simulator'
import { useAnimationEngine } from '@/lib/hooks/useAnimationEngine'
import { haptic } from '@/lib/haptics'
import { ArrowLeft, Check, CircleDot, Pencil, X } from 'lucide-react'

const PASS_SPEED_MPS = { slow: 20, medium: 40, fast: 70 } as const
const RUN_SPEED_MPS = { jog: 15, sprint: 30 } as const

interface PitchEditorProps {
  play?: Play
  onUpdate?: (play: Play) => void
}

type Pos = { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** A press has to travel this far (metres) before it counts as a drag rather than a tap. Without it a tap with
 *  a pixel of finger drift silently relocates the player — on the setup step that rewrites the formation the
 *  whole AI is built from, and on any other step it leaves an accidental run behind. */
const DRAG_MIN_M = 1.2
/** Player positions as shown at the end of `stepIndex`: initial position, then the moves of every step on its
 *  chain (step 0 is setup; a branch step continues from the main step it branches off, not the one listed before it). */
function positionsAt(play: Play, stepIndex: number): Map<string, Pos> {
  const map = new Map<string, Pos>()
  for (const p of play.players) map.set(p.id, { x: p.x, y: p.y })
  for (const i of stepChain(play, stepIndex)) {
    if (i === 0) continue
    for (const m of play.steps[i]?.moves ?? []) map.set(m.playerId, { x: m.toX, y: m.toY })
  }
  return map
}

export function PitchEditor({ play: playProp, onUpdate }: PitchEditorProps = {}) {
  const play = useEditorStore((s) => s.play)
  const mode = useEditorStore((s) => s.mode)
  const bottomMode = useEditorStore((s) => s.bottomMode)
  const isPlayingAll = useEditorStore((s) => s.isPlayingAll)
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex)
  const selectedPlayerId = useEditorStore((s) => s.selectedPlayerId)
  const setPlay = useEditorStore((s) => s.setPlay)
  const setMode = useEditorStore((s) => s.setMode)
  const setBottomMode = useEditorStore((s) => s.setBottomMode)
  const setPlayingAll = useEditorStore((s) => s.setPlayingAll)
  const selectPlayer = useEditorStore((s) => s.selectPlayer)
  const setCurrentStep = useEditorStore((s) => s.setCurrentStep)
  const addStep = useEditorStore((s) => s.addStep)
  const movePlayer = useEditorStore((s) => s.movePlayer)
  const addPass = useEditorStore((s) => s.addPass)
  const updatePlayerPosition = useEditorStore((s) => s.updatePlayerPosition)
  const toggleMoveHidden = useEditorStore((s) => s.toggleMoveHidden)
  const setStepMovesHidden = useEditorStore((s) => s.setStepMovesHidden)
  const setPreviewTime = useEditorStore((s) => s.setPreviewTime)
  const updatePass = useEditorStore((s) => s.updatePass)
  const updateMove = useEditorStore((s) => s.updateMove)

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ id: string; moved: boolean; wasSelected: boolean; from: Pos } | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  // First click of a pass/run gesture: the source player.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const engine = useAnimationEngine(play, currentStepIndex)

  // the run list opens in the step text panel; it belongs to the step it was opened on
  const [runsOpen, setRunsOpen] = useState(false)
  useEffect(() => { setRunsOpen(false) }, [currentStepIndex])

  // Which arrow (pass/run) the user tapped to edit its speed
  const [selectedAction, setSelectedAction] = useState<
    | { type: 'pass'; index: number }
    | { type: 'run'; playerId: string }
    | null
  >(null)
  useEffect(() => { setSelectedAction(null) }, [currentStepIndex])

  // the Behavior panel (defensive AI controls) takes over the bottom of the screen while it is open
  const [behaviorOpen, setBehaviorOpen] = useState(false)
  useEffect(() => { if (mode === 'preview') setBehaviorOpen(false) }, [mode])
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

  useEffect(() => { setPendingFrom(null) }, [currentStepIndex])

  // Back to a clean pitch: nothing selected, default tool, no half-finished pass/run.
  const clearSelection = () => {
    selectPlayer(null)
    setPendingFrom(null)
    if (useEditorStore.getState().mode !== 'preview') setMode('select')
  }

  // Escape deselects; entering Play mode drops any selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const st = useEditorStore.getState()
      if (st.selectedPlayerId || st.mode === 'pass' || st.mode === 'run') {
        st.selectPlayer(null)
        setPendingFrom(null)
        if (st.mode !== 'preview') st.setMode('select')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (mode === 'preview') {
      selectPlayer(null)
      setPendingFrom(null)
    }
  }, [mode, selectPlayer])

  // Edit view = the simulated state at the END of the current step (our authored moves landed, defenders
  // settled by their rules); run arrows start from the step's start state.
  const timeline = useMemo(() => (play && play.steps.length > 0 ? getTimeline(play, currentStepIndex) : null), [play, currentStepIndex])
  const positions = useMemo(() => {
    if (!play) return new Map<string, Pos>()
    if (!timeline) return positionsAt(play, currentStepIndex)
    return new Map(Object.entries(timeline.end).map(([id, p]) => [id, { x: p.x, y: p.y }] as const))
  }, [play, timeline, currentStepIndex])
  const prevPositions = useMemo(
    () => (timeline && currentStepIndex > 0 ? new Map(Object.entries(timeline.start).map(([id, p]) => [id, { x: p.x, y: p.y }] as const)) : null),
    [timeline, currentStepIndex],
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
  const isSetupStep = currentStepIndex === 0

  const labelOf = (id: string) => play?.players.find((p) => p.id === id)?.label ?? id

  const commitPosition = (id: string, m: Pos) => {
    if (currentStepIndex === 0) {
      updatePlayerPosition(id, m.x, m.y)
    } else {
      const startPos = (prevPositions ?? positions).get(id)
      const dist = startPos ? Math.hypot(m.x - startPos.x, m.y - startPos.y) : 0
      const runEnd = dist > 0 ? dist / RUN_SPEED_MPS.jog : (step?.duration ?? 4)
      movePlayer(id, m.x, m.y, currentStepIndex, runEnd)
    }
    haptic(15)
    announce(currentStepIndex === 0 ? `Moved ${labelOf(id)}` : `Run set for ${labelOf(id)}`, m)
  }

  // Picking Pass or Run uses the selected player as the source.
  const changeMode = (m: EditorMode) => {
    if (m !== mode) haptic(8)
    setMode(m)
    setPendingFrom(m === 'select' ? null : selectedPlayerId)
  }
  const goToStep = (i: number) => {
    if (i !== currentStepIndex) haptic(8)
    setCurrentStep(i)
    // step 0 is setup-only: drop pass/run mode and close behavior panel on entry
    if (i === 0 && (mode === 'pass' || mode === 'run')) setMode('select')
    if (i === 0) setBehaviorOpen(false)
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
      if (isSetupStep) { clearSelection(); return }
      if (!pendingFrom) setPendingFrom(id)
      else if (pendingFrom === id) clearSelection() // tap the passer again to cancel
      else {
        const fromPos = (prevPositions ?? positions).get(pendingFrom)
        const toPos = (prevPositions ?? positions).get(id)
        const dist = fromPos && toPos ? Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y) : 0
        const passEnd = dist > 0 ? dist / PASS_SPEED_MPS.medium : step.duration
        addPass({ from: pendingFrom, to: id, startTime: 0, endTime: passEnd, passingSpeed: 'medium' }, currentStepIndex)
        haptic(15)
        announce(`Pass added: ${labelOf(pendingFrom)} to ${labelOf(id)}`)
        clearSelection()
      }
      return
    }
    if (mode === 'run') {
      if (!pendingFrom) setPendingFrom(id)
      else if (pendingFrom === id) clearSelection()
      else {
        // ending a run on another player's spot (closing him down, supporting him): use where he stands
        const dest = positions.get(id)
        if (dest) commitPosition(pendingFrom, { x: dest.x, y: dest.y })
        clearSelection()
      }
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const pos = positions.get(id)
    dragRef.current = { id, moved: false, wasSelected: selectedPlayerId === id, from: pos ?? { x: 0, y: 0 } }
    if (pos) setDrag({ id, ...pos })
  }

  const onPlayerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragRef.current) return
    const m = toMeters(e)
    if (!m) return
    const { from } = dragRef.current
    if (Math.hypot(m.x - from.x, m.y - from.y) >= DRAG_MIN_M) dragRef.current.moved = true
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
    else if (d.wasSelected) clearSelection() // tap the selected player again to deselect
  }

  // Run tool, second click: the pitch point is the destination.
  const onPitchDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'run' && pendingFrom) {
      const m = toMeters(e)
      if (m) commitPosition(pendingFrom, m)
    }
    clearSelection() // tapping the open pitch always returns to the clean state
  }

  const svgPos = (id: string) => {
    if (drag?.id === id) return mToSvg(drag.x, drag.y)
    if (engine.progress > 0 && engine.frame?.players[id]) {
      const p = engine.frame.players[id]
      return mToSvg(p.x, p.y)
    }
    const p = positions.get(id)
    return p ? mToSvg(p.x, p.y) : null
  }

  // Facing at the end of the step (or from the live animation frame when the engine is running).
  const faceOf = (id: string, team: 'ours' | 'opp') => {
    if (engine.progress > 0 && engine.frame?.players[id]) return engine.frame.players[id].face
    return timeline?.end[id]?.face ?? (team === 'ours' ? -Math.PI / 2 : Math.PI / 2)
  }
  const drawOrder = play ? [...play.players].sort((a, b) => Number(a.team === 'ours') - Number(b.team === 'ours')) : []

  const holderId = play ? ballHolderAfter(play, currentStepIndex) : null
  const holderPos = holderId ? svgPos(holderId) : null
  const holderTeam = play?.players.find((p) => p.id === holderId)?.team ?? 'ours'
  const holderFace = holderId ? faceOf(holderId, holderTeam) : 0

  const tip =
    mode === 'pass' ? (pendingFrom ? 'Now tap the receiving player' : 'Tap the passer, then the receiver')
    : mode === 'run' ? (pendingFrom ? 'Tap the pitch to set the run destination' : 'Tap a player, then a destination')
    : null

  // Chain-play from Play Mode: each step's animation finishes, this fires, and we move to the next one.
  // At the last step the chain stops; the static editor pitch takes over and holds its end state.
  const handleStepComplete = useCallback(() => {
    if (!play) return
    const next = currentStepIndex + 1
    if (next >= play.steps.length) setPlayingAll(false)
    else setCurrentStep(next)
  }, [play, currentStepIndex, setCurrentStep, setPlayingAll])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {mode === 'preview' && play ? (
        <AnimatedPitch fill play={play} stepIndex={currentStepIndex} onStepChange={setCurrentStep}
          onSwitchToEdit={() => { haptic(10); selectPlayer(null); setMode('select'); setPreviewTime(0) }} />
      ) : isPlayingAll && play ? (
        // Play Mode is chain-playing: use the animation engine, but strip its own bars so Play Mode's
        // StepTextPanel and PlayModeBar below stay the UI the user interacts with.
        <AnimatedPitch
          fill
          play={play}
          stepIndex={currentStepIndex}
          hideControls
          hideStepBar
          hideStepText
          onComplete={handleStepComplete}
        />
      ) : (
        <div className="relative min-h-0 flex-1 bg-[var(--pitch)]">
        <svg
          ref={svgRef}
          data-testid="pitch-svg"
          viewBox="-20 -20 720 1090"
          preserveAspectRatio="xMidYMin meet"
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
          {play && <FormationGhosts players={play.players} />}

          {prevPositions && step?.moves.map((m) => {
            const from = prevPositions.get(m.playerId)
            if (!from || m.hidden) return null
            const a = mToSvg(from.x, from.y)
            const b = mToSvg(m.toX, m.toY)
            return (
              <g key={`run-${m.playerId}`} style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onClick={(e) => { e.stopPropagation(); setSelectedAction({ type: 'run', playerId: m.playerId }) }}>
                <line x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY} stroke="transparent" strokeWidth={16} />
                <line x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY}
                  stroke="#ffd43b" strokeWidth={3} strokeDasharray="8 6" markerEnd="url(#arrow-run)" data-testid="run-arrow" className="arrow-in" />
              </g>
            )
          })}

          {step?.options?.map((g, gi) =>
            g.pairs.map(([a, b], pi) => {
              const ca = svgPos(a)
              const cb = svgPos(b)
              if (!ca || !cb) return null
              return (
                <line key={`opt-${gi}-${pi}`} data-testid="option-line" x1={ca.svgX} y1={ca.svgY} x2={cb.svgX} y2={cb.svgY}
                  stroke="#4cc9f0" strokeWidth={3} strokeDasharray="9 7" strokeLinecap="round" opacity={0.7} pointerEvents="none" />
              )
            }),
          )}

          {step?.passes.map((pass, i) => {
            const a = svgPos(pass.from)
            const b = svgPos(pass.to)
            if (!a || !b) return null
            return (
              <g key={`pass-${i}`} style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onClick={(e) => { e.stopPropagation(); setSelectedAction({ type: 'pass', index: i }) }}>
                <line x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY} stroke="transparent" strokeWidth={16} />
                <line x1={a.svgX} y1={a.svgY} x2={b.svgX} y2={b.svgY}
                  stroke="white" strokeWidth={3} markerEnd="url(#arrow-pass)" data-testid="pass-arrow" className="arrow-in" />
              </g>
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

          {drawOrder.map((p) => {
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
                  <path d="M 24 0 L 33 -7 L 33 7 Z" fill="white" opacity={0.9} pointerEvents="none" data-testid="facing-wedge"
                    transform={`rotate(${(faceOf(p.id, p.team) * 180) / Math.PI})`} />
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

          {holderPos && engine.progress === 0 && (
            <g transform={`translate(${holderPos.svgX + Math.cos(holderFace) * BALL_OFFSET * 10}, ${holderPos.svgY + Math.sin(holderFace) * BALL_OFFSET * 10})`} pointerEvents="none" data-testid="ball">
              <circle r={15} fill="none" stroke="#ffd43b" strokeWidth={3} className="ball-pulse" />
              <circle r={10} fill="#fff" stroke="#111" strokeWidth={2.5} />
              <circle r={3.5} fill="#111" />
            </g>
          )}

          {engine.progress > 0 && engine.frame && (engine.frame.ball.holder || engine.frame.ball.flying) && (() => {
            const b = mToSvg(engine.frame.ball.x, engine.frame.ball.y)
            const lift = engine.frame.ball.lift
            return (
              <g data-testid="animated-ball" pointerEvents="none" transform={`translate(${b.svgX}, ${b.svgY})`}>
                <circle r={15 + lift * 6} fill="none" stroke="#ffd43b" strokeWidth={3} className="ball-pulse" />
                <circle r={10 + lift * 6} fill="#fff" stroke="#111" strokeWidth={2.5} />
                <circle r={3.5 + lift * 2} fill="#111" />
              </g>
            )
          })()}
        </svg>
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            {holderId ? (
              <div data-testid="ball-chip" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-[rgba(11,16,21,0.88)] px-3 py-1 text-xs font-semibold text-[#e8edf2] shadow-lg backdrop-blur-md">
                <CircleDot className="size-3.5 text-[#ffd43b]" aria-hidden />
                Ball: {labelOf(holderId)}
              </div>
            ) : (
              <span />
            )}
            <FormationToggle hasOpp={!!play?.players.some((p) => p.team === 'opp')} />
          </div>
          <div className="flex flex-col items-center gap-2">
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
        </div>
      )}
      {mode !== 'preview' && step && behaviorOpen && (
        <BehaviorPanel step={step} stepIndex={currentStepIndex} onClose={() => setBehaviorOpen(false)} />
      )}
      {mode !== 'preview' && step && !behaviorOpen && !isPlayingAll && (
        <StepTimeline
          key={step.id}
          badge={isSetupStep ? 'S' : (step.isAltBranch ? (step.altLabel ?? currentStepIndex) : currentStepIndex)}
          title={step.title}
          stepLabel={isSetupStep ? 'Starting positions' : `Step ${currentStepIndex + 1} of ${play?.steps.length ?? 1}`}
          step={step}
          engine={engine}
          body={runsOpen && step.moves.length > 0 ? <RunsList moves={step.moves} labelOf={labelOf} onToggle={(id) => toggleMoveHidden(id, currentStepIndex)} /> : undefined}
        />
      )}
      {mode !== 'preview' && step && !behaviorOpen && isPlayingAll && (
        <StepTextPanel
          key={step.id}
          badge={isSetupStep ? 'S' : (step.isAltBranch ? (step.altLabel ?? currentStepIndex) : currentStepIndex)}
          title={step.title}
          stepLabel={isSetupStep ? 'Starting positions' : `Step ${currentStepIndex + 1} of ${play?.steps.length ?? 1}`}
        />
      )}
      {/* Speed editor: shown when the user taps a pass or run arrow */}
      {mode !== 'preview' && step && !behaviorOpen && !isPlayingAll && selectedAction && (() => {
        if (selectedAction.type === 'pass') {
          const pass = step.passes[selectedAction.index]
          if (!pass) return null
          return (
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 py-2.5">
              <span className="text-xs font-medium text-[var(--app-muted)]">Pass speed</span>
              {(['slow', 'medium', 'fast'] as const).map((s) => (
                <button key={s} type="button"
                  onClick={() => {
                    const fromPos = (prevPositions ?? positions).get(pass.from)
                    const toPos = (prevPositions ?? positions).get(pass.to)
                    const dist = fromPos && toPos ? Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y) : 0
                    const newEnd = dist > 0 ? pass.startTime + dist / PASS_SPEED_MPS[s] : step.duration
                    updatePass(currentStepIndex, selectedAction.index, { passingSpeed: s, endTime: newEnd })
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-all active:scale-95 ${
                    pass.passingSpeed === s
                      ? 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]'
                      : 'bg-white/10 text-[#e8edf2] hover:bg-white/20'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
              <button type="button" onClick={() => setSelectedAction(null)}
                className="ml-auto flex touch-manipulation items-center justify-center rounded-full p-1 text-[var(--app-muted)] transition-transform hover:bg-white/10 active:scale-90">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )
        }
        const move = step.moves.find(m => m.playerId === selectedAction.playerId)
        if (!move) return null
        return (
          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 py-2.5">
            <span className="text-xs font-medium text-[var(--app-muted)]">Run speed</span>
            {(['jog', 'sprint'] as const).map((s) => (
              <button key={s} type="button"
                onClick={() => {
                  const startPos = (prevPositions ?? positions).get(move.playerId)
                  const dist = startPos ? Math.hypot(move.toX - startPos.x, move.toY - startPos.y) : 0
                  const newEnd = dist > 0 ? move.startTime + dist / RUN_SPEED_MPS[s] : step.duration
                  updateMove(currentStepIndex, move.playerId, { runningSpeed: s, endTime: newEnd })
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-all active:scale-95 ${
                  move.runningSpeed === s
                    ? 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]'
                    : 'bg-white/10 text-[#e8edf2] hover:bg-white/20'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button type="button" onClick={() => setSelectedAction(null)}
              className="ml-auto flex touch-manipulation items-center justify-center rounded-full p-1 text-[var(--app-muted)] transition-transform hover:bg-white/10 active:scale-90">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )
      })()}
      {mode !== 'preview' && !behaviorOpen && !isPlayingAll && (
        <ActionBar mode={mode} isSetupStep={isSetupStep} onChangeMode={changeMode} />
      )}
      {mode !== 'preview' && !behaviorOpen && bottomMode === 'play' && (
        <PlayModeBar onEnterEdit={() => { haptic(10); setPlayingAll(false); setBottomMode('edit') }} />
      )}
      {mode !== 'preview' && !behaviorOpen && bottomMode === 'edit' && (
        <>
          <div className="shrink-0 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-3 pt-2" data-testid="step-bar" style={{ height: STRIP_HEIGHT }}>
            <div className="flex h-full items-center gap-2">
              {/* Back to Play Mode: inline on the left of the chip strip, so it never covers a chip. */}
              <button
                type="button"
                data-testid="back-to-play"
                aria-label="Back to Play mode"
                onClick={() => { haptic(10); setBottomMode('play') }}
                className="flex h-9 shrink-0 touch-manipulation items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 text-[11px] font-semibold text-[#cbd5e1] transition-all duration-100 hover:border-white/25 hover:bg-white/10 active:scale-95"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Play
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" role="group" aria-label="Steps">
                {play?.steps.map((st, i) => {
                  const setup = i < SETUP_COUNT
                  return (
                    <button
                      key={st.id}
                      type="button"
                      data-testid={`step-chip-${i}`}
                      aria-label={setup ? `Setup — ${st.title}` : `Step ${st.isAltBranch ? (st.altLabel ?? i) : i}`}
                      aria-current={i === currentStepIndex ? 'step' : undefined}
                      onClick={() => goToStep(i)}
                      className={`h-9 shrink-0 touch-manipulation select-none rounded-full px-2.5 text-[13px] font-bold transition-all duration-100 active:scale-90 ${
                        i === 0 ? 'min-w-14' : 'min-w-9'
                      } ${
                        i === currentStepIndex
                          ? setup
                            ? 'bg-white/15 text-[#e8edf2] ring-2 ring-[var(--app-accent)]'
                            : 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]'
                          : setup
                            ? 'bg-white/5 text-[var(--app-muted)]'
                            : 'bg-[var(--app-chip)] text-[#e8edf2]'
                      } ${st.isAltBranch ? 'border border-dashed border-[#4cc9f0]' : ''}`}
                    >
                      {i === 0 ? 'Setup' : st.isAltBranch ? (st.altLabel ?? i) : i}
                    </button>
                  )
                })}
                <button type="button" aria-label="Add Step" onClick={handleAddStep}
                  className="h-9 min-w-9 shrink-0 touch-manipulation select-none rounded-full border border-[#34455a] px-2 text-lg leading-none text-[var(--app-muted)] transition-all duration-100 hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] active:scale-90 active:bg-white/10">
                  +
                </button>
              </div>
            </div>
          </div>
          {step && (
            <RunsBar
              moves={step.moves}
              open={runsOpen}
              onOpenChange={setRunsOpen}
              onSetAll={(hidden) => setStepMovesHidden(currentStepIndex, hidden)}
              onBehavior={() => setBehaviorOpen(true)}
              onSwitchToPlay={() => { haptic(10); selectPlayer(null); setMode('preview') }}
              isSetupStep={isSetupStep}
            />
          )}
        </>
      )}
    </div>
  )
}
