import { test, expect, type Page } from '@playwright/test'

/** Select a player so the action toolbar appears. */
const select = (page: Page, id: string) => page.getByTestId(`player-${id}`).click()

test.describe('pitch editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor')
  })

  test('page loads without error boundary', async ({ page }) => {
    await expect(page.getByTestId('pitch-svg')).toBeVisible()
    await expect(page.getByText(/application error|something went wrong/i)).toHaveCount(0)
  })

  test('pitch SVG renders with player circles', async ({ page }) => {
    const svg = page.getByTestId('pitch-svg')
    await expect(svg.locator('[data-team="ours"] circle')).toHaveCount(11)
    await expect(svg.locator('[data-team="opp"] circle')).toHaveCount(11)
  })

  test.describe('action toolbar', () => {
    test('is hidden until a player is selected', async ({ page }) => {
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
      await select(page, 'o-LCM')
      const bar = page.getByTestId('player-toolbar')
      await expect(bar).toBeVisible()
      await expect(bar).toContainText('Selected: LCM')
      for (const name of ['Move', 'Pass', 'Run']) {
        await expect(bar.getByRole('button', { name, exact: true })).toBeVisible()
      }
      await page.getByTestId('mode-pass').click()
      await expect(page.getByTestId('mode-pass')).toHaveAttribute('aria-pressed', 'true')
    })

    test('tapping the selected player again hides it', async ({ page }) => {
      await select(page, 'o-LCM')
      await expect(page.getByTestId('player-toolbar')).toBeVisible()
      await select(page, 'o-LCM')
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
      await expect(page.getByTestId('selected-ring')).toHaveCount(0)
    })

    test('tapping the open pitch hides it', async ({ page }) => {
      await select(page, 'o-LCM')
      await page.getByTestId('pitch-svg').click({ position: { x: 5, y: 5 } })
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
    })

    test('Escape hides it', async ({ page }) => {
      await select(page, 'o-LCM')
      await expect(page.getByTestId('player-toolbar')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
      await expect(page.getByTestId('selected-ring')).toHaveCount(0)
    })

    test('the X button deselects', async ({ page }) => {
      await select(page, 'o-LCM')
      await page.getByTestId('deselect').click()
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
    })

    test('the step bar stays available with nothing selected', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Add Step', exact: true })).toBeVisible()
    })
  })

  test('step chips: add a step and switch between steps', async ({ page }) => {
    await expect(page.getByTestId('step-chip-0')).toHaveAttribute('aria-current', 'step')
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    await expect(page.getByTestId('step-chip-1')).toHaveAttribute('aria-current', 'step')
    await page.getByTestId('step-chip-0').click()
    await expect(page.getByTestId('step-chip-0')).toHaveAttribute('aria-current', 'step')
  })

  test('step note pill expands on tap', async ({ page }) => {
    const note = page.getByTestId('step-note')
    await expect(note).toHaveAttribute('aria-expanded', 'false')
    await note.click()
    await expect(note).toHaveAttribute('aria-expanded', 'true')
  })

  test('player drag changes position', async ({ page }) => {
    const player = page.getByTestId('player-o-LST').locator('circle')
    await expect(player).toBeVisible()
    const before = (await player.boundingBox())!
    const cx = before.x + before.width / 2
    const cy = before.y + before.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy - 60, { steps: 5 })
    await page.mouse.up()
    const after = (await player.boundingBox())!
    expect(after.x).toBeGreaterThan(before.x + 20)
    expect(after.y).toBeLessThan(before.y - 30)
  })

  test('pass tool adds a pass arrow', async ({ page }) => {
    await select(page, 'o-LCM')
    await page.getByTestId('mode-pass').click()
    await select(page, 'o-LST')
    await expect(page.getByTestId('pass-arrow')).toHaveCount(1)
    // the pass is done: back to a clean pitch
    await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
  })

  test('feedback: pass shows a confirmation and moves the ball to the receiver', async ({ page }) => {
    await expect(page.getByTestId('ball')).toHaveCount(0) // nobody has passed yet
    await select(page, 'o-LCM')
    await page.getByTestId('mode-pass').click()
    await expect(page.getByTestId('pending-ring')).toBeVisible()
    await select(page, 'o-LST')
    await expect(page.getByTestId('action-flash')).toContainText('Pass added')
    await expect(page.getByTestId('ball')).toHaveCount(1)
    await expect(page.getByTestId('ball-chip')).toContainText('Ball: LST')
  })

  test('feedback: tapping a player highlights it', async ({ page }) => {
    await select(page, 'o-LCM')
    await expect(page.getByTestId('selected-ring')).toHaveCount(1)
    await expect(page.getByTestId('player-o-LCM')).toHaveAttribute('data-selected', 'true')
  })

  test('feedback: adding a step confirms it', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    await expect(page.getByTestId('action-flash')).toContainText('added')
  })

  test.describe('Edit / Play toggle', () => {
    test('Edit is the default', async ({ page }) => {
      await expect(page.getByTestId('view-edit')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('view-play')).toHaveAttribute('aria-pressed', 'false')
    })

    test('Play mode hides the toolbar and makes players unselectable', async ({ page }) => {
      await select(page, 'o-LCM')
      await expect(page.getByTestId('player-toolbar')).toBeVisible()
      await page.getByTestId('view-play').click()
      await expect(page.getByTestId('animated-pitch')).toBeVisible()
      await expect(page.getByTestId('pitch-svg')).toHaveCount(0)
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
      await expect(page.getByTestId('selected-ring')).toHaveCount(0)
      await page.getByTestId('anim-player-o-LCM').click({ force: true })
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0)
      await page.getByTestId('view-edit').click()
      await expect(page.getByTestId('pitch-svg')).toBeVisible()
      await expect(page.getByTestId('player-toolbar')).toHaveCount(0) // selection was dropped
    })

    test('Play mode starts from the current step', async ({ page }) => {
      await page.getByRole('button', { name: 'Add Step', exact: true }).click()
      await page.getByTestId('view-play').click()
      await expect(page.getByTestId('anim-step-indicator')).toContainText('Step 2 of 2')
    })
  })

  test.describe('play mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByTestId('view-play').click()
    })

    test('shows the animated pitch with controls', async ({ page }) => {
      await expect(page.getByTestId('animated-pitch')).toBeVisible()
      await expect(page.getByTestId('animated-pitch-svg').locator('[data-team="ours"] circle')).toHaveCount(11)
      await expect(page.getByTestId('anim-step-indicator')).toContainText('Step 1 of 1')
      await expect(page.getByTestId('reset')).toContainText('Restart')
      await page.getByTestId('view-edit').click()
      await expect(page.getByTestId('pitch-svg')).toBeVisible()
    })

    test('speed control cycles 1x → 1.5x → 2x → 0.5x', async ({ page }) => {
      const speed = page.getByTestId('speed')
      await expect(speed).toContainText('1x')
      await speed.click()
      await expect(speed).toContainText('1.5x')
      await speed.click()
      await expect(speed).toContainText('2x')
      await speed.click()
      await expect(speed).toContainText('0.5x')
    })

    test('auto-plays, Pause stops it and Play resumes', async ({ page }) => {
      const bar = page.getByTestId('progress-bar')
      const toggle = page.getByTestId('play-toggle')
      const value = async () => Number(await bar.inputValue())

      await expect(toggle).toHaveAttribute('aria-label', 'Pause') // auto-started
      await expect.poll(value).toBeGreaterThan(0)

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-label', 'Play')
      const paused = await value()
      await page.waitForTimeout(400)
      expect(await value()).toBe(paused)

      await toggle.click()
      await expect.poll(value).toBeGreaterThan(paused)
    })

    test('scrubbing the progress bar and Restart', async ({ page }) => {
      await page.getByTestId('play-toggle').click() // pause
      await page.getByTestId('progress-bar').fill('500')
      await expect(page.getByTestId('progress-bar')).toHaveValue('500')
      await page.getByTestId('reset').click()
      await expect(page.getByTestId('progress-bar')).toHaveValue('0')
    })
  })

  test('player moves along a run while playing', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    const lst = page.getByTestId('player-o-LST').locator('circle')
    const box = (await lst.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 60, cy - 120, { steps: 5 })
    await page.mouse.up()
    await page.getByTestId('view-play').click()
    await page.getByTestId('play-toggle').click() // pause at start
    const player = page.getByTestId('anim-player-o-LST').locator('circle')
    const start = (await player.boundingBox())!
    await page.getByTestId('progress-bar').fill('1000')
    await expect.poll(async () => (await player.boundingBox())!.y).toBeLessThan(start.y - 40)
  })
})
