import type { Play } from '@/lib/types/play'
import { PlayCard } from '@/components/library/PlayCard'

interface PlayGridProps {
  plays: Play[]
}

export function PlayGrid({ plays }: PlayGridProps) {
  if (plays.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-16 text-center">
        <p className="text-lg font-semibold text-slate-300">No plays yet</p>
        <p className="text-sm text-slate-500">Tap “+ New Play” to build your first one.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {plays.map((play) => (
        <PlayCard key={play.id} play={play} />
      ))}
    </div>
  )
}
