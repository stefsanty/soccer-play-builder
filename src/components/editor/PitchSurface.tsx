import { PITCH_W, PITCH_H } from '@/lib/engine/pitch'

/** Mown-grass background: base green with alternating stripes, spanning the editor viewBox (-20 -20 720 1090). */
export function PitchSurface() {
  const w = PITCH_W * 10
  const h = PITCH_H * 10
  const stripes = Array.from({ length: Math.ceil(h / 100) }, (_, i) => i)
    .filter((i) => i % 2 === 0)
    .map((i) => <rect key={i} x={-20} y={i * 100} width={w + 40} height={Math.min(100, h - i * 100)} fill="var(--pitch-stripe)" />)
  return (
    <g aria-hidden>
      <rect x={-20} y={-20} width={w + 40} height={h + 40} fill="var(--pitch)" />
      {stripes}
    </g>
  )
}
