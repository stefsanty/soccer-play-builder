import Link from 'next/link'
import type { Play } from '@/lib/types/play'

interface PlayCardProps {
  play: Play
}

function PitchThumb({ play }: { play: Play }) {
  return (
    <svg viewBox="0 0 68 105" className="h-28 w-full bg-[#16a34a]" aria-hidden>
      <rect x="1" y="1" width="66" height="103" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="0.8" />
      <line x1="1" y1="52.5" x2="67" y2="52.5" stroke="white" strokeOpacity="0.6" strokeWidth="0.8" />
      <circle cx="34" cy="52.5" r="9" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="0.8" />
      {play.players.map((p) => (
        <circle key={p.id} cx={p.x} cy={p.y} r="3" fill={p.team === 'ours' ? '#0ea5e9' : '#ef4444'} />
      ))}
    </svg>
  )
}

export function PlayCard({ play }: PlayCardProps) {
  const date = new Date(play.updatedAt || play.createdAt)
  return (
    <Link
      href={`/play/${play.id}`}
      className="block overflow-hidden rounded-xl bg-[#1e293b] ring-1 ring-slate-700/60 transition-colors hover:ring-[#14b8a6]"
    >
      <PitchThumb play={play} />
      <div className="p-3">
        <h3 className="truncate text-sm font-semibold text-white">{play.title}</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          {isNaN(date.getTime()) ? '' : date.toLocaleDateString()}
        </p>
      </div>
    </Link>
  )
}
