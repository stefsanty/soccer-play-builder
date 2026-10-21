import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { Play } from '@/lib/types/play'

interface PlayCardProps {
  play: Play
}

function PitchThumb() {
  return (
    <svg viewBox="0 0 68 105" preserveAspectRatio="xMidYMid slice" className="size-16 shrink-0 rounded-lg bg-[#16a34a]" aria-hidden>
      <g fill="none" stroke="white" strokeOpacity="0.8" strokeWidth="2.5">
        <rect x="3" y="3" width="62" height="99" />
        <line x1="3" y1="52.5" x2="65" y2="52.5" />
        <circle cx="34" cy="52.5" r="9" />
        <rect x="14" y="3" width="40" height="16" />
        <rect x="14" y="86" width="40" height="16" />
      </g>
    </svg>
  )
}

export function PlayCard({ play }: PlayCardProps) {
  const date = new Date(play.createdAt || play.updatedAt)
  return (
    <Link
      href={`/play/${play.id}`}
      className="flex h-20 items-center gap-3 rounded-xl bg-[var(--bg-card)] px-2 pr-3 ring-1 ring-slate-700/60 transition-colors hover:ring-[#14b8a6]"
    >
      <PitchThumb />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-white">{play.title}</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          {isNaN(date.getTime()) ? '' : date.toLocaleDateString()}
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-slate-500" aria-hidden />
    </Link>
  )
}
