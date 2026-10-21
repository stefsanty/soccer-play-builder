import type { Play } from '@/lib/types/play'
import { PlayCard } from '@/components/library/PlayCard'

interface PlayGridProps {
  plays: Play[]
}

export function PlayGrid({ plays }: PlayGridProps) {
  if (plays.length === 0) {
    return <p className="text-slate-500">No plays yet — create one in the editor.</p>
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {plays.map((play) => (
        <PlayCard key={play.id} play={play} />
      ))}
    </div>
  )
}
