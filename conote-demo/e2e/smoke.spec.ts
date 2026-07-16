import { expect, test } from '@playwright/test'
import { docText, extState, gotoFresh, seed, selectAll } from './helpers'

// Fastest LLM canary: app mounts, editor renders, and a single real completion
// round-trips through the demo proxy to OpenRouter and back to idle. If this
// fails, every other spec will too.
test('app loads and a real completion round-trips through the proxy', async ({ page }) => {
  await gotoFresh(page)

  await expect(page.locator('#editor .ProseMirror')).toBeVisible()
  await expect(page.getByTestId('ai-status')).toHaveText('idle')

  await seed(page, '<p>The cat sat.</p>')
  await selectAll(page)

  // Assert the proxy endpoint is actually hit and returns OK — a deterministic
  // proof of the full stack, independent of the (nondeterministic) LLM text.
  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/chat/completions') && resp.request().method() === 'POST',
  )
  await page
    .getByTestId('ai-custom-input')
    .fill('Reply with exactly the word DONE and nothing else.')
  await page.getByTestId('ai-custom-submit').click()

  const response = await responsePromise
  expect(response.ok()).toBeTruthy()

  // State settles back to idle with no error once streaming completes.
  await expect.poll(() => extState(page, 'ai'), { timeout: 60_000 }).toBe('idle')
  await expect(page.getByTestId('ai-error')).toHaveText('')
  expect((await docText(page)).length).toBeGreaterThan(0)
})
