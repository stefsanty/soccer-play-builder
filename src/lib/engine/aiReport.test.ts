// Prints the standing AI report (see aiReport.ts) and gates the figures that must not regress.
// Run on its own with `npm run ai:report` to read it.

import { describe, expect, it } from 'vitest'
import { aiReport, formatAiReport } from '@/lib/engine/aiReport'

const report = aiReport()

describe('AI report', () => {
  it('prints', () => {
    console.log(['', ...formatAiReport(report), ''].join('\n'))
    expect(report.roles.length).toBeGreaterThan(0)
  })

  it('every lane cutter is standing on the pass he was given', () => {
    expect(report.lanes.assigned).toBeGreaterThan(0)
    expect(report.lanes.onLane).toBe(report.lanes.assigned)
  })

  it('team-mates never end up standing on the same spot', () => {
    // not their targets — where they actually are, as they move
    expect(report.closest.d, `closest pair: ${report.closest.pair}`).toBeGreaterThan(4)
  })

  it('nobody is left stretched far from his formation neighbours', () => {
    expect(report.cohesion.worstOverstretch).toBeLessThanOrEqual(6)
  })

  it('a wider setting closes the far wing rather than opening it', () => {
    const [narrow, , wide] = report.width
    expect(wide.openWingVsWideAttacker).toBeLessThan(narrow.openWingVsWideAttacker)
    for (const row of report.width) {
      expect(row.openWing, `open wing at width ${row.width}`).toBeLessThan(20)
      expect(row.nearestToWideAttacker, `cover of the wide attacker at width ${row.width}`).toBeLessThan(13)
    }
  })

  it('phase 1 cuts every central outlet out of the carrier and holds the back line level', () => {
    expect(report.phase1.outlets).toBe(3)
    expect(report.phase1.cut).toBe(report.phase1.outlets)
    expect(report.phase1.backLineSpread).toBeLessThan(0.01)
  })

  it('no band of the formation is pulled right out of position', () => {
    for (const row of report.roles) {
      // the presser and his cover are meant to leave the shape; everyone else holds it
      if (row.key.endsWith(':presser') || row.key.endsWith(':cover')) continue
      expect(row.offShapeMax, `${row.key} (worst: ${row.worst})`).toBeLessThan(22)
    }
  })
})
