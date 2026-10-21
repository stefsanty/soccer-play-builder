import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/plays/:id
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const supabase = await createClient()
  const { data, error } = await supabase.from('plays').select('*').eq('id', id).single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return NextResponse.json({ play: data })
}

// PUT /api/plays/:id — update own play (RLS enforces ownership)
export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const supabase = await createClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from('plays')
    .update({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.meta?.formation !== undefined && { formation: body.meta.formation }),
      ...(body.meta?.isPublic !== undefined && { is_public: body.meta.isPublic }),
      ...(body.meta?.tags !== undefined && { tags: body.meta.tags }),
      ...(body.meta?.viewSide !== undefined && { view_side: body.meta.viewSide }),
      ...(body.players !== undefined && { players: body.players }),
      ...(body.steps !== undefined && { steps: body.steps }),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ play: data })
}

// DELETE /api/plays/:id — delete own play (RLS enforces ownership)
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const supabase = await createClient()
  const { error } = await supabase.from('plays').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
