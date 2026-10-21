import { test, expect } from '@playwright/test'

test.describe('home page', () => {
  test('loads', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Soccer Play Builder' })).toBeVisible()
  })

  test('has navigation links', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Open Editor' })).toHaveAttribute('href', '/editor')
    await expect(page.getByRole('link', { name: 'Browse Plays' })).toHaveAttribute('href', '/library')
  })
})
