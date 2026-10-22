import { test, expect, type Page } from '@playwright/test'

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!
const value = async (page: Page, key: string) => Number(await page.getByTestId(`value-${key}`).textContent())
const setSlider = (page: Page, key: string, v: number) => page.getByTestId(`slider-${key}`).fill(String(v))

test.describe('Behavior panel (defensive AI controls)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor')
    await expect(page.getByTestId('pitch-svg')).toBeVisible()
    await page.getByTestId('behavior-open').click()
    await expect(page.getByTestId('behavior-panel')).toBeVisible()
  })

  test('opens in place of the step text, tabs and bar, without resizing the pitch', async ({ page }) => {
    await page.getByTestId('behavior-close').click()
    const pitchBefore = await box(page, 'pitch-svg')
    const panel = await box(page, 'step-text-panel')
    const strip = await box(page, 'step-bar')
    const bar = await box(page, 'edit-bar')
    await page.getByTestId('behavior-open').click()
    const b = await box(page, 'behavior-panel')
    expect(b.y).toBeCloseTo(panel.y, 0)
    expect(b.height).toBeCloseTo(panel.height + strip.height + bar.height, 0)
    expect(await box(page, 'pitch-svg')).toEqual(pitchBefore)
    await expect(page.getByTestId('step-text-panel')).toHaveCount(0)
    await page.getByTestId('behavior-close').click()
    await expect(page.getByTestId('step-text-panel')).toBeVisible()
    await expect(page.getByTestId('step-bar')).toBeVisible()
  })

  test('starts on the Opponent, AI off, Mid preset, every slider at 50 with its helper line', async ({ page }) => {
    await expect(page.getByTestId('behavior-team-opp')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('behavior-on')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('behavior-preset-mid')).toHaveAttribute('aria-pressed', 'true')
    for (const k of ['aggressiveness', 'lineHeight', 'width']) expect(await value(page, k)).toBe(50)
    await expect(page.getByTestId('helper-aggressiveness')).toHaveText('One presser breaks, rest hold')
    await expect(page.getByTestId('helper-lineHeight')).toHaveText('Mid-block')
    await expect(page.getByTestId('helper-width')).toContainText('How far wide players hold')
    await page.getByTestId('behavior-on').click()
    await expect(page.getByTestId('behavior-on')).toHaveAttribute('aria-checked', 'true')
  })

  test('presets set the whole bundle: Low 20/30/40, Mid 50/50/50, High 80/70/60', async ({ page }) => {
    const triple = async () => [await value(page, 'aggressiveness'), await value(page, 'lineHeight'), await value(page, 'width')]
    await page.getByTestId('behavior-preset-low').click()
    expect(await triple()).toEqual([20, 30, 40])
    await expect(page.getByTestId('behavior-preset-low')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('behavior-preset-high').click()
    expect(await triple()).toEqual([80, 70, 60])
    await page.getByTestId('behavior-preset-mid').click()
    expect(await triple()).toEqual([50, 50, 50])
  })

  test('helper lines change with the value', async ({ page }) => {
    await setSlider(page, 'aggressiveness', 25)
    await expect(page.getByTestId('helper-aggressiveness')).toHaveText('Holds shape, no individual pressing')
    await setSlider(page, 'aggressiveness', 45)
    await expect(page.getByTestId('helper-aggressiveness')).toHaveText('One presser breaks, rest hold')
    await setSlider(page, 'aggressiveness', 85)
    await expect(page.getByTestId('helper-aggressiveness')).toHaveText('Multiple players press, gaps in behind')
    await setSlider(page, 'lineHeight', 10)
    await expect(page.getByTestId('helper-lineHeight')).toHaveText('Defends the box')
    await setSlider(page, 'lineHeight', 50)
    await expect(page.getByTestId('helper-lineHeight')).toHaveText('Mid-block')
    await setSlider(page, 'lineHeight', 90)
    await expect(page.getByTestId('helper-lineHeight')).toHaveText('High press line')
  })

  test('moving a slider turns the presets into "Custom" and leaves the other sliders alone', async ({ page }) => {
    await page.getByTestId('behavior-preset-high').click()
    await setSlider(page, 'width', 10)
    await expect(page.getByTestId('behavior-custom')).toBeVisible()
    await expect(page.getByTestId('behavior-preset-low')).toHaveCount(0)
    expect(await value(page, 'width')).toBe(10)
    expect(await value(page, 'aggressiveness')).toBe(80) // the preset's other values are kept
    expect(await value(page, 'lineHeight')).toBe(70)
    await page.getByTestId('behavior-reset').click()
    await expect(page.getByTestId('behavior-custom')).toHaveCount(0)
    await expect(page.getByTestId('behavior-preset-mid')).toHaveAttribute('aria-pressed', 'true')
    for (const k of ['aggressiveness', 'lineHeight', 'width']) expect(await value(page, k)).toBe(50)
  })

  test('each team has its own settings, and they survive closing the panel', async ({ page }) => {
    await setSlider(page, 'aggressiveness', 70)
    await page.getByTestId('behavior-team-ours').click()
    expect(await value(page, 'aggressiveness')).toBe(50) // Ours: untouched defaults
    await expect(page.getByTestId('behavior-on')).toHaveAttribute('aria-checked', 'false')
    await setSlider(page, 'aggressiveness', 20)
    await page.getByTestId('behavior-team-opp').click()
    expect(await value(page, 'aggressiveness')).toBe(70)
    await page.getByTestId('behavior-close').click()
    await page.getByTestId('behavior-open').click()
    expect(await value(page, 'aggressiveness')).toBe(70)
    await page.getByTestId('behavior-team-ours').click()
    expect(await value(page, 'aggressiveness')).toBe(20)
  })

  test('settings belong to the step they were set on', async ({ page }) => {
    await setSlider(page, 'lineHeight', 90)
    await page.getByTestId('behavior-close').click()
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    await page.getByTestId('behavior-open').click()
    expect(await value(page, 'lineHeight')).toBe(50) // the new step starts from the defaults
    await page.getByTestId('behavior-close').click()
    await page.getByTestId('step-chip-0').click()
    await page.getByTestId('behavior-open').click()
    expect(await value(page, 'lineHeight')).toBe(90)
  })

  test('Play mode closes the panel and leaves the playback bar', async ({ page }) => {
    await page.getByTestId('view-play').click()
    await expect(page.getByTestId('behavior-panel')).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible()
    await page.getByTestId('view-edit').click()
    await expect(page.getByTestId('step-text-panel')).toBeVisible()
  })
})

