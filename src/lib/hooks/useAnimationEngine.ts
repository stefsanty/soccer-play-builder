'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Play } from '@/lib/types/play'
import { stepSeconds } from '@/lib/engine/computeFrame'
import { getTimeline, sampleTimeline, type SimFrame, type StepTimeline } from '@/lib/engine/simulator'

export interface AnimationEngine {
  frame: SimFrame | null
  /** The simulated step the frame comes from (annotations, pass origins, start state). */
  timeline: StepTimeline | null
  /** Seconds into the step. */
  time: number
  isPlaying: boolean
  /** Start (or resume) playback; restarts from 0 if the step already finished. */
  play: () => void
  pause: () => void
  /** Jump to `t` (0..1) within the step. Does not change play/pause state. */
  seek: (t: number) => void
  /** Pause and rewind to the start of the step. */
  reset: () => void
  /** 0..1 position within the current step. */
  progress: number
}

/**
 * rAF playback loop for one step of a play. Pauses itself at the end of the
 * step (it never advances to the next one) and rewinds when the play or step changes.
 */
export function useAnimationEngine(play: Play | null, stepIndex: number, speed = 1): AnimationEngine {
  const [progress, setProgress] = useState(0)
  const speedRef = useRef(speed)
  speedRef.current = speed
  const [isPlaying, setIsPlaying] = useState(false)
  const progressRef = useRef(0)

  const duration = stepSeconds(play?.steps[stepIndex]?.duration)

  const seek = useCallback((t: number) => {
    const v = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
    progressRef.current = v
    setProgress(v)
  }, [])

  const pause = useCallback(() => setIsPlaying(false), [])
  const reset = useCallback(() => {
    setIsPlaying(false)
    seek(0)
  }, [seek])
  const start = useCallback(() => {
    if (progressRef.current >= 1) seek(0)
    setIsPlaying(true)
  }, [seek])

  // New play or step → rewind and stop.
  useEffect(() => {
    reset()
  }, [play?.id, stepIndex, reset])

  useEffect(() => {
    if (!isPlaying || !play) return
    let raf = 0
    let last: number | null = null
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000
      last = now
      const next = Math.min(1, progressRef.current + (dt * speedRef.current) / duration)
      progressRef.current = next
      setProgress(next)
      if (next >= 1) {
        setIsPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, play, duration])

  const timeline = useMemo(() => (play && play.steps.length > 0 ? getTimeline(play, stepIndex) : null), [play, stepIndex])
  const time = progress * duration
  const frame = useMemo(() => (timeline ? sampleTimeline(timeline, time) : null), [timeline, time])

  return { frame, timeline, time, isPlaying, play: start, pause, seek, reset, progress }
}
