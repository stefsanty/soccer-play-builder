'use client'

// THE MAIN COMPONENT: SVG pitch with drag handles.
// Renders players at their positions for the current step and lets the
// coach drag them (move mode), draw passes/runs, or select for editing.

import { useEditorStore } from '@/lib/store/editorStore'
import { X, Y } from '@/lib/engine/pitch'

export function PitchEditor() {
  const play = useEditorStore((s) => s.play)
  const selectedPlayerId = useEditorStore((s) => s.selectedPlayerId)
  const selectPlayer = useEditorStore((s) => s.selectPlayer)

  return (
    <svg
      viewBox="0 0 580 890"
      className="w-full h-full max-h-[85vh] bg-emerald-900 rounded-lg"
      role="img"
      aria-label="Soccer pitch editor"
    >
      {/* Pitch outline — half-pitch right side, reference style */}
      <rect x={20} y={40} width={520} height={830} fill="none" stroke="white" strokeOpacity={0.5} strokeWidth={2} />
      {play?.players.map((p) => (
        <g
          key={p.id}
          transform={`translate(${X(p.x)}, ${Y(p.y)})`}
          onClick={() => selectPlayer(p.id)}
          className="cursor-pointer"
          opacity={p.isContext ? 0.4 : 1}
        >
          <circle
            r={14}
            fill={p.team === 'ours' ? '#3b82f6' : '#ef4444'}
            stroke={selectedPlayerId === p.id ? 'white' : 'transparent'}
            strokeWidth={3}
          />
          <text textAnchor="middle" dy={5} fontSize={11} fill="white" fontWeight={700}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
