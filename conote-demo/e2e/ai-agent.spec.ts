import { expect, test, type Page } from '@playwright/test'
import { docText, extState, gotoFresh, seed } from './helpers'

const X = 'banana'
const Y = 'orange'

function stagedChangesCount(page: Page): Promise<number> {
  return page.evaluate(() => ((window as any).editor.storage.aiChanges.changes as unknown[]).length)
}

function hasAssistantTurn(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    ((window as any).editor.storage.aiAgent.transcript as { role: string }[]).some(
      turn => turn.role === 'assistant',
    ),
  )
}

test.describe('AI Agent (@conote/extension-ai-agent, review mode)', () => {
  test('agent stages a tool edit for review; accept applies it', async ({ page }) => {
    await gotoFresh(page)
    await seed(page, `<p>I ate a ${X} today.</p>`)
    const original = await docText(page)
    expect(original).toContain(X)

    await page.getByTestId('agent-input').fill(`Replace the word ${X} with ${Y} using your tools.`)
    await page.getByTestId('agent-send').click()

    // Working indicator appears while the agent loop runs.
    await expect.poll(() => extState(page, 'aiAgent'), { timeout: 30_000 }).toBe('working')

    // Run settles back to idle without error.
    await expect.poll(() => extState(page, 'aiAgent'), { timeout: 90_000 }).toBe('idle')
    await expect(page.getByTestId('agent-error')).toHaveText('')

    // Invariant: the transcript gained an assistant turn.
    expect(await hasAssistantTurn(page)).toBeTruthy()

    // Invariant: review mode stages edits into the Changes sidebar, and the doc
    // is untouched until the user accepts.
    await expect.poll(() => stagedChangesCount(page), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect(page.getByTestId('change-0')).toBeVisible()
    expect(await docText(page)).toBe(original)

    // Accept all staged changes: X is replaced by Y in the real document.
    await page.getByTestId('accept-all-changes').click()
    await expect.poll(() => stagedChangesCount(page), { timeout: 10_000 }).toBe(0)
    const finalText = await docText(page)
    expect(finalText).toContain(Y)
    expect(finalText).not.toContain(X)
  })
})
