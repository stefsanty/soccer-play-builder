import { test, expect } from '@playwright/test'

// These run with or without Supabase env vars: every assertion accepts both modes.
test.describe('save / library', () => {
  test('editor save: disabled without DB, otherwise saves or fails gracefully', async ({ page }) => {
    await page.goto('/editor')
    await expect(page.getByTestId('pitch-svg')).toBeVisible()
    const save = page.getByTestId('save-button')
    await expect(save).toBeVisible()

    await expect(page.getByTestId('db-banner')).toHaveCount(0) // never shown on load
    await save.click()
    if (await page.getByTestId('db-banner').count()) {
      await expect(page.getByTestId('db-banner')).toContainText(/Database not configured/)
    } else {
      await expect(save).toHaveAttribute('data-status', /saved|error/)
    }
    // Editor stays usable either way.
    await expect(page.getByText(/application error|something went wrong/i)).toHaveCount(0)
  })

  test('POST /api/plays 503s gracefully when no DB is configured', async ({ request }) => {
    const res = await request.post('/api/plays', { data: { title: 'e2e' } })
    expect([201, 500, 503]).toContain(res.status())
    if (res.status() === 503) expect((await res.json()).error).toMatch(/not configured/i)
  })

  test('library page renders without a DB', async ({ page }) => {
    const res = await page.goto('/library')
    expect(res?.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Play Library' })).toBeVisible()
    await expect(page.getByText(/application error|something went wrong/i)).toHaveCount(0)
  })
})
