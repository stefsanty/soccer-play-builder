import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SaveButton } from '@/components/editor/SaveButton'
import { createDefaultPlay } from '@/lib/engine/defaultPlay'
import { useEditorStore } from '@/lib/store/editorStore'
import { createPlay } from '@/lib/api/plays'
import type { Play, PlayInsert } from '@/lib/types/play'

vi.mock('@/lib/api/plays', () => ({
  createPlay: vi.fn(async (input: PlayInsert): Promise<Play> => ({ ...input, id: 'saved-1', createdAt: '', updatedAt: '' })),
  updatePlay: vi.fn(),
}))

describe('SaveButton with a play passed in (the turn builder path)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    useEditorStore.setState({ play: null, isDirty: true })
  })
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    vi.clearAllMocks()
  })

  it('saves the given play (not the editor store) and reports the stored play back', async () => {
    const play = { ...createDefaultPlay(), title: 'Turn Builder — test game' }
    const onSaved = vi.fn()
    render(<SaveButton play={play} onSaved={onSaved} />)
    fireEvent.click(screen.getByTestId('save-button'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(createPlay).toHaveBeenCalledWith(expect.objectContaining({ title: 'Turn Builder — test game', steps: play.steps }))
    expect(onSaved.mock.calls[0][0].id).toBe('saved-1')
    // the editor store is not touched: its own dirty flag stays as it was
    expect(useEditorStore.getState().isDirty).toBe(true)
  })

  it('shows the database notice instead when Supabase is not configured', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const onSaved = vi.fn()
    render(<SaveButton play={createDefaultPlay()} onSaved={onSaved} />)
    fireEvent.click(screen.getByTestId('save-button'))
    expect(screen.getByTestId('db-banner')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
