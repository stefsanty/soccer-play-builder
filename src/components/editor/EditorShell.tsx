'use client'

// Full editor screen for a saved play: top bar + pitch editor, starting from a clean editor state.

import { useLayoutEffect } from 'react'
import type { Play } from '@/lib/types/play'
import { useEditorStore } from '@/lib/store/editorStore'
import { EditorTopBar } from '@/components/editor/EditorTopBar'
import { PitchEditor } from '@/components/editor/PitchEditor'

export function EditorShell({ play }: { play: Play }) {
  // The editor store outlives navigation: drop step/mode/selection left over from a previous play.
  useLayoutEffect(() => {
    useEditorStore.setState({
      play,
      currentStepIndex: 0,
      mode: 'select',
      bottomMode: 'play',
      isPlayingAll: false,
      selectedPlayerId: null,
      isDirty: false,
      isPlaying: false,
      previewTime: 0,
    })
  }, [play])

  return (
    <div className="flex h-dvh flex-col bg-[var(--bg-base)] text-[#e8edf2]">
      <EditorTopBar />
      <PitchEditor play={play} />
    </div>
  )
}
