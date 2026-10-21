// Defender rules: the union, and the small constructors used when authoring steps.
//   zn(x, y, delay)                      go to a zone
//   mk(att, gap, w, zone, delay, dx)     stand goal-side of an attacker, blended with a zone
//   pr(att, delay, gap, dx)              press: close the attacker down at full pressure
//   fl(att, zone, bounds, delay, opts)   follow the attacker inside bounds, hand off when they leave
//   ai(delay, role)                      hand this player to the defensive AI
// The types live with the rest of the play model (types/play.ts) and are re-exported here.

import type { AiRole, AiRule, Bounds, DefenderRule, FollowRule, MarkRule, PressRule, ZoneRule } from '@/lib/types/play'

export type { AiConfig, AiRole, AiRule, Bounds, DefenderRule, FollowRule, MarkRule, PressRule, ZoneRule } from '@/lib/types/play'
export type Rule = DefenderRule
export type XY = [number, number]

export const zn = (x: number, y: number, delay = 0): ZoneRule => ({ type: 'zone', target: [x, y], delay })

export const mk = (att: string, gap: number, w: number, zone: XY, delay = 0, dx?: number): MarkRule => ({
  type: 'mark', attacker: att, gap, weight: w, zone, delay, ...(dx !== undefined && { dx }),
})

export const pr = (att: string, delay = 0, gap = 1.0, dx?: number): PressRule => ({
  type: 'press', att, delay, gap, ...(dx !== undefined && { dx }),
})

export const fl = (
  att: string,
  zone: XY,
  bounds: Bounds,
  delay = 0,
  o: Partial<Pick<FollowRule, 'gap' | 'w' | 'dx' | 'handoff'>> = {},
): FollowRule => ({ type: 'follow', att, zone, bounds, delay, gap: 2.5, w: 0.85, handoff: 'auto', ...o })

export const ai = (delay = 0, role: AiRole = 'auto'): AiRule => ({ type: 'ai', delay, role })
