// Maps between the snake_case `plays` table row and the camelCase Play model.
import type { Play, PlayInsert, PlayUpdate } from '@/lib/types/play'

export interface PlayRow {
  id: string
  author_id: string | null
  author_name: string
  title: string
  description: string | null
  formation: string
  is_public: boolean
  tags: string[]
  view_side: string
  players: Play['players']
  steps: Play['steps']
  fork_of: string | null
  created_at: string
  updated_at: string
}

export function rowToPlay(row: PlayRow): Play {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    authorId: row.author_id ?? '',
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    meta: {
      formation: row.formation as Play['meta']['formation'],
      viewSide: row.view_side as Play['meta']['viewSide'],
      tags: row.tags ?? [],
      isPublic: row.is_public,
      forkOf: row.fork_of ?? undefined,
    },
    players: row.players ?? [],
    steps: row.steps ?? [],
  }
}

export function insertToRow(body: Partial<PlayInsert>) {
  return {
    // MVP has no auth: author_id stays null (the FK to auth.users is nullable).
    author_id: null,
    author_name: body.authorName || 'Anonymous',
    title: body.title || 'Untitled play',
    description: body.description ?? null,
    formation: body.meta?.formation ?? 'custom',
    // Public by default so saved plays show up in the library.
    is_public: body.meta?.isPublic ?? true,
    tags: body.meta?.tags ?? [],
    view_side: body.meta?.viewSide ?? 'right',
    players: body.players ?? [],
    steps: body.steps ?? [],
    fork_of: body.meta?.forkOf ?? null,
  }
}

export function updateToRow(body: PlayUpdate) {
  return {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.authorName !== undefined && { author_name: body.authorName }),
    ...(body.meta?.formation !== undefined && { formation: body.meta.formation }),
    ...(body.meta?.isPublic !== undefined && { is_public: body.meta.isPublic }),
    ...(body.meta?.tags !== undefined && { tags: body.meta.tags }),
    ...(body.meta?.viewSide !== undefined && { view_side: body.meta.viewSide }),
    ...(body.players !== undefined && { players: body.players }),
    ...(body.steps !== undefined && { steps: body.steps }),
  }
}
