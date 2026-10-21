import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SUPABASE_NOT_CONFIGURED } from '@/lib/supabase/config'
import { rowToPlay, updateToRow, type PlayRow } from '@/lib/api/playMapping'

type RouteContext = { params: Promise<{ id: string }> }

const noDb = () => NextResponse.json({ error: SUPABASE_NOT_CONFIGURED }, { status: 503 })

// GET /api/plays/:id
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const supabase = await createClient()
  if (!supabase) return noDb()

  const { data, error } = await supabase.from('plays').select('*').eq('id', id).single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ play: rowToPlay(data as PlayRow) })
}

// PUT /api/plays/:id — update a play. MVP: no auth.
export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const supabase = await createClient()
  if (!supabase) return noDb()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('plays')
    .update(updateToRow(body))
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ play: rowToPlay(data as PlayRow) })
}

// DELETE /api/plays/:id. MVP: no auth.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const supabase = await createClient()
  if (!supabase) return noDb()

  const { error } = await supabase.from('plays').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
