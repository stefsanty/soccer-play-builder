import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SUPABASE_NOT_CONFIGURED } from '@/lib/supabase/config'
import { insertToRow, rowToPlay, type PlayRow } from '@/lib/api/playMapping'

const noDb = () => NextResponse.json({ error: SUPABASE_NOT_CONFIGURED }, { status: 503 })

// GET /api/plays — list public plays
export async function GET() {
  const supabase = await createClient()
  if (!supabase) return noDb()

  const { data, error } = await supabase
    .from('plays')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plays: (data as PlayRow[]).map(rowToPlay) })
}

// POST /api/plays — create a play (body is the Play JSON). MVP: no auth.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  if (!supabase) return noDb()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data, error } = await supabase.from('plays').insert(insertToRow(body)).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ play: rowToPlay(data as PlayRow) }, { status: 201 })
}
