import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { AiChanges, aiChangesPluginKey } from '../src/index.js'
import type { AiChange, AiChangesOptions } from '../src/index.js'
import { FakeChangeProvider } from './fakeProvider.js'

let editor: Editor

afterEach(() => {
  editor?.destroy()
})

function makeEditor(
  provider: FakeChangeProvider,
  content: string,
  extra: Partial<Omit<AiChangesOptions, 'provider'>> = {},
): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, AiChanges.configure({ provider, ...extra })],
    content,
  })
}

function changes(target: Editor): AiChange[] {
  return aiChangesPluginKey.getState(target.state)?.changes ?? []
}

function byOldText(target: Editor, oldText: string): AiChange | undefined {
  return changes(target).find(item => item.oldText === oldText)
}

const PROMPT = { prompt: 'Rewrite it.' }

describe('AiChanges extension', () => {
  it('proposes a replace change without modifying the document', async () => {
    const provider = new FakeChangeProvider('the dog')
    editor = makeEditor(provider, '<p>the cat</p>')

    expect(editor.commands.aiChangesPropose(PROMPT)).toBe(true)
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))

    // Document is unchanged; the change is only previewed.
    expect(editor.getText()).toBe('the cat')

    const change = byOldText(editor, 'cat')
    expect(change).toBeDefined()
    expect(change?.newText).toBe('dog')
    expect(change?.range).toEqual({ from: 5, to: 8 })
    expect(editor.state.doc.textBetween(change!.range.from, change!.range.to)).toBe('cat')

    // Storage mirrors plugin state for UI binding.
    expect(editor.storage.aiChanges.changes).toHaveLength(1)
  })

  it('renders a deletion inline decoration and an insertion widget', async () => {
    const provider = new FakeChangeProvider('the dog')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(1))

    const decorations = aiChangesPluginKey.getState(editor.state)?.decorations.find() ?? []
    // One inline (deletion) + one widget (insertion).
    expect(decorations).toHaveLength(2)
  })

  it('sends only the selected slice to the provider and anchors within it', async () => {
    const provider = new FakeChangeProvider('earth')
    editor = makeEditor(provider, '<p>hello world</p>')

    // Select "world" (positions 7..12).
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 12)),
    )

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))

    // Only the selected text was sent, not the whole paragraph.
    const sent = provider.lastRequest?.messages.at(-1)?.content ?? ''
    expect(sent).toContain('world')
    expect(sent).not.toContain('hello')

    const change = byOldText(editor, 'world')
    expect(change?.range).toEqual({ from: 7, to: 12 })
    expect(change?.newText).toBe('earth')
    expect(editor.getText()).toBe('hello world')
  })

  it('accepts a change and remaps the remaining ones', async () => {
    // "big" is a shared token, so the diff splits into two independent hunks.
    const provider = new FakeChangeProvider('the big dog')
    editor = makeEditor(provider, '<p>teh big cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(2))

    const catChange = byOldText(editor, 'cat')!
    expect(editor.commands.aiChangesAccept(catChange.id)).toBe(true)
    expect(editor.getText()).toBe('teh big dog')

    const remaining = changes(editor)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].oldText).toBe('teh ')
    expect(editor.state.doc.textBetween(remaining[0].range.from, remaining[0].range.to)).toBe(
      'teh ',
    )

    editor.commands.aiChangesAccept(remaining[0].id)
    expect(editor.getText()).toBe('the big dog')
    expect(changes(editor)).toHaveLength(0)
  })

  it('accepts an insertion change', async () => {
    const provider = new FakeChangeProvider('a b c')
    editor = makeEditor(provider, '<p>a c</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(1))

    const insertion = changes(editor)[0]
    expect(insertion.oldText).toBe('')
    expect(insertion.range.from).toBe(insertion.range.to)
    expect(insertion.newText).toBe('b ')

    editor.commands.aiChangesAccept(insertion.id)
    expect(editor.getText()).toBe('a b c')
  })

  it('accepts a deletion change', async () => {
    const provider = new FakeChangeProvider('a c')
    editor = makeEditor(provider, '<p>a b c</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(1))

    const deletion = changes(editor)[0]
    expect(deletion.oldText).toBe('b ')
    expect(deletion.newText).toBe('')

    editor.commands.aiChangesAccept(deletion.id)
    expect(editor.getText()).toBe('a c')
  })

  it('rejects a change without changing the document', async () => {
    const provider = new FakeChangeProvider('the dog')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(1))

    const change = changes(editor)[0]
    expect(editor.commands.aiChangesReject(change.id)).toBe(true)
    expect(changes(editor)).toHaveLength(0)
    expect(editor.getText()).toBe('the cat')
  })

  it('returns false when accepting or rejecting an unknown id', async () => {
    const provider = new FakeChangeProvider('the cat')
    editor = makeEditor(provider, '<p>the cat</p>')

    expect(editor.commands.aiChangesAccept('missing')).toBe(false)
    expect(editor.commands.aiChangesReject('missing')).toBe(false)
  })

  it('accept-all reproduces the full rewrite in one transaction', async () => {
    const provider = new FakeChangeProvider('the big dog')
    editor = makeEditor(provider, '<p>teh big cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(2))

    expect(editor.commands.aiChangesAcceptAll()).toBe(true)
    expect(editor.getText()).toBe('the big dog')
    expect(changes(editor)).toHaveLength(0)
  })

  it('reject-all drops every change without touching the document', async () => {
    const provider = new FakeChangeProvider('the big dog')
    editor = makeEditor(provider, '<p>teh big cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(2))

    expect(editor.commands.aiChangesRejectAll()).toBe(true)
    expect(changes(editor)).toHaveLength(0)
    expect(editor.getText()).toBe('teh big cat')
    expect(editor.commands.aiChangesRejectAll()).toBe(false)
  })

  it('invalidates a change when the user edits inside its range', async () => {
    const provider = new FakeChangeProvider('the dog')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(byOldText(editor, 'cat')).toBeDefined())

    // Type a character inside "cat" (position 6).
    editor.view.dispatch(editor.state.tr.insertText('z', 6))
    expect(byOldText(editor, 'cat')).toBeUndefined()
  })

  it('shifts a change range when the user edits before it', async () => {
    const provider = new FakeChangeProvider('the dog')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(byOldText(editor, 'cat')).toBeDefined())
    expect(byOldText(editor, 'cat')?.range).toEqual({ from: 5, to: 8 })

    // Insert two characters at the start of the paragraph.
    editor.view.dispatch(editor.state.tr.insertText('AB', 1))
    const shifted = byOldText(editor, 'cat')
    expect(shifted?.range).toEqual({ from: 7, to: 10 })
    expect(editor.state.doc.textBetween(7, 10)).toBe('cat')
  })

  it('produces no changes when the model returns identical text', async () => {
    const provider = new FakeChangeProvider('the cat')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))
    expect(changes(editor)).toHaveLength(0)
  })

  it('proposes zero changes when the model only reflows whitespace', async () => {
    const provider = new FakeChangeProvider('hello  world')
    editor = makeEditor(provider, '<p>hello world</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))

    expect(changes(editor)).toHaveLength(0)
    expect(editor.getText()).toBe('hello world')
  })

  it('keeps a real edit while ignoring adjacent whitespace-only noise', async () => {
    // The model both doubles a space (noise) and rewrites "foo" -> "bar" (real).
    const provider = new FakeChangeProvider('hello  world bar')
    editor = makeEditor(provider, '<p>hello world foo</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))

    const staged = changes(editor)
    expect(staged).toHaveLength(1)
    expect(staged[0].oldText).toBe('foo')

    editor.commands.aiChangesAccept(staged[0].id)
    // Real edit applied; the whitespace reflow was never surfaced.
    expect(editor.getText()).toBe('hello world bar')
  })

  it('accept trims a trailing space that would double against the next word', async () => {
    const provider = new FakeChangeProvider('unused')
    editor = makeEditor(provider, '<p>the cat sat</p>')

    // "cat" -> "dog " (stray trailing space) staged directly.
    editor.commands.aiChangesSet([{ range: { from: 5, to: 8 }, oldText: 'cat', newText: 'dog ' }])
    const change = changes(editor)[0]
    editor.commands.aiChangesAccept(change.id)

    expect(editor.getText()).toBe('the dog sat')
  })

  it('accept of a bare-letter deletion collapses the doubled space', async () => {
    const provider = new FakeChangeProvider('unused')
    editor = makeEditor(provider, '<p>a b c</p>')

    // Delete just "b" (not its surrounding spaces).
    editor.commands.aiChangesSet([{ range: { from: 3, to: 4 }, oldText: 'b', newText: '' }])
    const change = changes(editor)[0]
    editor.commands.aiChangesAccept(change.id)

    expect(editor.getText()).toBe('a c')
  })

  it('accept of a natural word insertion keeps single spacing', async () => {
    const provider = new FakeChangeProvider('a b c')
    editor = makeEditor(provider, '<p>a c</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(1))

    editor.commands.aiChangesAccept(changes(editor)[0].id)
    expect(editor.getText()).toBe('a b c')
  })

  it('strips markdown code fences from the response', async () => {
    const provider = new FakeChangeProvider('```\nthe dog\n```')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))

    const change = byOldText(editor, 'cat')
    expect(change?.newText).toBe('dog')
  })

  it('sets error state when the provider throws', async () => {
    const provider = new FakeChangeProvider('the dog', { error: new Error('boom') })
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('error'))
    expect(editor.storage.aiChanges.error?.message).toBe('boom')
    expect(changes(editor)).toHaveLength(0)
  })

  it('is single-flight: a second proposal is rejected while one is in progress', async () => {
    const provider = new FakeChangeProvider('the dog', { gated: true })
    editor = makeEditor(provider, '<p>the cat</p>')

    expect(editor.commands.aiChangesPropose(PROMPT)).toBe(true)
    expect(editor.storage.aiChanges.state).toBe('loading')
    expect(editor.commands.aiChangesPropose(PROMPT)).toBe(false)

    provider.open()
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))
    expect(provider.calls).toHaveLength(1)
  })

  it('transitions idle -> loading -> idle', async () => {
    const provider = new FakeChangeProvider('the dog', { gated: true })
    editor = makeEditor(provider, '<p>the cat</p>')

    expect(editor.storage.aiChanges.state).toBe('idle')
    editor.commands.aiChangesPropose(PROMPT)
    expect(editor.storage.aiChanges.state).toBe('loading')

    provider.open()
    await vi.waitFor(() => expect(editor.storage.aiChanges.state).toBe('idle'))
  })

  it('selects a change and marks its decorations', async () => {
    const provider = new FakeChangeProvider('the dog')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesPropose(PROMPT)
    await vi.waitFor(() => expect(changes(editor)).toHaveLength(1))

    const change = changes(editor)[0]
    expect(editor.commands.aiChangesSelect(change.id)).toBe(true)
    expect(editor.storage.aiChanges.selectedId).toBe(change.id)

    const decoration = (aiChangesPluginKey.getState(editor.state)?.decorations.find() ?? [])[0]
    expect(
      (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class,
    ).toContain('conote-ai-change-del--selected')

    expect(editor.commands.aiChangesSelect(null)).toBe(true)
    expect(editor.storage.aiChanges.selectedId).toBeNull()
  })

  it('returns false when selecting an unknown id', async () => {
    const provider = new FakeChangeProvider('the cat')
    editor = makeEditor(provider, '<p>the cat</p>')
    expect(editor.commands.aiChangesSelect('missing')).toBe(false)
  })

  it('stages changes programmatically via aiChangesSet and drops invalid ones', async () => {
    const provider = new FakeChangeProvider('unused')
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiChangesSet([
      { range: { from: 5, to: 8 }, oldText: 'cat', newText: 'dog' },
      { range: { from: 5, to: 8 }, oldText: 'WRONG', newText: 'x' },
      { range: { from: 1, to: 999 }, oldText: 'out of bounds', newText: 'y' },
    ])

    const staged = changes(editor)
    expect(staged).toHaveLength(1)
    expect(staged[0].oldText).toBe('cat')
    expect(staged[0].newText).toBe('dog')
    expect(editor.getText()).toBe('the cat')
  })
})
