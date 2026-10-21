import Link from 'next/link'
import type { Play } from '@/lib/types/play'
import { PITCH_W, PITCH_H } from '@/lib/engine/pitch'

interface PlayCardProps {
  play: Play
}

/** Landscape thumbnail: pitch length runs left to right, players plotted from their starting positions. */
function PitchThumb({ play }: { play: Play }) {
  return (
    <svg
      width="104"
      height="70"
      viewBox="0 0 104 70"
      role="img"
      aria-label="Play thumbnail"
      className="shrink-0 rounded-lg"
      style={{ flex: '0 0 104px' }}
    >
      <rect width="104" height="70" fill="#2c7a3b" />
      <g fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1">
        <line x1="52" y1="0" x2="52" y2="70" />
        <circle cx="52" cy="35" r="9" />
        <rect x="0.5" y="18" width="18" height="34" />
        <rect x="85.5" y="18" width="18" height="34" />
      </g>
      {play.players.map((p) => (
        <circle
          key={p.id}
          cx={Math.min(100, Math.max(4, (p.y / PITCH_H) * 104))}
          cy={Math.min(66, Math.max(4, (p.x / PITCH_W) * 70))}
          r="4"
          fill={p.team === 'ours' ? '#2f8cff' : '#e5484d'}
          stroke="#fff"
          strokeWidth="1"
        />
      ))}
    </svg>
  )
}

export function relativeEdited(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const days = Math.floor((now - t) / 86_400_000)
  if (days <= 0) return 'Edited today'
  if (days === 1) return 'Edited yesterday'
  if (days < 7) return `Edited ${days} days ago`
  if (days < 14) return 'Edited last week'
  if (days < 60) return `Edited ${Math.floor(days / 7)} weeks ago`
  return `Edited ${new Date(iso).toLocaleDateString()}`
}

export function stepSummary(play: Play): string {
  const main = play.steps.filter((s) => !s.isAltBranch).length
  const branches = play.steps.length - main
  const steps = `${main} step${main === 1 ? '' : 's'}`
  return branches > 0 ? `${steps}, ${branches} branch${branches === 1 ? '' : 'es'}` : steps
}

export function PlayCard({ play }: PlayCardProps) {
  return (
    <Link
      href={`/play/${play.id}`}
      className="flex touch-manipulation items-center gap-3.5 rounded-[14px] bg-[var(--app-card)] p-3 text-[#e8edf2] no-underline transition-all duration-100 hover:bg-[#1a222b] active:scale-[0.98] active:bg-[#202a35]"
    >
      <PitchThumb play={play} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="truncate text-base font-semibold">{play.title}</div>
        <div className="text-[13px] text-[var(--app-muted)]">{stepSummary(play)}</div>
        <div className="text-xs text-[var(--app-muted)]">{relativeEdited(play.updatedAt || play.createdAt)}</div>
      </div>
    </Link>
  )
}
