import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const createClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))

import { GET, POST } from '@/app/api/plays/route'
import { GET as GET_ONE, PUT, DELETE } from '@/app/api/plays/[id]/route'

const row = {
  id: 'p1',
  author_id: null,
  author_name: 'Coach',
  title: 'Overlap',
  description: null,
  formation: '4-4-2',
  is_public: true,
  tags: ['wing'],
  view_side: 'right',
  players: [],
  steps: [],
  fork_of: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// Minimal chainable query-builder mock; every chain method returns itself and
// the builder is thenable / `.single()`-able with the supplied result.
function mockDb(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result)
  const from = vi.fn(() => builder)
  createClient.mockResolvedValue({ from })
  return { from, builder }
}

const jsonReq = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/plays', {
    method,
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body ?? {}) }),
  })
const ctx = { params: Promise.resolve({ id: 'p1' }) }

beforeEach(() => createClient.mockReset())

describe('plays API without a database', () => {
  beforeEach(() => createClient.mockResolvedValue(null))

  it('returns 503 for every verb', async () => {
    const responses = await Promise.all([
      GET(),
      POST(jsonReq('POST', {})),
      GET_ONE(jsonReq('GET', {}), ctx),
      PUT(jsonReq('PUT', {}), ctx),
      DELETE(jsonReq('DELETE', {}), ctx),
    ])
    for (const r of responses) {
      expect(r.status).toBe(503)
      expect((await r.json()).error).toMatch(/not configured/i)
    }
  })
})

describe('GET /api/plays', () => {
  it('lists public plays mapped to the Play model', async () => {
    const { builder } = mockDb({ data: [row], error: null })
    const res = await GET()
    const { plays } = await res.json()
    expect(builder.eq).toHaveBeenCalledWith('is_public', true)
    expect(plays[0]).toMatchObject({ id: 'p1', authorName: 'Coach', meta: { formation: '4-4-2', tags: ['wing'] } })
  })

  it('surfaces database errors as 500', async () => {
    mockDb({ data: null, error: { message: 'boom' } })
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe('POST /api/plays', () => {
  it('inserts a snake_case row and returns 201', async () => {
    const { from, builder } = mockDb({ data: row, error: null })
    const res = await POST(
      jsonReq('POST', { title: 'Overlap', authorName: 'Coach', meta: { formation: '4-4-2', tags: ['wing'] }, players: [], steps: [] }),
    )
    expect(res.status).toBe(201)
    expect(from).toHaveBeenCalledWith('plays')
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Overlap', author_name: 'Coach', formation: '4-4-2', is_public: true, author_id: null }),
    )
    expect((await res.json()).play.id).toBe('p1')
  })

  it('rejects malformed JSON with 400', async () => {
    mockDb({ data: row, error: null })
    const req = new NextRequest('http://localhost/api/plays', { method: 'POST', body: '{nope' })
    expect((await POST(req)).status).toBe(400)
  })
})

describe('/api/plays/[id]', () => {
  it('GET returns the play, 404 on error', async () => {
    mockDb({ data: row, error: null })
    expect((await GET_ONE(jsonReq('GET', {}), ctx)).status).toBe(200)
    mockDb({ data: null, error: { message: 'not found' } })
    expect((await GET_ONE(jsonReq('GET', {}), ctx)).status).toBe(404)
  })

  it('PUT only updates provided fields', async () => {
    const { builder } = mockDb({ data: row, error: null })
    const res = await PUT(jsonReq('PUT', { title: 'New', meta: { tags: ['x'] } }), ctx)
    expect(res.status).toBe(200)
    expect(builder.update).toHaveBeenCalledWith({ title: 'New', tags: ['x'] })
    expect(builder.eq).toHaveBeenCalledWith('id', 'p1')
  })

  it('DELETE removes by id', async () => {
    const { builder } = mockDb({ data: null, error: null })
    const res = await DELETE(jsonReq('DELETE', {}), ctx)
    expect(await res.json()).toEqual({ ok: true })
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'p1')
  })
})
