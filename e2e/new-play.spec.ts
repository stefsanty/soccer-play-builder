import { test, expect } from '@playwright/test'

test.describe('new play page', () => {
  test('pre-fills title and shows Create play', async ({ page }) => {
    await page.goto('/new')
    await expect(page.getByTestId('play-title-input')).toHaveValue('Untitled Play')
    await expect(page.getByRole('button', { name: 'Create play' })).toBeVisible()
  })
})
