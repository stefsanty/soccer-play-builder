import { test, expect, type Page } from '@playwright/test'

const select = (page: Page, id: string) => page.getByTestId(`player-${id}`).click()
const rotation = async (page: Page, testId: string) => {
  const t = await page.getByTestId(testId).locator('[data-testid="facing-wedge"]').getAttribute('transform')
  return Number(/rotate\((-?[\d.]+)\)/.exec(t ?? '')?.[1])
}
/** A clear patch of grass inside the pitch svg (not under any player), in page coordinates. */
async function grass(page: Page, nth = 0): Promise<[number, number]> {
  const box = (await page.getByTestId('pitch-svg').boundingBox())!
  let found = 0
  for (let y = 520; y < 700; y += 20) {
    for (let x = 40; x < 340; x += 25) {
      const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid]')?.getAttribute('data-testid'), [box.x + x, box.y + y])
      if (hit === 'pitch-svg' && found++ === nth) return [box.x + x, box.y + y]
    }
  }
  throw new Error('no free grass found')
}

test.describe('1. Run works for any player, including a pass receiver', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor')
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    await select(page, 'o-LCM')
    await page.getByTestId('mode-pass').click()
    await select(page, 'o-LST') // pass LCM -> LST
  })

  test('the receiver can be selected and given a run', async ({ page }) => {
    await expect(page.getByTestId('pass-arrow')).toHaveCount(1)
    await select(page, 'o-LST')
    await expect(page.getByTestId('player-toolbar')).toContainText('Selected: LST')
    await page.getByTestId('mode-run').click()
    const [x, y] = await grass(page)
    await page.mouse.click(x, y)
    await expect(page.getByTestId('action-flash')).toContainText('Run set for LST')
    await expect(page.getByTestId('run-arrow')).toHaveCount(1)
    await expect(page.getByTestId('pass-arrow')).toHaveCount(1) // the pass is untouched
  })

  test('a run can end on another player (uses that player\'s spot)', async ({ page }) => {
    await select(page, 'o-LCM')
    await page.getByTestId('mode-run').click()
    await select(page, 'o-RST')
    await expect(page.getByTestId('action-flash')).toContainText('Run set for LCM')
    await expect(page.getByTestId('run-arrow')).toHaveCount(1)
    await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
  })
})

test.describe('2. Run arrows can be hidden', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor')
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    for (const [n, id] of ['o-LST', 'o-RST'].entries()) {
      await select(page, id)
      await page.getByTestId('mode-run').click()
      const [x, y] = await grass(page, n * 5) // a different free spot for each run
      await page.mouse.click(x, y)
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
    }
    await expect(page.getByTestId('run-arrow')).toHaveCount(2)
  })

  test('eye toggle hides and shows one arrow', async ({ page }) => {
    await page.getByTestId('runs-toggle').click()
    await expect(page.getByTestId('runs-toggle')).toContainText('Runs · 2')
    await page.getByTestId('run-toggle-o-LST').click()
    await expect(page.getByTestId('run-arrow')).toHaveCount(1)
    await expect(page.getByTestId('run-toggle-o-LST')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('runs-toggle')).toContainText('1 hidden')
    await page.getByTestId('run-toggle-o-LST').click()
    await expect(page.getByTestId('run-arrow')).toHaveCount(2)
  })

  test('Hide all / Show all', async ({ page }) => {
    await page.getByTestId('runs-toggle').click()
    await page.getByTestId('runs-toggle-all').click()
    await expect(page.getByTestId('run-arrow')).toHaveCount(0)
    await expect(page.getByTestId('runs-toggle-all')).toContainText('Show all')
    await page.getByTestId('runs-toggle-all').click()
    await expect(page.getByTestId('run-arrow')).toHaveCount(2)
  })

  test('a hidden arrow stays hidden in Play mode (the run still happens)', async ({ page }) => {
    await page.getByTestId('runs-toggle').click()
    await page.getByTestId('run-toggle-o-LST').click()
    await page.getByTestId('view-play').click()
    await page.getByTestId('play-toggle').click() // pause
    await page.getByTestId('progress-bar').fill('1000')
    await expect(page.getByTestId('run-arrow')).toHaveCount(1) // only o-RST's
  })

  test('re-aiming a hidden run keeps it hidden', async ({ page }) => {
    await page.getByTestId('runs-toggle').click()
    await page.getByTestId('run-toggle-o-LST').click()
    await page.getByTestId('runs-toggle').click() // close the panel
    await select(page, 'o-LST')
    await page.getByTestId('mode-run').click()
    const [x, y] = await grass(page, 3)
    await page.mouse.click(x, y)
    await expect(page.getByTestId('run-arrow')).toHaveCount(1)
  })
})

