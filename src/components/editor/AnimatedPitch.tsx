'use client'

/**
 * @description Animated SVG pitch: an rAF playback loop over the pre-simulated step timeline
 * (src/lib/engine/simulator.ts) plus a playback bar. `fill` renders it as Play mode of the editor:
 * the same pitch wrapper, graphics and overlay as the edit view, with the playback panel floating
 * over the bottom of the pitch and the step strip in the slot Edit mode uses. Without `fill` it is a
 * self-contained block (shared-play viewer).
 *
 * Layer order (back to front): vision cone, run arrows, rest-defense shape, option lines, pass lines,
 * marking lines, gap + offside annotations, opponents, our players (with facing wedge), holder ring,
 * ball, diagonal-pass callout.
 * @props { play: Play; stepIndex: number; onStepChange?: (n: number) => void; fill?: boolean }
 * @dataDependencies useAnimationEngine
 */

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleDot, Gauge, Pause, Play as PlayIcon, RotateCcw } from 'lucide-react'
import type { Play } from '@/lib/types/play'
import { mToSvg } from '@/lib/engine/pitch'
import { useAnimationEngine } from '@/lib/hooks/useAnimationEngine'
import { neighbourStep } from '@/lib/engine/ballHolder'
import { PitchMarkings } from './PitchMarkings'
import { PitchSurface } from './PitchSurface'
import { StepTextPanel } from './StepTextPanel'
import { FormationGhosts, FormationToggle } from './Formation'
import { BAR_HEIGHT } from './RunsPanel'

interface AnimatedPitchProps {
  play: Play
  stepIndex: number
  onStepChange?: (n: number) => void
  /** Start playing on mount and whenever the step changes. Default true. */
  autoPlay?: boolean
  /** Fill the parent (editor Play mode) instead of sizing itself (viewer). */
  fill?: boolean
}

const SPEEDS = [0.5, 1, 1.5, 2]
const CONE_LENGTH = 17 // m
const CONE_HALF_ANGLE = 0.55 // rad

const pt = (x: number, y: number) => {
  const s = mToSvg(x, y)
  return { x: s.svgX, y: s.svgY }
}

const ctrl =
  'flex h-11 touch-manipulation select-none flex-col items-center justify-center gap-0.5 rounded-[10px] text-[10px] font-medium transition-all duration-100 active:scale-95 disabled:opacity-40 disabled:active:scale-100'

