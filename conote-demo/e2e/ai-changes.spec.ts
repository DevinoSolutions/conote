import { expect, test, type Page } from '@playwright/test'
import { decorationCount, docText, extState, gotoFresh, seed } from './helpers'

const MISSPELLED =
  '<p>Last week our team recieved the final report and we where definately impressed.</p>'

function changesCount(page: Page): Promise<number> {
  return page.evaluate(() => ((window as any).editor.storage.aiChanges.changes as unknown[]).length)
}

async function propose(page: Page, prompt: string): Promise<void> {
  await page.getByTestId('change-prompt').fill(prompt)
  await page.getByTestId('propose-changes').click()
  await expect.poll(() => extState(page, 'aiChanges'), { timeout: 60_000 }).toBe('idle')
  await expect(page.getByTestId('changes-error')).toHaveText('')
  await expect.poll(() => changesCount(page), { timeout: 5_000 }).toBeGreaterThan(0)
}

test.describe('Edit with AI / Changes (@conote/extension-ai-changes)', () => {
  test('proposing previews without mutating; accept-all applies', async ({ page }) => {
    await gotoFresh(page)
    await seed(page, MISSPELLED)
    const original = await docText(page)

    await propose(page, 'Fix all spelling mistakes. Change nothing else.')

    // Invariant: a change card and inline decorations exist.
    await expect(page.getByTestId('change-0')).toBeVisible()
    const decorations =
      (await decorationCount(page, '.conote-ai-change-del')) +
      (await decorationCount(page, '.conote-ai-change-ins'))
    expect(decorations).toBeGreaterThan(0)

    // Invariant: the real document text is unchanged while previewing.
    expect(await docText(page)).toBe(original)

    // Accept all: doc text now differs from the original and the list is empty.
    await page.getByTestId('accept-all-changes').click()
    await expect.poll(() => changesCount(page), { timeout: 10_000 }).toBe(0)
    expect(await docText(page)).not.toBe(original)
  })

  test('proposing then reject-all leaves the document identical', async ({ page }) => {
    await gotoFresh(page)
    await seed(page, MISSPELLED)
    const original = await docText(page)

    await propose(page, 'Fix all spelling mistakes. Change nothing else.')

    await page.getByTestId('reject-all-changes').click()
    await expect.poll(() => changesCount(page), { timeout: 10_000 }).toBe(0)
    await expect
      .poll(() => decorationCount(page, '.conote-ai-change-ins'), { timeout: 10_000 })
      .toBe(0)
    expect(await docText(page)).toBe(original)
  })
})
