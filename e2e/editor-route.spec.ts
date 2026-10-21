import { test, expect } from '@playwright/test'

// Works with or without a database: either way the route must not show the old placeholder.
test.describe('editor route /editor/[id]', () => {
  test('unknown play id shows a message, not the "coming soon" placeholder', async ({ page }) => {
    const res = await page.goto('/editor/00000000-0000-0000-0000-000000000000')
    expect(res?.ok()).toBe(true)
    await expect(page.getByTestId('editor-message')).toContainText(/not found|not configured/i)
    await expect(page.getByText(/coming soon/i)).toHaveCount(0)
  })
})
