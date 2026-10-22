import { test, expect, type Page } from '@playwright/test'

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!

test.describe('layout: pitch, step text, step tabs, bottom bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor')
    await expect(page.getByTestId('pitch-svg')).toBeVisible()
  })

  test('Edit: pitch, then the text panel, then the step tabs, then the runs bar', async ({ page }) => {
    const pitch = await box(page, 'pitch-svg')
    const panel = await box(page, 'step-text-panel')
    const strip = await box(page, 'step-bar')
    const bar = await box(page, 'edit-bar')
    expect(panel.y).toBeGreaterThanOrEqual(pitch.y + pitch.height - 1)
    expect(strip.y).toBeGreaterThanOrEqual(panel.y + panel.height - 1)
    expect(bar.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1)
    // nothing floats over the top of the pitch any more
    await expect(page.getByTestId('step-note')).toHaveCount(0)
  })

  test('Play: pitch, text panel, step tabs, then the playback bar (in flow, not over the pitch)', async ({ page }) => {
    await page.getByTestId('view-play').click()
    const pitch = await box(page, 'animated-pitch-svg')
    const panel = await box(page, 'step-text-panel')
    const strip = await box(page, 'step-bar')
    const controls = (await page.getByRole('group', { name: 'Playback controls' }).boundingBox())!
    expect(panel.y).toBeGreaterThanOrEqual(pitch.y + pitch.height - 1)
    expect(strip.y).toBeGreaterThanOrEqual(panel.y + panel.height - 1)
    expect(controls.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1)
    expect(controls.y).toBeGreaterThanOrEqual(pitch.y + pitch.height - 1) // below the pitch, not floating over it
    await expect(page.getByTestId('anim-step-indicator')).toContainText('Step 1 of 1')
  })

  test('switching Edit <-> Play changes nothing above the bottom bar: same panel and strip slots', async ({ page }) => {
    const editPanel = await box(page, 'step-text-panel')
    const editStrip = await box(page, 'step-bar')
    const editBar = await box(page, 'edit-bar')
    await page.getByTestId('view-play').click()
    const playPanel = await box(page, 'step-text-panel')
    const playStrip = await box(page, 'step-bar')
    const playBar = (await page.getByRole('group', { name: 'Playback controls' }).boundingBox())!
    expect(playPanel).toEqual(editPanel)
    expect(playStrip).toEqual(editStrip)
    expect(playBar.y).toBeCloseTo(editBar.y, 0)
    expect(playBar.height).toBeCloseTo(editBar.height, 0)
  })

  test('the step text panel follows the step (title + badge) in both modes', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    await expect(page.getByTestId('step-title')).toHaveText('Step 2')
    await page.getByTestId('view-play').click()
    await expect(page.getByTestId('step-title')).toHaveText('Step 2')
    await page.getByTestId('anim-step-chip-0').click()
    await expect(page.getByTestId('step-title')).toHaveText('Step 1')
  })

  test('Edit: the run list opens inside the text panel from the runs bar', async ({ page }) => {
    await expect(page.getByTestId('edit-bar')).toContainText('No runs in this step')
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    await page.getByTestId('player-o-LST').click()
    await page.getByTestId('mode-run').click()
    const b = await box(page, 'pitch-svg')
    await page.mouse.click(b.x + b.width * 0.15, b.y + b.height * 0.7)
    await page.getByTestId('runs-toggle').click()
    const panel = await box(page, 'step-text-panel')
    const list = await box(page, 'runs-panel')
    expect(list.y).toBeGreaterThanOrEqual(panel.y)
    expect(list.y + list.height).toBeLessThanOrEqual(panel.y + panel.height + 1) // inside the panel
  })
})

