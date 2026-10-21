import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/plays — list public plays (and the caller's own, when signed in)
export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plays')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ plays: data })
}

// POST /api/plays — create a play for the signed-in user
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { data, error } = await supabase
    .from('plays')
    .insert({
      author_id: user.id,
      author_name: body.authorName ?? 'Anonymous',
      title: body.title ?? 'Untitled play',
      description: body.description ?? null,
      formation: body.meta?.formation ?? 'custom',
      is_public: body.meta?.isPublic ?? false,
      tags: body.meta?.tags ?? [],
      view_side: body.meta?.viewSide ?? 'right',
      players: body.players ?? [],
      steps: body.steps ?? [],
      fork_of: body.meta?.forkOf ?? null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ play: data }, { status: 201 })
}
