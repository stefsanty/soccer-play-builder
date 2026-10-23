// A standing measurement of the defensive AI, so a change to it can be judged against numbers instead of by
// eye. `npm run ai:report` prints this; aiReport.test.ts also asserts the parts that must not regress.
//
// Every figure here exists because a real defect hid behind its absence:
//   roles      a midfielder said to be "chasing the ball" turned out to press in 4 of 158 samples — the
//              complaint was really about lane cutting, which the drift columns show at a glance.
//   offShape   drift from HOME conflates the block moving with a player leaving it; drift from his own slot
//              (measured against a block-only run) is the one that says "out of position".
//   lanes      a cutter 6 m beside the pass blocks nothing, so coverage is counted, not assumed.
//   cohesion   the pass that keeps players together can be undone by the passes after it.
//   width      the width control once ran backwards: raising it opened the far wing instead of closing it.
//   phase1     a later change silently cut lane coverage from 3 outlets to 1, and only a spot-check caught it.

import { computeAiTargets, distPointToSegment, LANE_BLOCK_R, NEIGHBOUR_SLACK, type AiWorld, type AiWorldPlayer, type XY } from './ai'
import { getTimeline } from './simulator'
import { toPlayInsert } from '@/lib/seed/defensiveAiTest'
import type { Play } from '@/lib/types/play'

const CENTRE_X = 34
const PITCH_W = 68

const seeded = (): Play => ({ ...toPlayInsert(), id: 'ai-report', createdAt: '', updatedAt: '' })
const play = seeded()
const HOME = new Map(play.players.map((p) => [p.id, [p.x, p.y] as XY]))

/** Which band of the formation a slot belongs to, by its own depth — not by its name. */
function band(id: string): 'BACK' | 'MID' | 'FWD' {
  const y = HOME.get(id)![1]
  return y >= 78 ? 'BACK' : y >= 55 ? 'MID' : 'FWD'
}

