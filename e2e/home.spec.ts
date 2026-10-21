import { test, expect } from '@playwright/test'

test.describe('home page', () => {
  test('loads', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Plays' })).toBeVisible()
  })

  test('has navigation links', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'New play' })).toHaveAttribute('href', '/new')
    await expect(page.getByText('No plays yet')).toBeVisible()
  })

  test('play cards open the editor, not the viewer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'New play' })).toBeVisible()
    // Cards only exist when a database is configured and has plays.
    await page.waitForTimeout(1500)
    const hrefs = await page.locator('a[href^="/editor/"], a[href^="/play/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    for (const href of hrefs) expect(href).toMatch(/^\/editor\//)
  })
})
