import { expect, type Page } from '@playwright/test'

// The demo exposes the live Editor instance on window (src/main.ts). All doc
// inspection and reseeding goes through this handle so tests read the REAL
// ProseMirror document, never the DOM (whose textContent includes insertion
// widgets — see the Phase 3 gotcha in the spec).

/** Navigate to a clean app instance and wait until the editor is mounted. */
export async function gotoFresh(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('ai-status')).toBeVisible()
  await page.waitForFunction(() => Boolean((window as any).editor?.state))
}

/** Replace the whole document via the editor command, then confirm it landed. */
export async function seed(page: Page, html: string): Promise<void> {
  await page.evaluate(content => {
    ;(window as any).editor.commands.setContent(content)
  }, html)
  // setContent is synchronous, but wait for a non-empty doc to be safe.
  await page.waitForFunction(
    () => ((window as any).editor.state.doc.textContent as string).length > 0,
  )
}

/** Real document text, straight from ProseMirror state. */
export function docText(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).editor.state.doc.textContent as string)
}

type Ext = 'ai' | 'aiSuggestion' | 'aiChanges' | 'aiAgent'

/** Current lifecycle state string of one AI extension's storage. */
export function extState(page: Page, ext: Ext): Promise<string> {
  return page.evaluate(name => (window as any).editor.storage[name].state as string, ext)
}

/** Select the entire document (so selection-scoped AI commands have a target). */
export async function selectAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = (window as any).editor
    editor.commands.focus()
    editor.commands.selectAll()
  })
}

/** Count decoration nodes matching a selector inside the editor DOM. */
export function decorationCount(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    sel => (window as any).editor.view.dom.querySelectorAll(sel).length,
    selector,
  )
}
