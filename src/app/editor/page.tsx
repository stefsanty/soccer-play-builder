import { PitchEditor } from '@/components/editor/PitchEditor'
import { EditorTopBar } from '@/components/editor/EditorTopBar'

export default function EditorPage() {
  return (
    <div className="flex h-dvh flex-col bg-[var(--bg-base)] text-white">
      <EditorTopBar />
      <PitchEditor />
    </div>
  )
}
