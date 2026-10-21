// Client-side API helpers for /api/plays
import type { Play, PlayInsert, PlayUpdate } from '@/lib/types/play'

async function handle<T>(res: Response): Promise<T> {
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `Request failed: ${res.status}`)
  return json as T
}

export async function listPlays(): Promise<Play[]> {
  const { plays } = await handle<{ plays: Play[] }>(await fetch('/api/plays'))
  return plays
}

export async function getPlay(id: string): Promise<Play> {
  const { play } = await handle<{ play: Play }>(await fetch(`/api/plays/${id}`))
  return play
}

export async function createPlay(input: PlayInsert): Promise<Play> {
  const { play } = await handle<{ play: Play }>(
    await fetch('/api/plays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
  return play
}

export async function updatePlay(id: string, input: PlayUpdate): Promise<Play> {
  const { play } = await handle<{ play: Play }>(
    await fetch(`/api/plays/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
  return play
}

export async function deletePlay(id: string): Promise<void> {
  await handle<{ ok: true }>(await fetch(`/api/plays/${id}`, { method: 'DELETE' }))
}
