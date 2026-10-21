import Link from 'next/link'
import type { Play } from '@/lib/types/play'
import { PlayCard } from '@/components/library/PlayCard'

interface PlayGridProps {
  plays: Play[]
}

export function PlayGrid({ plays }: PlayGridProps) {
  if (plays.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 pb-20 text-center">
        <svg width="120" height="80" viewBox="0 0 104 70" role="img" aria-label="Empty pitch" className="mb-2 rounded-[10px]">
          <rect width="104" height="70" fill="#2c7a3b" />
          <g fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1">
            <line x1="52" y1="0" x2="52" y2="70" />
            <circle cx="52" cy="35" r="9" />
            <rect x="0.5" y="18" width="18" height="34" />
            <rect x="85.5" y="18" width="18" height="34" />
          </g>
        </svg>
        <div className="text-lg font-bold">No plays yet</div>
        <div className="text-sm leading-[1.4] text-[var(--app-muted)]">
          Sketch a pattern, step through it, and share it with your squad.
        </div>
        <Link
          href="/new"
          className="mt-2.5 flex h-12 items-center justify-center rounded-[14px] bg-[var(--app-accent)] px-5 text-base font-bold text-[var(--app-accent-ink)] no-underline"
        >
          Create your first play
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {plays.map((play) => (
        <PlayCard key={play.id} play={play} />
      ))}
    </div>
  )
}
