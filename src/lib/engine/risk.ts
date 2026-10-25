// Risk of losing the ball on a pass or a dribble, from the defenders' positions at the turn start.
//
//   pass    : the defender nearest the pass lane decides it. closeness = (1 - d / LANE_REACH)^1.5 for
//             his distance d to the lane (the receiver's spot counts as part of the lane: a tight
//             marker on the receiver is a threat too), scaled by pass length — a long ball spends
//             longer in the air: length factor 0.4 + 0.6 · len / PASS_RANGE. risk = MAX_RISK · ...
//   dribble : every defender within TACKLE_REACH of the path may tackle: each adds
//             TACKLE_MAX · (1 - d / TACKLE_REACH); chances combine as 1 - Π(1 - r). Capped at MAX_RISK.
//
// Pure functions. The UI shows the % on the ghost arrow and rolls the dice on Play (rollRisk).

import { PASS_RANGE_M } from '@/lib/engine/turnBuilder'
import { distToSegment } from '@/lib/engine/shot'

type Pt = [number, number]

export interface Defender {
  id: string
  at: Pt
}

export interface Risk {
  /** 0..1 chance of losing the ball. */
  risk: number
  /** The defender most likely to win it (null when the risk is 0). */
  by: string | null
}

/** A defender this far from a pass lane can still cut it out. */
export const LANE_REACH_M = 6
/** A defender this far from a dribble path can get a foot in. */
export const TACKLE_REACH_M = 2.5
/** The most one defender adds to a dribble's risk. */
export const TACKLE_MAX = 0.35
/** No single action is riskier than this. */
export const MAX_RISK = 0.85

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const NONE: Risk = { risk: 0, by: null }

export function passRisk(from: Pt, to: Pt, defenders: Defender[]): Risk {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1])
  const lengthFactor = clamp(0.4 + 0.6 * (len / PASS_RANGE_M), 0.4, 1)
  let best: Risk = NONE
  for (const d of defenders) {
    const { d: dist } = distToSegment(d.at, from, to)
    if (dist >= LANE_REACH_M) continue
    const closeness = (1 - dist / LANE_REACH_M) ** 1.5
    const risk = clamp(MAX_RISK * closeness * lengthFactor, 0, MAX_RISK)
    if (risk > best.risk) best = { risk, by: d.id }
  }
  return best.risk > 0 ? best : NONE
}

export function dribbleRisk(from: Pt, to: Pt, defenders: Defender[]): Risk {
  let keep = 1
  let by: string | null = null
  let byRisk = 0
  for (const d of defenders) {
    const { d: dist } = distToSegment(d.at, from, to)
    if (dist >= TACKLE_REACH_M) continue
    const r = TACKLE_MAX * (1 - dist / TACKLE_REACH_M)
    keep *= 1 - r
    if (r > byRisk) {
      byRisk = r
      by = d.id
    }
  }
  const risk = clamp(1 - keep, 0, MAX_RISK)
  return risk > 0 ? { risk, by } : NONE
}

export type RiskResult = 'lost' | 'kept'

/** Roll the dice on a risky action: the ball is lost when the roll lands under the risk. */
export function rollRisk(risk: number, rng: () => number = Math.random): RiskResult {
  return rng() < risk ? 'lost' : 'kept'
}
