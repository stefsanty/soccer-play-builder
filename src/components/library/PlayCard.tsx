import Link from 'next/link'
import type { Play } from '@/lib/types/play'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface PlayCardProps {
  play: Play
}

export function PlayCard({ play }: PlayCardProps) {
  return (
    <Link href={`/play/${play.id}`}>
      <Card className="hover:border-slate-500 transition-colors">
        <CardHeader>
          <CardTitle className="text-base">{play.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{play.meta.formation}</Badge>
          {play.meta.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
          <span className="ml-auto">{play.authorName}</span>
        </CardContent>
      </Card>
    </Link>
  )
}
