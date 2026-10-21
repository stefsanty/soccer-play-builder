'use client'

// Play / Pause / Speed / Step navigation for the viewer.

import { Button } from '@/components/ui/button'

interface PlayControlsProps {
  isPlaying: boolean
  onTogglePlay: () => void
  onPrevStep: () => void
  onNextStep: () => void
  speed: number
  onSpeedChange: (speed: number) => void
}

export function PlayControls({
  isPlaying,
  onTogglePlay,
  onPrevStep,
  onNextStep,
  speed,
  onSpeedChange,
}: PlayControlsProps) {
  return (
    <div className="flex items-center gap-2 p-2">
      <Button variant="secondary" size="sm" onClick={onPrevStep} aria-label="Previous step">
        ⏮
      </Button>
      <Button size="sm" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? '⏸' : '▶'}
      </Button>
      <Button variant="secondary" size="sm" onClick={onNextStep} aria-label="Next step">
        ⏭
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSpeedChange(speed >= 2 ? 0.5 : speed * 2)}
        aria-label="Playback speed"
      >
        {speed}×
      </Button>
    </div>
  )
}