test.describe('3. Facing wedges', () => {
  test('Edit mode: a wedge on every player (ours and opponents), pointing up / down the pitch by default', async ({ page }) => {
    await page.goto('/editor')
    await expect(page.getByTestId('pitch-svg').locator('[data-testid="facing-wedge"]')).toHaveCount(22)
    expect(await rotation(page, 'player-o-LCM')).toBeCloseTo(-90, 0) // ours face up the pitch
    expect(await rotation(page, 'player-p-LCM')).toBeCloseTo(90, 0) // opponents face down
  })

  test('Play mode: a wedge on every player', async ({ page }) => {
    await page.goto('/editor')
    await page.getByTestId('view-play').click()
    await expect(page.getByTestId('animated-pitch-svg').locator('[data-testid="facing-wedge"]')).toHaveCount(22)
  })
})

// The pattern-of-play seed lives in the database; these run only where it exists.
test.describe('seeded play: Right-side build-up', () => {
  let id: string | undefined
  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/plays')
    if (!res.ok()) return
    const { plays } = (await res.json()) as { plays: { id: string; title: string }[] }
    id = plays.find((p) => p.title === 'Right-side build-up: 4-5-1')?.id
  })
  test.beforeEach(async ({ page }) => {
    test.skip(!id, 'seeded play not available')
    await page.goto(`/editor/${id}`)
    await expect(page.getByTestId('player-RB')).toBeVisible()
  })

  test('1. pass receiver RB (covered by the pressing defender) is the one selected and run', async ({ page }) => {
    await page.getByTestId('step-chip-1').click()
    await page.getByTestId('player-RB').click()
    await expect(page.getByTestId('player-toolbar')).toContainText('Selected: RB')
    await page.getByTestId('mode-run').click()
    const [x, y] = await grass(page)
    await page.mouse.click(x, y)
    await expect(page.getByTestId('action-flash')).toContainText('Run set for RB')
  })

  test('3. Edit mode shows the end-of-step facing: RB faces CM in step 1', async ({ page }) => {
    await page.getByTestId('step-chip-1').click()
    const rb = await rotation(page, 'player-RB')
    expect(rb).not.toBeCloseTo(-90, 0) // turned away from "up the pitch"
  })

  test('4. passing lanes are drawn as dashed semi-transparent lines (Edit and Play)', async ({ page }) => {
    await page.getByTestId('step-chip-1').click()
    const edit = page.getByTestId('option-line')
    await expect(edit).toHaveCount(2) // RB-CM and RB-CAM
    await expect(edit.first()).toHaveAttribute('stroke-dasharray', '9 7')
    expect(Number(await edit.first().getAttribute('opacity'))).toBeLessThan(1)

    await page.getByTestId('view-play').click()
    await page.getByTestId('play-toggle').click() // pause
    await page.getByTestId('progress-bar').fill('0')
    await expect(page.getByTestId('option-line')).toHaveCount(0) // not before 2.7s
    await page.getByTestId('progress-bar').fill('900')
    await expect(page.getByTestId('option-line')).toHaveCount(2)
    await expect(page.getByTestId('option-line').first().locator('line')).toHaveAttribute('stroke-dasharray', '9 7')
  })

  test('3. wedges rotate smoothly during play (CAM turns to face RB at 1.2s)', async ({ page }) => {
    await page.getByTestId('step-chip-1').click()
    await page.getByTestId('view-play').click()
    await page.getByTestId('play-toggle').click() // pause
    const samples: number[] = []
    for (let v = 240; v <= 460; v += 20) { // ~0.09s apart, around the turn
      await page.getByTestId('progress-bar').fill(String(v))
      samples.push(await rotation(page, 'anim-player-CAM'))
    }
    const steps = samples.slice(1).map((a, i) => Math.abs(a - samples[i]))
    expect(Math.max(...steps)).toBeLessThanOrEqual(7 * 0.088 * (180 / Math.PI) + 3) // turn-rate limited: never a snap
    expect(Math.abs(samples.at(-1)! - samples[0])).toBeGreaterThan(20) // but it does turn
  })
})