export function AnimatedPitch({ play, stepIndex, onStepChange, autoPlay = true, fill = false }: AnimatedPitchProps) {
  const [speed, setSpeed] = useState(1)
  const engine = useAnimationEngine(play, stepIndex, speed)
  const { frame, timeline, time, isPlaying, progress } = engine
  const startPlayback = engine.play

  useEffect(() => {
    if (autoPlay) startPlayback()
  }, [autoPlay, play.id, stepIndex, startPlayback])

  const total = play.steps.length
  const step = play.steps[stepIndex]
  const prevStep = neighbourStep(play, stepIndex, -1)
  const nextStep = neighbourStep(play, stepIndex, 1)
  const labelOf = (id: string) => play.players.find((p) => p.id === id)?.label ?? id

  const holderLabel = frame
    ? frame.ball.flying
      ? 'in flight'
      : frame.ball.holder
        ? labelOf(frame.ball.holder)
        : null
    : null

  const ballChip = holderLabel && (
    <div
      data-testid="ball-chip"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[rgba(11,16,21,0.88)] px-3 py-1 text-xs font-semibold text-[#e8edf2] shadow-lg backdrop-blur-md"
    >
      <CircleDot className="size-3.5 text-[#ffd43b]" aria-hidden />
      Ball: {holderLabel}
    </div>
  )

  const P = (id: string) => (frame ? frame.players[id] : undefined)
  const C = (id: string) => {
    const p = P(id)
    return p ? pt(p.x, p.y) : null
  }

  const pitch = (
    <svg
      data-testid="animated-pitch-svg"
      viewBox="-20 -20 720 1090"
      preserveAspectRatio="xMidYMin meet"
      className={fill ? 'block h-full w-full select-none' : 'mx-auto h-auto max-h-[75vh] w-full select-none rounded-lg bg-[var(--pitch)]'}
      role="img"
      aria-label="Animated soccer play"
    >
      <defs>
        <marker id="anim-run-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ffd43b" />
        </marker>
      </defs>
      <PitchSurface />
      <PitchMarkings />
      <FormationGhosts players={play.players} />

      {frame && timeline && step && (
        <>
          {/* vision cone */}
          {step.showConeFor && P(step.showConeFor) && (() => {
            const p = P(step.showConeFor!)!
            const o = pt(p.x, p.y)
            const L = CONE_LENGTH * 10
            const a1 = p.face - CONE_HALF_ANGLE
            const a2 = p.face + CONE_HALF_ANGLE
            const d = `M ${o.x} ${o.y} L ${o.x + Math.cos(a1) * L} ${o.y + Math.sin(a1) * L} A ${L} ${L} 0 0 1 ${o.x + Math.cos(a2) * L} ${o.y + Math.sin(a2) * L} Z`
            return <path data-testid="cone" d={d} fill="rgba(255,212,59,0.12)" stroke="#ffd43b" strokeOpacity={0.45} strokeDasharray="6 6" strokeWidth={2} pointerEvents="none" />
          })()}

          {/* run arrows */}
          {step.moves.map((m) => {
            const from = timeline.start[m.playerId]
            if (!from || m.hidden || time < m.startTime || Math.hypot(m.toX - from.x, m.toY - from.y) < 3) return null
            const a = pt(from.x, from.y)
            const b = pt(m.toX, m.toY)
            const v = m.via ? pt(m.via[0], m.via[1]) : null
            const d = v ? `M ${a.x} ${a.y} Q ${v.x} ${v.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
            return (
              <path key={`run-${m.playerId}`} data-testid="run-arrow" d={d} fill="none" stroke="#ffd43b" strokeWidth={2.5}
                strokeDasharray="7 6" markerEnd="url(#anim-run-arrow)" opacity={0.9} pointerEvents="none" />
            )
          })}

          {/* rest-defense shape */}
          {step.restAnnotation && time >= step.restAnnotation.showFrom && (() => {
            const pts = step.restAnnotation!.playerIds.map(C).filter((c): c is { x: number; y: number } => !!c)
            if (pts.length < 2) return null
            const low = pts.reduce((m, c) => (c.y > m.y ? c : m), pts[0])
            return (
              <g data-testid="rest-annotation" pointerEvents="none">
                <polygon points={pts.map((c) => `${c.x},${c.y}`).join(' ')} fill="rgba(76,201,240,0.14)" stroke="#4cc9f0" strokeWidth={2} strokeDasharray="7 6" />
                <text x={low.x} y={low.y + 44} textAnchor="middle" fontSize={15} fontWeight={700} fill="#bdeeff" stroke="#0b1015" strokeWidth={3} paintOrder="stroke">
                  {step.restAnnotation!.label}
                </text>
              </g>
            )
          })()}

          {/* pass-option lines (+ labels) */}
          {step.options?.map((g, gi) =>
            time >= g.from && (g.to === null || time < g.to)
              ? g.pairs.map(([a, b], pi) => {
                  const ca = C(a)
                  const cb = C(b)
                  if (!ca || !cb) return null
                  const label = g.labels?.[pi]
                  const at = label ? (label.a === 'end' ? cb : ca) : null
                  return (
                    <g key={`opt-${gi}-${pi}`} data-testid="option-line" pointerEvents="none">
                      <line x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y} stroke="#4cc9f0" strokeWidth={3} strokeDasharray="9 7" strokeLinecap="round" opacity={0.7} />
                      {label && at && (
                        <text x={at.x + (label.a === 'end' ? 0 : 26)} y={at.y - 26} textAnchor={label.a === 'end' ? 'middle' : 'start'} fontSize={13} fontWeight={700}
                          fill="#bdeeff" stroke="#0b1015" strokeWidth={3} paintOrder="stroke">
                          {label.t}
                        </text>
                      )}
                    </g>
                  )
                })
              : null,
          )}

          {/* pass lines: solid while/after the ball travels */}
          {step.passes.map((p, i) => {
            if (time < p.startTime) return null
            const o = pt(timeline.passOrigins[i][0], timeline.passOrigins[i][1])
            const landed = time >= p.endTime
            const end = landed ? C(p.to) : pt(frame.ball.x, frame.ball.y)
            if (!end) return null
            return (
              <line key={`pass-${i}`} data-testid={landed ? 'pass-line-done' : 'pass-line'} x1={o.x} y1={o.y} x2={end.x} y2={end.y}
                stroke="white" strokeWidth={3} strokeLinecap="round" opacity={landed ? 0.5 : 1} pointerEvents="none" />
            )
          })}

          {/* marking lines */}
          {frame.marks.map((m) => {
            const a = C(m.from)
            const b = C(m.to)
            if (!a || !b) return null
            return <line key={`mark-${m.from}`} data-testid="mark-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff6b6b" strokeWidth={2} strokeDasharray="5 5" opacity={0.7} pointerEvents="none" />
          })}

          {/* gap between two defenders */}
          {step.gapAnnotation && time >= step.gapAnnotation.showFrom && (() => {
            const a = C(step.gapAnnotation!.playerA)
            const b = C(step.gapAnnotation!.playerB)
            if (!a || !b) return null
            return (
              <g data-testid="gap-annotation" pointerEvents="none">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd43b" strokeWidth={2.5} strokeDasharray="2 6" strokeLinecap="round" />
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 12} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffe680" stroke="#0b1015" strokeWidth={3} paintOrder="stroke">
                  {step.gapAnnotation!.label}
                </text>
              </g>
            )
          })()}

          {/* defensive-AI offside line: a faint marker at the back line of each AI team that has it on */}
          {(['opp', 'ours'] as const).map((team) => {
            const cfg = step.ai?.[team]
            if (!cfg?.on || cfg.offsideLine === false) return null
            const back = play.players.filter((p) => p.team === team && !/gk/i.test(p.label)).map((p) => P(p.id)?.y).filter((y): y is number => y !== undefined)
            if (back.length === 0) return null
            const y = pt(0, team === 'opp' ? Math.max(...back) : Math.min(...back)).y
            return (
              <line key={`ai-line-${team}`} data-testid={`ai-line-${team}`} x1={0} y1={y} x2={680} y2={y}
                stroke="white" strokeOpacity={0.35} strokeWidth={2} strokeDasharray="4 8" pointerEvents="none" />
            )
          })}

          {/* offside line at the deepest outfield defender */}
          {step.offsideAnnotation && time >= step.offsideAnnotation.showFrom && time <= step.offsideAnnotation.showTo && (() => {
            const line = play.players
              .filter((p) => p.team === 'opp' && p.label !== 'oGK')
              .reduce((m, p) => Math.max(m, P(p.id)?.y ?? -Infinity), -Infinity)
            if (!Number.isFinite(line)) return null
            const y = pt(0, line).y
            return (
              <g data-testid="offside-annotation" pointerEvents="none">
                <line x1={0} y1={y} x2={680} y2={y} stroke="#ff6b6b" strokeWidth={2.5} strokeDasharray="10 7" />
                <text x={340} y={y - 10} textAnchor="middle" fontSize={15} fontWeight={700} fill="#ffb3b3" stroke="#0b1015" strokeWidth={3} paintOrder="stroke">
                  {step.offsideAnnotation!.label}
                </text>
              </g>
            )
          })()}

          {/* opponents, then our players (display-only in Play mode: no handlers, no hover/selection) */}
          {(['opp', 'ours'] as const).map((team) =>
            play.players.filter((p) => p.team === team).map((p) => {
              const fp = P(p.id)
              if (!fp) return null
              const s = pt(fp.x, fp.y)
              return (
                <g key={p.id} data-testid={`anim-player-${p.id}`} data-team={p.team} transform={`translate(${s.x}, ${s.y})`} pointerEvents="none" opacity={p.isContext ? 0.55 : 1}>
                  <path d="M 24 0 L 33 -7 L 33 7 Z" fill="white" opacity={0.9} transform={`rotate(${(fp.face * 180) / Math.PI})`} data-testid="facing-wedge" />
                  <circle r={20} fill={team === 'ours' ? '#2f8cff' : '#e5484d'} stroke="white" strokeWidth={2.5} />
                  <text textAnchor="middle" dy={4} fontSize={12} fill="white" fontWeight={700}>
                    {p.label}
                  </text>
                </g>
              )
            }),
          )}

          {/* holder ring + ball */}
          {frame.ball.holder && (() => {
            const c = C(frame.ball.holder!)
            return c ? <ellipse cx={c.x} cy={c.y} rx={27} ry={27} fill="none" stroke="#ffd43b" strokeWidth={3} strokeDasharray="6 5" pointerEvents="none" data-testid="ball-holder-ring" /> : null
          })()}
          {(frame.ball.holder || frame.ball.flying) && (() => {
            const b = pt(frame.ball.x, frame.ball.y)
            return (
              <g data-testid="ball" pointerEvents="none" transform={`translate(${b.x}, ${b.y})`}>
                <circle r={15 + frame.ball.lift * 5} fill="none" stroke="#ffd43b" strokeWidth={3} className="ball-pulse" />
                <circle r={10 + frame.ball.lift * 5} fill="#fff" stroke="#111" strokeWidth={2.5} />
                <circle r={3.5 + frame.ball.lift * 2} fill="#111" />
              </g>
            )
          })()}

          {/* "Diagonal pass" callout */}
          {step.diagPass && time >= step.diagPass.from && step.passes[step.diagPass.pass] && (() => {
            const i = step.diagPass!.pass
            const o = pt(timeline.passOrigins[i][0], timeline.passOrigins[i][1])
            const e = C(step.passes[i].to)
            if (!e) return null
            const mx = (o.x + e.x) / 2
            const my = (o.y + e.y) / 2 - 38
            return (
              <g data-testid="diag-callout" pointerEvents="none">
                <rect x={mx - 70} y={my - 13} width={140} height={26} rx={13} fill="#0b1015" fillOpacity={0.85} stroke="#ffd43b" strokeWidth={1} />
                <text x={mx} y={my + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#ffe680">Diagonal pass</text>
              </g>
            )
          })()}
        </>
      )}
    </svg>
  )

  const goTo = (i: number | null) => {
    if (i !== null) onStepChange?.(i)
  }

  const controls = (
    <div
      role="group"
      aria-label="Playback controls"
      className={
        fill
          ? 'flex shrink-0 flex-col justify-center gap-1 border-t border-[var(--app-line)] bg-[var(--bg-toolbar)] px-3'
          : 'rounded-lg bg-[var(--app-card)] p-3'
      }
      style={fill ? { height: BAR_HEIGHT } : undefined}
    >
      <input
        type="range"
        data-testid="progress-bar"
        aria-label="Playback progress"
        className="w-full accent-[#4cc9f0]"
        min={0}
        max={1000}
        value={Math.round(progress * 1000)}
        onChange={(e) => engine.seek(Number(e.target.value) / 1000)}
      />
      {!fill && (
        <div className="mt-0.5 flex items-center justify-between text-xs text-[var(--app-muted)]">
          <span data-testid="anim-step-indicator" className="shrink-0 whitespace-nowrap tabular-nums">
            Step {stepIndex + 1} of {total}
          </span>
          <span className="min-w-0 truncate pl-3">{step?.title}</span>
        </div>
      )}

      <div className={`grid grid-cols-5 gap-1 ${fill ? '' : 'mt-2'}`}>
        <button type="button" data-testid="reset" aria-label="Restart" onClick={engine.reset}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <RotateCcw className="size-5" aria-hidden />
          Restart
        </button>
        <button type="button" aria-label="Previous step" disabled={!onStepChange || prevStep === null}
          onClick={() => goTo(prevStep)}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <ChevronLeft className="size-5" aria-hidden />
          Prev
        </button>
        <button type="button" data-testid="play-toggle" aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={isPlaying ? engine.pause : engine.play}
          className={`${ctrl} bg-[var(--app-accent)] text-[var(--app-accent-ink)] active:brightness-125`}>
          {isPlaying ? <Pause className="size-5" aria-hidden /> : <PlayIcon className="size-5" aria-hidden />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" aria-label="Next step" disabled={!onStepChange || nextStep === null}
          onClick={() => goTo(nextStep)}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <ChevronRight className="size-5" aria-hidden />
          Next
        </button>
        <button type="button" data-testid="speed" aria-label={`Playback speed ${speed}x`}
          onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          className={`${ctrl} text-[#cbd5e1] hover:bg-white/5 active:bg-white/15`}>
          <Gauge className="size-5" aria-hidden />
          {speed}x
        </button>
      </div>
    </div>
  )

  // Same strip as the Edit-mode step bar (same slot, same height): one pill per step; branches dashed.
  const stepBar = (
    <div data-testid="step-bar" className={fill ? 'shrink-0 border-t border-[var(--app-line)] bg-[var(--app-card)] px-3 pb-3 pt-2' : 'rounded-lg bg-[var(--app-card)] p-3'}>
      <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Steps">
        {play.steps.map((st, i) => (
          <button
            key={st.id}
            type="button"
            data-testid={`anim-step-chip-${i}`}
            aria-label={`Step ${st.isAltBranch ? (st.altLabel ?? i) : i}`}
            aria-current={i === stepIndex ? 'step' : undefined}
            disabled={!onStepChange}
            onClick={() => onStepChange?.(i)}
            className={`h-9 min-w-9 shrink-0 touch-manipulation select-none rounded-full px-2 text-[13px] font-bold transition-all duration-100 active:scale-90 ${
              i === stepIndex ? 'bg-[var(--app-accent)] text-[var(--app-accent-ink)]' : 'bg-[var(--app-chip)] text-[#e8edf2]'
            } ${st.isAltBranch ? 'border border-dashed border-[#4cc9f0]' : ''}`}
          >
            {st.isAltBranch ? (st.altLabel ?? i) : i}
          </button>
        ))}
      </div>
    </div>
  )

  if (fill) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col" data-testid="animated-pitch">
        <div className="relative min-h-0 flex-1 bg-[var(--pitch)]">
          {pitch}
          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            {ballChip || <span />}
            <FormationToggle hasOpp={play.players.some((p) => p.team === 'opp')} />
          </div>
        </div>
        {step && (
          <StepTextPanel
            key={step.id}
            badge={step.isAltBranch ? (step.altLabel ?? stepIndex) : stepIndex}
            title={step.title}
            stepLabel={<span data-testid="anim-step-indicator" className="tabular-nums">Step {stepIndex + 1} of {total}</span>}
            ours={step.narrativeOurs}
            opp={step.narrativeOpp}
          />
        )}
        {stepBar}
        {controls}
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2" data-testid="animated-pitch">
      <div className="relative">
        {pitch}
        {holderLabel && <div className="pointer-events-none absolute left-3 top-3">{ballChip}</div>}
      </div>
      {controls}
      {stepBar}
    </div>
  )
}
