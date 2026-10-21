import { PITCH_W, PITCH_H } from '@/lib/engine/pitch'

const LINE = { fill: 'none', stroke: 'white', strokeOpacity: 0.7, strokeWidth: 2 } as const

export function PitchMarkings() {
  const w = PITCH_W * 10
  const h = PITCH_H * 10
  const cx = w / 2
  // Penalty box 40.3 x 16.5m, goal area 18.3 x 5.5m, penalty spot 11m, arc radius 9.15m
  const arcDx = 55
  const arcDy = Math.sqrt(91.5 ** 2 - 55 ** 2)
  const box = (top: boolean) => {
    const dir = top ? 1 : -1
    const goalLine = top ? 0 : h
    const arcY = goalLine + dir * (165 + arcDy)
    return (
      <g key={top ? 'top' : 'bottom'}>
        <rect x={cx - 201.5} y={top ? 0 : h - 165} width={403} height={165} {...LINE} />
        <rect x={cx - 91.5} y={top ? 0 : h - 55} width={183} height={55} {...LINE} />
        <circle cx={cx} cy={goalLine + dir * 110} r={2.5} fill="white" fillOpacity={0.7} />
        <path d={`M ${cx - arcDx} ${arcY} A 91.5 91.5 0 0 ${top ? 0 : 1} ${cx + arcDx} ${arcY}`} {...LINE} />
      </g>
    )
  }
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} {...LINE} />
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} {...LINE} />
      <circle cx={cx} cy={h / 2} r={91.5} {...LINE} />
      <circle cx={cx} cy={h / 2} r={2.5} fill="white" fillOpacity={0.7} />
      {box(true)}
      {box(false)}
    </g>
  )
}
