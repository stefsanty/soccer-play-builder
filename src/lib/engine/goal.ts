// Goal detection for the turn builder: the opponent goal sits on the y = PITCH_H line, centred on
// the pitch, 7.32 m wide. A goal is the ball CROSSING into that mouth — a ball that already rests in
// the net when a turn starts (the previous turn scored) does not score again until it leaves and
// comes back, and a turn counts at most one goal.

import { PITCH_H, PITCH_W } from '@/lib/engine/pitch'

export const GOAL_WIDTH_M = 7.32
export const GOAL_HALF_W = GOAL_WIDTH_M / 2
/** y of the opponent goal line. */
export const GOAL_LINE_Y = PITCH_H
export const GOAL_CENTRE_X = PITCH_W / 2
/** How far behind the line the net reaches — the deepest spot a dribble may be aimed at. */
export const NET_DEPTH_M = 1.5

export interface GoalEvent {
  /** Index of the first frame in which the ball is in the goal. */
  frameIndex: number
}

/** Whether a ball at this spot is over the opponent goal line between the posts. */
export function inGoal(ball: { x: number; y: number }): boolean {
  return ball.y >= GOAL_LINE_Y && Math.abs(ball.x - GOAL_CENTRE_X) <= GOAL_HALF_W
}

/** The first crossing into the goal across the given frames, or null. */
export function detectGoal(frames: ReadonlyArray<{ ball: { x: number; y: number } }>): GoalEvent | null {
  let wasIn = frames.length > 0 && inGoal(frames[0].ball)
  for (let i = 1; i < frames.length; i++) {
    const isIn = inGoal(frames[i].ball)
    if (isIn && !wasIn) return { frameIndex: i }
    wasIn = isIn
  }
  return null
}