/** Each outfield player's nearest neighbours in the formation, with the spacing the formation gives them. */
function formationNeighbours(players: AiWorldPlayer[], team: 'ours' | 'opp') {
  const outfield = players.filter((p) => p.team === team && !/gk/i.test(p.label))
  return new Map(
    outfield.map((p) => [
      p.id,
      outfield
        .filter((q) => q.id !== p.id)
        .map((q) => ({ id: q.id, d: Math.hypot(p.home[0] - q.home[0], p.home[1] - q.home[1]) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2),
    ]),
  )
}

function worldAt(ball: { x: number; y: number }, extra: Partial<AiWorld> = {}): AiWorld {
  const players: AiWorldPlayer[] = play.players.map((p) => ({
    id: p.id, team: p.team, label: p.label, x: p.x, y: p.y, home: HOME.get(p.id)!,
  }))
  return { players, ball, memory: {}, ...extra }
}

export interface RoleRow {
  key: string
  n: number
  /** Distance from the player's formation home: includes the whole block moving. */
  driftMean: number
  driftMax: number
  /** Distance from where the block alone would have put him: how far his JOB took him. */
  offShapeMean: number
  offShapeMax: number
  worst: string
}

/** Two defenders inside this of the same opponent are both covering him — one of them is wasted. */
export const DOUBLE_MARK_R = 6
/**
 * An opponent this far from every defender's slot is not the block's business — the attacking side's own
 * back four, forty metres behind the ball, are "unmarked" in the arithmetic sense and ought to be. Only
 * opponents inside the area the block is actually responsible for are counted as free.
 */
export const BLOCK_ZONE_R = 20
/** The roles that mean "holding the block": going to the ball is not, answering for a man is. */
const SHAPE_HOLDING: string[] = ['line', 'wide', 'screen', 'mark']

export interface AiReport {
  roles: RoleRow[]
  lanes: { assigned: number; onLane: number }
  cohesion: { worstOverstretch: number; worstPair: string }
  /** How often two shape-holding defenders end up on the same opponent, and how many opponents inside the
   *  block's area have nobody near them. */
  marking: { doubled: number; samples: number; unmarkedMean: number; inZoneMean: number }
  /** The closest two team-mates ever actually get, as they move — not as their targets are placed. */
  closest: { d: number; pair: string }
  /**
   * Who cuts which lane, split by whether the cutter's own slot is a flank one. `laneWide` is how far off
   * centre the receiver he picked is; `drift` is how far covering it took him off his own slot x. A winger
   * doing his job shows a high laneWide and a low drift; dragged infield is the opposite.
   */
  cutters: { wide: { n: number; laneWide: number; drift: number }; central: { n: number; laneWide: number; drift: number } }
  /** How often a player's actually-nearest team-mates are not the ones his formation puts beside him. */
  hood: { wrongMean: number; tier: number; samples: number; worst: string }
  width: { width: number; openWing: number; openWingVsWideAttacker: number; nearestToWideAttacker: number }[]
  phase1: { outlets: number; cut: number; cutters: string[]; backLineSpread: number }
}

/** Walks the seeded play's four defending steps frame by frame, which is as close to real use as a test gets. */
function roleCensus(): { roles: RoleRow[]; lanes: AiReport['lanes']; cohesion: AiReport['cohesion']; marking: AiReport['marking']; closest: AiReport['closest']; cutters: AiReport['cutters']; hood: AiReport['hood'] } {
  const acc = new Map<string, { n: number; drift: number[]; off: number[]; worst: string }>()
  let assigned = 0
  let onLane = 0
  let worstOverstretch = 0
  let worstPair = '-'
  let doubled = 0
  let closest = { d: Infinity, pair: '-' }
  const cut = { wide: { n: 0, laneWide: 0, drift: 0 }, central: { n: 0, laneWide: 0, drift: 0 } }
  let samples = 0
  let unmarkedTotal = 0
  let inZoneTotal = 0
  const hood = { n: 0, wrong: 0, tier: 0, worst: '-' }

  for (const stepIdx of [0, 1, 2, 3]) {
    const tl = getTimeline(play, stepIdx)
    for (let k = 0; k < tl.frames.length; k += 10) {
      const f = tl.frames[k]
      if (f.t < 0.8 || !f.ball.holder) continue
      const players: AiWorldPlayer[] = play.players.map((p) => ({
        id: p.id, team: p.team, label: p.label, x: f.players[p.id].x, y: f.players[p.id].y, home: HOME.get(p.id)!,
      }))
      const ball = { x: f.ball.x, y: f.ball.y }
      const w: AiWorld = { players, ball, memory: {}, owner: 'ours', focus: f.ball.holder, t: f.t }
      const full = computeAiTargets(w, 'opp', play.steps[stepIdx], { on: true })
      // aggressiveness 30 breaks nobody out of the block, so it reads as "where the shape alone wanted him"
      const shape = computeAiTargets({ ...w, memory: {} }, 'opp', play.steps[stepIdx], { on: true, aggressiveness: 30 })
      const nb = formationNeighbours(players, 'opp')

      for (const [id, v] of Object.entries(full)) {
        if (v.role === 'gk') continue
        const home = HOME.get(id)!
        const drift = Math.hypot(v.x - home[0], v.y - home[1])
        const off = shape[id] ? Math.hypot(v.x - shape[id].x, v.y - shape[id].y) : 0
        const key = `${band(id)}:${v.role}`
        const row = acc.get(key) ?? { n: 0, drift: [], off: [], worst: '-' }
        row.n++
        row.drift.push(drift)
        row.off.push(off)
        if (off >= Math.max(...row.off)) row.worst = `${id} step${stepIdx} t=${f.t.toFixed(1)}`
        acc.set(key, row)

        if (v.role === 'screen' && v.lane) {
          assigned++
          const a = players.find((q) => q.id === v.lane)
          if (a && distPointToSegment([v.x, v.y], [ball.x, ball.y], [a.x, a.y]) <= LANE_BLOCK_R) onLane++
          if (a) {
            const bucket = Math.abs(home[0] - CENTRE_X) >= 16 ? cut.wide : cut.central
            bucket.n++
            bucket.laneWide += Math.abs(a.x - CENTRE_X)
            bucket.drift += Math.abs(v.x - home[0])
          }
        }
        if (SHAPE_HOLDING.includes(v.role)) {
          for (const n of nb.get(id) ?? []) {
            const q = full[n.id]
            // only between two players who are both holding the shape: the distance to a team-mate who has
            // gone to press the ball is not a stretch in the shape, it is him doing his job
            if (!q || !SHAPE_HOLDING.includes(q.role)) continue
            const over = Math.hypot(q.x - v.x, q.y - v.y) - (n.d + NEIGHBOUR_SLACK)
            if (over > worstOverstretch) {
              worstOverstretch = over
              worstPair = `${id}/${n.id}`
            }
          }
        }
      }

      // How the opposition is covered: an opponent with two shape-holding defenders on him is one defender
      // wasted, and somewhere else a man is free. Counted per frame over the attacking side's outfielders.
      const holders = Object.entries(full)
        .filter(([, v]) => SHAPE_HOLDING.includes(v.role))
        .map(([, v]) => v)
      // Formation neighbourhood: whoever is actually nearest a player, against whoever the FORMATION puts
      // nearest him. A striker whose closest team-mates have become centre-backs has left his tier, which is
      // worse than merely being a few metres out of place.
      {
        const driven = Object.keys(full).filter((id) => full[id].role !== 'gk')
        const K = 3
        for (const id of driven) {
          const mine = HOME.get(id)!
          const formation = driven
            .filter((o) => o !== id)
            .map((o) => ({ id: o, d: Math.hypot(mine[0] - HOME.get(o)![0], mine[1] - HOME.get(o)![1]) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, K)
            .map((o) => o.id)
          const actual = driven
            .filter((o) => o !== id)
            .map((o) => ({ id: o, d: Math.hypot(full[id].x - full[o].x, full[id].y - full[o].y) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, K)
            .map((o) => o.id)
          const strangers = actual.filter((o) => !formation.includes(o))
          hood.n++
          hood.wrong += strangers.length / K
          const crossed = strangers.filter((o) => band(o) !== band(id) && (band(o) === 'BACK') !== (band(id) === 'BACK'))
          if (band(id) === 'FWD' && crossed.some((o) => band(o) === 'BACK')) {
            hood.tier++
            hood.worst = `${id} (${band(id)}) nearest: ${actual.map((o) => `${o}:${band(o)}`).join(' ')}`
          }
        }
      }

      // how close team-mates actually come to each other as they move
      // Only between two men who are both holding shape. One on a job — pressing, marking, following — is
      // deliberately allowed closer: he is going to a specific place and is not eased off it. An authored
      // player is not in `full` at all, which is how he is spotted here.
      const oppIds = players
        .filter((q) => q.team === 'opp' && !/gk/i.test(q.label))
        .filter((q) => full[q.id] && full[q.id].role !== 'presser' && full[q.id].role !== 'cover')
        .map((q) => q.id)
      for (let i = 0; i < oppIds.length; i++) {
        for (let j = i + 1; j < oppIds.length; j++) {
          const a = players.find((q) => q.id === oppIds[i])!
          const b = players.find((q) => q.id === oppIds[j])!
          const dd = Math.hypot(a.x - b.x, a.y - b.y)
          if (dd < closest.d) closest = { d: dd, pair: `${a.id}/${b.id}` }
        }
      }
      const slots = Object.keys(full).map((id) => HOME.get(id)!)
      let unmarked = 0
      let inZone = 0
      for (const a of players.filter((q) => q.team === 'ours' && !/gk/i.test(q.label))) {
        const on = holders.filter((v) => Math.hypot(v.x - a.x, v.y - a.y) <= DOUBLE_MARK_R).length
        if (on >= 2) doubled++
        // only the ones the block is there to deal with
        const relevant = holders.some((v) => Math.hypot(v.x - a.x, v.y - a.y) <= BLOCK_ZONE_R)
        if (!relevant) continue
        inZone++
        if (on === 0) unmarked++
      }
      void slots
      samples++
      unmarkedTotal += unmarked
      inZoneTotal += inZone
    }
  }

  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
  const roles = [...acc.entries()]
    .map(([key, r]) => ({
      key,
      n: r.n,
      driftMean: mean(r.drift),
      driftMax: Math.max(...r.drift),
      offShapeMean: mean(r.off),
      offShapeMax: Math.max(...r.off),
      worst: r.worst,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return {
    roles,
    lanes: { assigned, onLane },
    cohesion: { worstOverstretch, worstPair },
    closest,
    hood: { wrongMean: hood.n ? hood.wrong / hood.n : 0, tier: hood.tier, samples: hood.n, worst: hood.worst },
    cutters: {
      wide: { n: cut.wide.n, laneWide: cut.wide.n ? cut.wide.laneWide / cut.wide.n : 0, drift: cut.wide.n ? cut.wide.drift / cut.wide.n : 0 },
      central: { n: cut.central.n, laneWide: cut.central.n ? cut.central.laneWide / cut.central.n : 0, drift: cut.central.n ? cut.central.drift / cut.central.n : 0 },
    },
    marking: { doubled, samples, unmarkedMean: samples ? unmarkedTotal / samples : 0, inZoneMean: samples ? inZoneTotal / samples : 0 },
  }
}

/** How much of the far touchline nobody is standing in — the space a switch of play would find. */
function openWing(t: Record<string, { x: number; role: string }>): number {
  return PITCH_W - Math.max(...Object.values(t).filter((v) => v.role !== 'gk').map((v) => v.x))
}

function widthSweep(): AiReport['width'] {
  const WIDE_ATTACKER = { x: 64, y: 58 }
  return [0, 50, 100].map((width) => {
    const plain = computeAiTargets(worldAt({ x: 6, y: 60 }, { owner: 'ours' }), 'opp', { defenderRules: {}, moves: [] }, { on: true, width })
    const w = worldAt({ x: 6, y: 60 }, { owner: 'ours' })
    Object.assign(w.players.find((p) => p.id === 'RCM')!, WIDE_ATTACKER)
    const vs = computeAiTargets(w, 'opp', { defenderRules: {}, moves: [] }, { on: true, width })
    const nearest = Math.min(
      ...Object.values(vs).filter((v) => v.role !== 'gk').map((v) => Math.hypot(v.x - WIDE_ATTACKER.x, v.y - WIDE_ATTACKER.y)),
    )
    return { width, openWing: openWing(plain), openWingVsWideAttacker: openWing(vs), nearestToWideAttacker: nearest }
  })
}

/** Phase 1 of the test play: a press on the blue LCB, with three central outlets to cut. */
function phase1(): AiReport['phase1'] {
  const w = worldAt({ x: 26, y: 25 }, { owner: 'ours', focus: 'LCB' })
  const t = computeAiTargets(w, 'opp', { defenderRules: {}, moves: [] }, { on: true })
  const carrier = w.players.find((p) => p.id === 'LCB')!
  // the outlets are the carrier's team-mates in central midfield: a real pass away, not his own feet
  const outlets = w.players.filter(
    (p) => p.team === 'ours' && p.id !== 'LCB' && Math.abs(p.x - CENTRE_X) <= 20 && Math.hypot(p.x - carrier.x, p.y - carrier.y) >= 8 && p.y > carrier.y && p.y < carrier.y + 30,
  )
  // An outlet is denied when somebody is ACTUALLY on the pass to it — measured the way the engine measures
  // it (passingLaneOpen), not by who was handed a `lane`. A man standing on the receiver because he answers
  // for him blocks that pass exactly as well as a screener sent to shade it, and the point of the figure is
  // whether the pass is on. A presser or his cover is on his way to the ball, so he is not covering anything.
  const onPass = (o: AiWorldPlayer) =>
    Object.entries(t).filter(([, v]) => !['presser', 'cover', 'gk'].includes(v.role)
      && distPointToSegment([v.x, v.y], [carrier.x, carrier.y], [o.x, o.y]) <= LANE_BLOCK_R)
  const cut = outlets.filter((o) => onPass(o).length > 0)
  const back = w.players.filter((p) => p.team === 'opp' && !/gk/i.test(p.label) && p.home[1] >= 78).map((p) => t[p.id])
  return {
    outlets: outlets.length,
    cut: cut.length,
    cutters: [...new Set(cut.flatMap((o) => onPass(o).map(([id]) => id)))].sort(),
    backLineSpread: Math.max(...back.map((v) => v.y)) - Math.min(...back.map((v) => v.y)),
  }
}

export function aiReport(): AiReport {
  const { roles, lanes, cohesion, marking, closest, cutters, hood } = roleCensus()
  return { roles, lanes, cohesion, marking, closest, cutters, hood, width: widthSweep(), phase1: phase1() }
}

/** The report as lines of text, for `npm run ai:report`. */
export function formatAiReport(r: AiReport = aiReport()): string[] {
  const n = (v: number, d = 1) => v.toFixed(d).padStart(6)
  const out: string[] = []
  out.push('ROLE CENSUS over the seeded play (drift = from formation home, offShape = from his own slot)')
  out.push('  band:role            n   driftMean driftMax  offMean  offMax   worst offShape')
  for (const row of r.roles) {
    out.push(
      `  ${row.key.padEnd(18)} ${String(row.n).padStart(4)}  ${n(row.driftMean)}  ${n(row.driftMax)}  ${n(row.offShapeMean)}  ${n(row.offShapeMax)}   ${row.worst}`,
    )
  }
  out.push('')
  out.push(`LANES  ${r.lanes.onLane}/${r.lanes.assigned} cutters actually standing on the pass they were given`)
  out.push(`COHESION  worst overstretch past formation spacing + ${NEIGHBOUR_SLACK} m slack: ${r.cohesion.worstOverstretch.toFixed(1)} m (${r.cohesion.worstPair})`)
  out.push(
    `MARKING  ${r.marking.doubled} opponents double-covered within ${DOUBLE_MARK_R} m over ${r.marking.samples} frames ` +
      `(${(r.marking.doubled / r.marking.samples).toFixed(2)} per frame); of ${r.marking.inZoneMean.toFixed(1)} opponents inside the block's area, ` +
      `${r.marking.unmarkedMean.toFixed(1)} have nobody within ${DOUBLE_MARK_R} m`,
  )
  out.push(
    `HOOD     ${(100 * r.hood.wrongMean).toFixed(0)}% of a player's 3 nearest team-mates are not his formation neighbours; ` +
      `${r.hood.tier} tier crossings over ${r.hood.samples} player-frames` + (r.hood.tier ? ` | worst: ${r.hood.worst}` : ''),
  )
  out.push(
    `CUTTERS  flank slots: ${r.cutters.wide.n} cuts, lane ${r.cutters.wide.laneWide.toFixed(1)} m off centre, ` +
      `${r.cutters.wide.drift.toFixed(1)} m off their own x | central slots: ${r.cutters.central.n} cuts, ` +
      `lane ${r.cutters.central.laneWide.toFixed(1)} m off centre, ${r.cutters.central.drift.toFixed(1)} m off theirs`,
  )
  out.push(`CLOSEST  two team-mates come within ${r.closest.d.toFixed(2)} m of each other (${r.closest.pair})`)
  out.push('')
  out.push('WIDTH  ball on the left touchline; "open wing" is the far-side space a long diagonal would find')
  out.push('  width   openWing   openWing(vs wide attacker)   nearest defender to him')
  for (const row of r.width) {
    out.push(`  ${String(row.width).padStart(5)}   ${n(row.openWing)} m   ${n(row.openWingVsWideAttacker)} m                 ${n(row.nearestToWideAttacker)} m`)
  }
  out.push('')
  out.push(`PHASE 1  press on the blue LCB: ${r.phase1.cut}/${r.phase1.outlets} central outlets cut by [${r.phase1.cutters.join(' ')}]`)
  out.push(`         back line held to one height within ${r.phase1.backLineSpread.toFixed(2)} m`)
  return out
}
