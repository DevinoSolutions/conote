import { expect, test } from '@playwright/test'
import { docText, extState, gotoFresh, seed, selectAll } from './helpers'

test.describe('AI Generation (@conote/extension-ai)', () => {
  test('custom prompt rewrites the selection and settles to idle', async ({ page }) => {
    await gotoFresh(page)
    await seed(page, '<p>The cat sat on the mat.</p>')
    const before = await docText(page)
    await selectAll(page)

    await page
      .getByTestId('ai-custom-input')
      .fill('Reply with exactly the word DONE and nothing else.')
    await page.getByTestId('ai-custom-submit').click()

    // Invariant: the run completes without error and returns to idle.
    await expect.poll(() => extState(page, 'ai'), { timeout: 60_000 }).toBe('idle')
    await expect(page.getByTestId('ai-error')).toHaveText('')

    // Invariant: the selection was replaced, so the document text changed.
    const after = await docText(page)
    expect(after).not.toBe(before)
  })

  test('aborting an in-flight generation returns to idle without error', async ({ page }) => {
    await gotoFresh(page)
    await seed(page, '<p>Seed paragraph for abort test.</p>')
    await selectAll(page)

    await page
      .getByTestId('ai-custom-input')
      .fill('Write a long, detailed multi-paragraph essay about the history of cartography.')
    await page.getByTestId('ai-custom-submit').click()

    // Wait until the request is actually in flight (left idle), then abort.
    await expect.poll(() => extState(page, 'ai'), { timeout: 30_000 }).not.toBe('idle')
    await page.getByTestId('ai-abort').click()

    // Abort resolves to idle (not error) and the app stays alive.
    await expect.poll(() => extState(page, 'ai'), { timeout: 30_000 }).toBe('idle')
    await expect(page.getByTestId('ai-error')).toHaveText('')
    await expect(page.locator('#editor .ProseMirror')).toBeVisible()
  })
})