// The seeded play lives in the database; these run only where it exists.
test.describe('the sliders re-simulate the pitch live (seeded Defensive AI test)', () => {
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
    await expect(page.getByTestId('player-oLCB')).toBeVisible()
    await page.getByTestId('step-chip-0').click()
    await page.getByTestId('behavior-open').click()
  })
  const cy = async (page: Page, pid: string) => {
    const b = (await page.getByTestId(`player-${pid}`).locator('circle').boundingBox())!
    return b.y + b.height / 2
  }
  const cx = async (page: Page, pid: string) => {
    const b = (await page.getByTestId(`player-${pid}`).locator('circle').boundingBox())!
    return b.x + b.width / 2
  }

  test('line height: a high line sits higher up the pitch than a low one', async ({ page }) => {
    await setSlider(page, 'lineHeight', 0)
    const deep = await cy(page, 'oLCB')
    await setSlider(page, 'lineHeight', 100)
    const high = await cy(page, 'oLCB')
    // OPP defend the top: a high line is further DOWN the screen (towards halfway)
    expect(high).toBeGreaterThan(deep + 30)
  })

  test('width: a narrow setting pulls the wide players in from the touchline', async ({ page }) => {
    await setSlider(page, 'width', 100)
    const wide = await cx(page, 'oRB')
    await setSlider(page, 'width', 0)
    const narrow = await cx(page, 'oRB')
    expect(narrow).toBeGreaterThan(wide + 10) // oRB starts on the screen left: narrow = further in
  })

  test('the settings stay in force in Play mode (the same play is simulated)', async ({ page }) => {
    await setSlider(page, 'lineHeight', 100)
    await page.getByTestId('behavior-close').click()
    const editHigh = await cy(page, 'oLCB')
    await page.getByTestId('view-play').click()
    await page.getByTestId('play-toggle').click()
    await page.getByTestId('progress-bar').fill('1000')
    const playEnd = (await page.getByTestId('anim-player-oLCB').locator('circle').boundingBox())!
    // the end-of-step state is the same in both modes
    expect(Math.abs(playEnd.y + playEnd.height / 2 - editHigh)).toBeLessThan(3)
  })
})
