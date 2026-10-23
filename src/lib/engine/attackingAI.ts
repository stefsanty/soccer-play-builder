// Attacking AI: automatic support movement for non-locked players.
// Pure functions — no store or React dependencies.

import type { PlayStep } from '@/lib/types/play'

const PITCH_W = 68
const PITCH_H = 105

export interface PitchState {
  players: Array<{ id: string; team: 'ours' | 'opp'; x: number; y: number }>
  ball: { x: number; y: number; holderId: string | null }
  attackingTeam: 'ours' | 'opp'
}

export interface AISuggestedMove {
  playerId: string
  toX: number
  toY: number
  startTime: number
  endTime: number
  reason: 'support' | 'spacing' | 'passing-lane' | 'danger-zone'
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const d2 = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay)

// attackDir 1 = team attacks toward y=105 (high y); -1 = toward y=0.
function pitchProgress(y: number, attackDir: 1 | -1): number {
  return attackDir === 1 ? y / PITCH_H : 1 - y / PITCH_H
}

type Zone = 'defensive' | 'middle' | 'attacking'

function getZone(y: number, attackDir: 1 | -1): Zone {
  const p = pitchProgress(y, attackDir)
  if (p < 0.33) return 'defensive'
  if (p < 0.67) return 'middle'
  return 'attacking'
}

// Canonical danger zones (attackDir 1 = high y):
// box corners, half-spaces (channels between centre-back and full-back), penalty spot area.
const DANGER_HIGH: [number, number][] = [
  [12, 91], [56, 91],   // box corners
  [20, 83], [48, 83],   // half-spaces
  [34, 95],             // penalty spot area
]
const DANGER_LOW: [number, number][] = [
  [12, 14], [56, 14],
  [20, 22], [48, 22],
  [34, 10],
]

function idealZonePos(
  p: { x: number; y: number },
  zone: Zone,
  ball: { x: number; y: number },
  attackDir: 1 | -1,
  slotIndex: number,
  slotCount: number,
): { x: number; y: number } {
  if (zone === 'defensive') {
    // Spread evenly across width; hold depth with a small forward nudge.
    const spacing = PITCH_W / (slotCount + 1)
    return {
      x: clamp(spacing * (slotIndex + 1), 5, PITCH_W - 5),
      y: clamp(p.y + attackDir * 4, 5, PITCH_H - 5),
    }
  }

  if (zone === 'middle') {
    // Two-wide triangle ahead of ball: odd index goes left, even goes right.
    const side = slotIndex % 2 === 0 ? -11 : 11
    const depth = attackDir * (9 + Math.floor(slotIndex / 2) * 6)
    return {
      x: clamp(ball.x + side, 5, PITCH_W - 5),
      y: clamp(ball.y + depth, 5, PITCH_H - 5),
    }
  }

  // Attacking third: rotate through danger-zone slots.
  const zones = attackDir === 1 ? DANGER_HIGH : DANGER_LOW
  const slot = zones[slotIndex % zones.length]
  return { x: slot[0], y: slot[1] }
}

function supportPos(
  passer: { x: number; y: number },
  receiver: { x: number; y: number },
  attackDir: 1 | -1,
): { x: number; y: number } {
  // Move diagonally behind-and-beside the receiver: same side the passer came from.
  const side = passer.x >= receiver.x ? 9 : -9
  return {
    x: clamp(receiver.x + side, 5, PITCH_W - 5),
    y: clamp(receiver.y - attackDir * 6, 5, PITCH_H - 5),
  }
}

