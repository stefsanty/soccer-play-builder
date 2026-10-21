import { test, expect, type Page } from '@playwright/test'

// Runs only where the "Defensive AI test" play has been seeded (supabase/seed/defensive-ai-test.sql).
test.describe('Defensive AI test: 4 scenarios', () => {
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
    await page.getByTestId('view-play').click()
    await expect(page.getByTestId('anim-player-oLCB')).toBeVisible()
  })

  const centreY = async (page: Page, pid: string) => {
    const b = (await page.getByTestId(`anim-player-${pid}`).locator('circle').boundingBox())!
    return b.y + b.height / 2
  }
  const seek = async (page: Page, v: number) => {
    await page.getByTestId('progress-bar').fill(String(v))
    await page.waitForTimeout(40)
  }
  const pauseOnStep = async (page: Page, i: number) => {
    await page.getByTestId(`anim-step-chip-${i}`).click()
    await page.getByTestId('play-toggle').click() // it auto-starts: pause
  }

  test('has four steps and the opponent AI line is drawn', async ({ page }) => {
    await expect(page.locator('[data-testid^="anim-step-chip-"]')).toHaveCount(4)
    await expect(page.getByTestId('ai-line-opp')).toHaveCount(1)
    await expect(page.getByTestId('ai-line-ours')).toHaveCount(0) // only the opponent has the AI on
  })

  test('step 4: the block steps up while the ball is back, then drops deeper as it advances', async ({ page }) => {
    await pauseOnStep(page, 3)
    const ys: number[] = []
    for (const v of [0, 450, 1000]) {
      await seek(page, v)
      ys.push(((await centreY(page, 'oLCB')) + (await centreY(page, 'oRCB'))) / 2)
    }
    // screen y grows downwards: a smaller value is deeper (closer to the opponent goal at the top)
    expect(ys[1]).toBeGreaterThan(ys[0] + 30) // stepped up
    expect(ys[2]).toBeLessThan(ys[1] - 30) // dropped deeper again
  })

  test('step 2: the authored press from oLCB brings him towards LW', async ({ page }) => {
    await pauseOnStep(page, 1)
    const dist = async () => {
      const a = (await page.getByTestId('anim-player-oLCB').locator('circle').boundingBox())!
      const b = (await page.getByTestId('anim-player-LW').locator('circle').boundingBox())!
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    await seek(page, 340) // 1.7 s: just before the press fires
    const before = await dist()
    await seek(page, 1000)
    expect(await dist()).toBeLessThan(before - 20)
  })
})
