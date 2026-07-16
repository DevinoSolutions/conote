import { expect, test } from '@playwright/test'
import { decorationCount, docText, extState, gotoFresh, seed } from './helpers'

const MISSPELLED =
  '<p>Last week our team recieved the final report and we where definately impressed by teh results.</p>'

function suggestionCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => ((window as any).editor.storage.aiSuggestion.suggestions as unknown[]).length,
  )
}

test.describe('AI Suggestion / Proofread (@conote/extension-ai-suggestion)', () => {
  test('proofread decorates misspellings; apply then dismiss behave as invariants', async ({
    page,
  }) => {
    await gotoFresh(page)
    await seed(page, MISSPELLED)

    await page.getByTestId('load-suggestions').click()

    // Load resolves to idle with at least one suggestion.
    await expect.poll(() => extState(page, 'aiSuggestion'), { timeout: 60_000 }).toBe('idle')
    await expect(page.getByTestId('suggestion-error')).toHaveText('')
    await expect.poll(() => suggestionCount(page), { timeout: 5_000 }).toBeGreaterThan(0)

    // Invariant: at least one decoration and one sidebar card exist.
    expect(await decorationCount(page, '.conote-ai-suggestion')).toBeGreaterThan(0)
    await expect(page.getByTestId('suggestion-0')).toBeVisible()

    // Capture the first suggestion's target text, then apply it.
    const deleteText: string = await page.evaluate(
      () => (window as any).editor.storage.aiSuggestion.suggestions[0].deleteText as string,
    )
    await page.getByTestId('accept-0').click()

    // Invariant: the applied suggestion's original text is gone from the doc.
    await expect.poll(() => docText(page), { timeout: 10_000 }).not.toContain(deleteText)
    const postApply = await docText(page)

    // Dismiss all remaining suggestions: decorations disappear, doc is untouched.
    await page.getByTestId('dismiss-all').click()
    await expect
      .poll(() => decorationCount(page, '.conote-ai-suggestion'), { timeout: 10_000 })
      .toBe(0)
    expect(await docText(page)).toBe(postApply)
  })
})
