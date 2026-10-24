import type { Metadata } from 'next'
import { BuilderClient } from '@/components/builder/BuilderClient'

export const metadata: Metadata = {
  title: 'Turn Builder — Soccer Play Builder',
  description: 'Turn-based play builder: queue passes, dribbles and runs, play the turn, rewind any action.',
}

export default function BuilderPage() {
  return <BuilderClient />
}
