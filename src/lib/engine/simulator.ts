// Step simulation: given a step and a time within it, compute every
// player's position. Attackers follow their authored moves; defenders
// follow zone/mark rules (ported from the futcal reference engine).

import type { DefenderRule, PlayerPosition, PlayStep } from '@/lib/types/play'
import { tweenPosition } from '@/lib/engine/physics'

export interface SimFrame {
  // playerId -> [x, y] in meters at time t
  positions: Record<string, [number, number]>
}

/** Positions of every player at time `t` (seconds) within `step`,
 *  starting from `startPositions` (positions at the end of the previous step). */
export function simulateStep(
  step: PlayStep,
  startPositions: Record<string, [number, number]>,
  players: PlayerPosition[],
  t: number,
): SimFrame {
  const positions: Record<string, [number, number]> = { ...startPositions }

  // Authored moves (our team + any explicit opponent moves)
  for (const move of step.moves) {
    const from = startPositions[move.playerId]
    if (!from) continue
    const span = move.endTime - move.startTime
    const local = span > 0 ? (t - move.startTime) / span : 1
    positions[move.playerId] = tweenPosition(
      from,
      [move.toX, move.toY],
      local,
      move.easeFraction,
      move.via,
    )
  }

  // Defender AI: zone / mark rules
  for (const [oppId, rules] of Object.entries(step.defenderRules)) {
    const from = startPositions[oppId]
    if (!from || rules.length === 0) continue
    positions[oppId] = applyDefenderRules(rules, from, positions, step.duration, t)
  }

  return { positions }
}

function applyDefenderRules(
  rules: DefenderRule[],
  from: [number, number],
  current: Record<string, [number, number]>,
  duration: number,
  t: number,
): [number, number] {
  // Last rule whose delay has elapsed wins
  const active = [...rules].reverse().find(r => t >= (r.delay ?? 0))
  if (!active) return from

  const delay = active.delay ?? 0
  const local = duration - delay > 0 ? (t - delay) / (duration - delay) : 1

  if (active.type === 'zone') {
    return tweenPosition(from, active.target, local)
  }

  // mark: trail the attacker by `gap` meters (goal side), blended toward zone
  const attacker = current[active.attacker]
  if (!attacker) return tweenPosition(from, active.zone, local)
  const markPoint: [number, number] = [
    attacker[0] + (active.dx ?? 0),
    attacker[1] - active.gap,
  ]
  const target: [number, number] = [
    markPoint[0] + (active.zone[0] - markPoint[0]) * active.weight,
    markPoint[1] + (active.zone[1] - markPoint[1]) * active.weight,
  ]
  return tweenPosition(from, target, local)
}

/** Positions of every player at the END of a step — used to chain steps. */
export function endPositions(
  step: PlayStep,
  startPositions: Record<string, [number, number]>,
  players: PlayerPosition[],
): Record<string, [number, number]> {
  return simulateStep(step, startPositions, players, step.duration).positions
}

/** Starting positions keyed by player id. */
export function initialPositions(players: PlayerPosition[]): Record<string, [number, number]> {
  return Object.fromEntries(players.map(p => [p.id, [p.x, p.y] as [number, number]]))
}