/** Compute AI-suggested movements for all non-locked attacking players. */
export function computeAutoMovements(
  step: PlayStep,
  pitchState: PitchState,
  lockedPlayerIds: Set<string>,
): AISuggestedMove[] {
  const { players, ball, attackingTeam } = pitchState
  const attackDir: 1 | -1 = attackingTeam === 'ours' ? 1 : -1

  // Players with authored moves in this step are treated as locked.
  const movedSet = new Set(step.moves.map((m) => m.playerId))
  const locked = new Set([...lockedPlayerIds, ...movedSet])

  const attackers = players.filter((p) => p.team === attackingTeam)
  const opps = players.filter((p) => p.team !== attackingTeam)

  const suggestions: AISuggestedMove[] = []

  // --- Pass-triggered: passer support run ---
  for (const pass of step.passes) {
    if (locked.has(pass.from)) continue
    const passer = attackers.find((p) => p.id === pass.from)
    const receiver = attackers.find((p) => p.id === pass.to)
    if (!passer || !receiver) continue

    const dest = supportPos(passer, receiver, attackDir)
    const dist = d2(passer.x, passer.y, dest.x, dest.y)
    if (dist < 2) continue

    suggestions.push({
      playerId: pass.from,
      toX: dest.x,
      toY: dest.y,
      startTime: pass.endTime,
      endTime: pass.endTime + dist / 15,
      reason: 'support',
    })
    locked.add(pass.from)
  }

  // --- Space-seeking for all remaining free players ---
  const free = attackers.filter((p) => !locked.has(p.id) && p.id !== ball.holderId)

  // Group by zone so slot indices are per-zone.
  const byZone = new Map<Zone, typeof free>([
    ['defensive', []],
    ['middle', []],
    ['attacking', []],
  ])
  for (const p of free) byZone.get(getZone(p.y, attackDir))!.push(p)

  for (const [zone, zonePlayers] of byZone) {
    zonePlayers.forEach((p, idx) => {
      const ideal = idealZonePos(p, zone, ball, attackDir, idx, zonePlayers.length)

      // 0.4 — toward ideal zone position
      let dx = 0.4 * (ideal.x - p.x)
      let dy = 0.4 * (ideal.y - p.y)

      // 0.3 — away from nearest opponent (inverse-distance weighted)
      let nearOppDist = Infinity
      let nearOpp: { x: number; y: number } | null = null
      for (const o of opps) {
        const od = d2(p.x, p.y, o.x, o.y)
        if (od < nearOppDist) { nearOppDist = od; nearOpp = o }
      }
      if (nearOpp && nearOppDist > 0) {
        const w = 0.3 * Math.min(12, 8 / nearOppDist)
        dx += w * (p.x - nearOpp.x) / nearOppDist
        dy += w * (p.y - nearOpp.y) / nearOppDist
      }

      // 0.2 — away from nearest teammate within 3 m (anti-clustering)
      for (const mate of attackers) {
        if (mate.id === p.id) continue
        const md = d2(p.x, p.y, mate.x, mate.y)
        if (md < 3 && md > 0) {
          const w = 0.2 * (3 - md) / 3
          dx += w * (p.x - mate.x) / md
          dy += w * (p.y - mate.y) / md
        }
      }

      // 0.1 — nudge toward 40° passing lane angle from ball carrier
      if (ball.holderId) {
        const carrier = attackers.find((a) => a.id === ball.holderId)
        if (carrier) {
          const distBall = d2(p.x, p.y, carrier.x, carrier.y)
          if (distBall > 5) {
            const baseAngle = Math.atan2(carrier.y - p.y, carrier.x - p.x)
            const idealAngle = baseAngle + (Math.PI / 4.5) * (p.x >= carrier.x ? 1 : -1)
            dx += 0.1 * Math.cos(idealAngle) * 6
            dy += 0.1 * Math.sin(idealAngle) * 6
          }
        }
      }

      const toX = clamp(p.x + dx, 3, PITCH_W - 3)
      const toY = clamp(p.y + dy, 3, PITCH_H - 3)
      const moveDist = d2(p.x, p.y, toX, toY)
      if (moveDist < 2.5) return // below noise floor

      suggestions.push({
        playerId: p.id,
        toX,
        toY,
        startTime: 0,
        endTime: moveDist / 15,
        reason: zone === 'attacking' ? 'danger-zone' : 'spacing',
      })
    })
  }

  return suggestions
}
