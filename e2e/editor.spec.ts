import { test, expect } from '@playwright/test'

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

  test('toolbar mode buttons are visible', async ({ page }) => {
    for (const name of ['Select', 'Pass', 'Run', 'Preview']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
    await expect(page.getByTestId('mode-pass')).toHaveAttribute('aria-pressed', 'true')
  })

  test('step counter shows Step 1', async ({ page }) => {
    await expect(page.getByTestId('step-counter')).toContainText('Step 1')
    await page.getByRole('button', { name: 'Add Step', exact: true }).click()
    await expect(page.getByTestId('step-counter')).toContainText('Step 2')
    await page.getByRole('button', { name: 'Prev Step' }).click()
    await expect(page.getByTestId('step-counter')).toContainText('Step 1')
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
    await page.getByTestId('mode-pass').click()
    await page.getByTestId('player-o-LCM').click()
    await page.getByTestId('player-o-LST').click()
    await expect(page.getByTestId('pass-arrow')).toHaveCount(1)
  })
})