test.describe('OPP formation ghosts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor')
    await expect(page.getByTestId('pitch-svg')).toBeVisible()
  })

  test('Edit: one faint red marker per OPP player, on by default, with no label and no wedge', async ({ page }) => {
    const ghosts = page.getByTestId('formation-ghost')
    await expect(ghosts).toHaveCount(11)
    await expect(page.getByTestId('formation-toggle')).toHaveAttribute('aria-pressed', 'true')
    expect(Number(await ghosts.first().getAttribute('fill-opacity'))).toBeLessThan(0.5) // semi-transparent
    expect(await ghosts.first().getAttribute('fill')).toBe('#e5484d')
    // they are plain circles: nothing else in the ghost group (no text, no wedge)
    await expect(page.getByTestId('formation-ghosts').locator('text, path')).toHaveCount(0)
    // and they are not players: the real OPP players are untouched
    await expect(page.getByTestId('pitch-svg').locator('[data-team="opp"] circle')).toHaveCount(11)
  })

  test('the Formation button hides and shows them', async ({ page }) => {
    const toggle = page.getByTestId('formation-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('formation-ghost')).toHaveCount(0)
    await toggle.click()
    await expect(page.getByTestId('formation-ghost')).toHaveCount(11)
  })

  test('the button sits in the top-right corner of the pitch', async ({ page }) => {
    const pitch = await box(page, 'pitch-svg')
    const t = await box(page, 'formation-toggle')
    expect(t.x + t.width).toBeGreaterThan(pitch.x + pitch.width * 0.7)
    expect(t.y).toBeLessThan(pitch.y + pitch.height * 0.2)
  })

  test('Play: the ghosts are there too, stay put while the real players move, and the setting carries over', async ({ page }) => {
    await page.getByTestId('formation-toggle').click() // off in Edit...
    await page.getByTestId('view-play').click()
    await expect(page.getByTestId('formation-ghost')).toHaveCount(0) // ...so off in Play
    await page.getByTestId('formation-toggle').click()
    const ghosts = page.getByTestId('formation-ghost')
    await expect(ghosts).toHaveCount(11)
    await page.getByTestId('play-toggle').click() // pause
    await page.getByTestId('progress-bar').fill('0')
    const at = async () => (await ghosts.first().boundingBox())!
    const before = await at()
    await page.getByTestId('progress-bar').fill('800')
    const after = await at()
    expect(after).toEqual(before)
  })
})

// The seeded plays live in the database; these run only where they exist.
test.describe('seeded plays: OPP orientation and the ghosts', () => {
  let id: string | undefined
  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/plays')
    if (!res.ok()) return
    const { plays } = (await res.json()) as { plays: { id: string; title: string }[] }
    id = plays.find((p) => p.title === 'Defensive AI test: 4 scenarios')?.id
  })
  test.beforeEach(async ({ page }) => {
    test.skip(!id, 'seeded play not available')
    await page.goto(`/editor/${id}`)
    await expect(page.getByTestId('player-oRB')).toBeVisible()
  })
  const cx = async (page: Page, testId: string) => {
    const b = (await page.getByTestId(testId).locator('circle').boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }

  test('OPP right-hand players are on the screen left (mirrored), ST is the most advanced player', async ({ page }) => {
    await page.getByTestId('step-chip-0').click()
    const oRB = await cx(page, 'player-oRB')
    const oLB = await cx(page, 'player-oLB')
    expect(oRB.x).toBeLessThan(oLB.x)
    expect((await cx(page, 'player-oRCB')).x).toBeLessThan((await cx(page, 'player-oLCB')).x)
    const st = await cx(page, 'player-ST')
    for (const id of ['LW', 'CAM', 'CM', 'LCB']) expect(st.y).toBeLessThan((await cx(page, `player-${id}`)).y) // screen y: up = further forward
  })

  test('the ghosts sit at the OPP formation even after the real players have moved away', async ({ page }) => {
    await page.getByTestId('view-play').click()
    await page.getByTestId('anim-step-chip-3').click()
    await page.getByTestId('play-toggle').click() // pause
    await page.getByTestId('progress-bar').fill('1000')
    const ghosts = page.getByTestId('formation-ghost')
    await expect(ghosts).toHaveCount(11)
    // ghosts follow the player order: oGK, oLB, oLCB, oRCB, oRB, ... so index 4 is oRB (formation x = 8, the leftmost)
    const xs: number[] = []
    for (let i = 0; i < 11; i++) {
      const b = (await ghosts.nth(i).boundingBox())!
      xs.push(b.x + b.width / 2)
    }
    expect(xs[4]).toBe(Math.min(...xs))
    expect(xs[4]).toBeLessThan(xs[1]) // oRB's ghost is left of oLB's
  })
})
