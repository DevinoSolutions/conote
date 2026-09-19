import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { AiSuggestion, aiSuggestionPluginKey } from '../src/index.js'
import type { AiSuggestion as AiSuggestionType, AiSuggestionOptions } from '../src/index.js'
import { FakeSuggestionProvider } from './fakeProvider.js'

let editor: Editor

afterEach(() => {
  editor?.destroy()
})

const RULES: AiSuggestionOptions['rules'] = [
  {
    id: 'spelling',
    title: 'Spelling & grammar',
    prompt: 'Fix spelling and grammar.',
    color: '#f00',
  },
  { id: 'concise', title: 'Conciseness', prompt: 'Make the text more concise.' },
]

function makeEditor(
  provider: FakeSuggestionProvider,
  content: string,
  extra: Partial<Omit<AiSuggestionOptions, 'provider'>> = {},
): Editor {
  return new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      AiSuggestion.configure({ provider, rules: RULES, ...extra }),
    ],
    content,
  })
}

function json(suggestions: Array<Record<string, unknown>>): string {
  return JSON.stringify({ suggestions })
}

function suggestions(target: Editor): AiSuggestionType[] {
  return aiSuggestionPluginKey.getState(target.state)?.suggestions ?? []
}

function byDeleteText(target: Editor, deleteText: string): AiSuggestionType | undefined {
  return suggestions(target).find(item => item.deleteText === deleteText)
}

describe('AiSuggestion extension', () => {
  it('locates suggestions at the correct document ranges and decorates them', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'teh', replacementText: 'the', note: 'typo' }]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    expect(editor.commands.aiSuggestionLoad()).toBe(true)
    await vi.waitFor(() => expect(editor.storage.aiSuggestion.state).toBe('idle'))

    const list = suggestions(editor)
    expect(list).toHaveLength(1)
    expect(list[0].range).toEqual({ from: 1, to: 4 })
    expect(list[0].note).toBe('typo')

    const decorations = aiSuggestionPluginKey.getState(editor.state)?.decorations.find() ?? []
    expect(decorations).toHaveLength(1)
    expect(decorations[0].from).toBe(1)
    expect(decorations[0].to).toBe(4)

    // Storage mirrors plugin state for UI binding.
    expect(editor.storage.aiSuggestion.suggestions).toHaveLength(1)
  })

  it('sends the document text and rules to the provider', async () => {
    const provider = new FakeSuggestionProvider(json([]))
    editor = makeEditor(provider, '<p>hello world</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())

    const messages = provider.lastRequest?.messages ?? []
    expect(messages[0].content).toContain('spelling')
    expect(messages[0].content).toContain('concise')
    expect(messages.at(-1)?.content).toContain('hello world')
  })

  it('applies a suggestion and remaps the remaining ones', async () => {
    const provider = new FakeSuggestionProvider(
      json([
        { ruleId: 'spelling', deleteText: 'teh', replacementText: 'XXXXX' },
        { ruleId: 'spelling', deleteText: 'cat', replacementText: 'dog' },
      ]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(2))

    const first = byDeleteText(editor, 'teh')!
    expect(editor.commands.aiSuggestionApply(first.id)).toBe(true)

    expect(editor.getText()).toBe('XXXXX cat')
    const remaining = suggestions(editor)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].deleteText).toBe('cat')
    // The remaining range was remapped past the longer replacement.
    expect(editor.state.doc.textBetween(remaining[0].range.from, remaining[0].range.to)).toBe('cat')

    editor.commands.aiSuggestionApply(remaining[0].id)
    expect(editor.getText()).toBe('XXXXX dog')
    expect(suggestions(editor)).toHaveLength(0)
  })

  it('rejects a suggestion without changing the document', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'teh', replacementText: 'the' }]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    const target = suggestions(editor)[0]
    expect(editor.commands.aiSuggestionReject(target.id)).toBe(true)
    expect(suggestions(editor)).toHaveLength(0)
    expect(editor.getText()).toBe('teh cat')
  })

  it('returns false when applying or rejecting an unknown id', async () => {
    const provider = new FakeSuggestionProvider(json([]))
    editor = makeEditor(provider, '<p>teh cat</p>')

    expect(editor.commands.aiSuggestionApply('missing')).toBe(false)
    expect(editor.commands.aiSuggestionReject('missing')).toBe(false)
  })

  it('invalidates a suggestion when the user edits inside its range', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'teh', replacementText: 'the' }]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    // Type a character inside "teh".
    editor.view.dispatch(editor.state.tr.insertText('z', 2))
    expect(suggestions(editor)).toHaveLength(0)
  })

  it('shifts a suggestion range when the user edits before it', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'cat', replacementText: 'dog' }]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))
    expect(suggestions(editor)[0].range).toEqual({ from: 5, to: 8 })

    // Insert two characters at the start of the paragraph.
    editor.view.dispatch(editor.state.tr.insertText('AB', 1))
    const shifted = suggestions(editor)
    expect(shifted).toHaveLength(1)
    expect(shifted[0].range).toEqual({ from: 7, to: 10 })
    expect(editor.state.doc.textBetween(7, 10)).toBe('cat')
  })

  it('apply trims a stray trailing space in the replacement', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'cat', replacementText: 'dog ' }]),
    )
    editor = makeEditor(provider, '<p>the cat sat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    editor.commands.aiSuggestionApply(suggestions(editor)[0].id)
    expect(editor.getText()).toBe('the dog sat')
  })

  it('apply trims a stray leading space in the replacement', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'cat', replacementText: ' dog' }]),
    )
    editor = makeEditor(provider, '<p>the cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    editor.commands.aiSuggestionApply(suggestions(editor)[0].id)
    expect(editor.getText()).toBe('the dog')
  })

  it('apply of a bare-word deletion collapses the doubled space', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'concise', deleteText: 'very', replacementText: '' }]),
    )
    editor = makeEditor(provider, '<p>a very big cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    editor.commands.aiSuggestionApply(suggestions(editor)[0].id)
    expect(editor.getText()).toBe('a big cat')
  })

  it('disambiguates repeated matches using beforeText', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'foo', beforeText: 'bar ', replacementText: 'FOO' }]),
    )
    editor = makeEditor(provider, '<p>foo bar foo baz</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    // Second "foo" begins at text index 8 -> position 9.
    expect(suggestions(editor)[0].range).toEqual({ from: 9, to: 12 })
  })

  it('tolerates a markdown-fenced JSON response', async () => {
    const provider = new FakeSuggestionProvider(
      '```json\n' +
        json([{ ruleId: 'spelling', deleteText: 'teh', replacementText: 'the' }]) +
        '\n```',
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(editor.storage.aiSuggestion.state).toBe('idle'))
    expect(suggestions(editor)).toHaveLength(1)
  })

  it('sets error state on invalid JSON', async () => {
    const provider = new FakeSuggestionProvider('this is not json {')
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(editor.storage.aiSuggestion.state).toBe('error'))
    expect(editor.storage.aiSuggestion.error).toBeInstanceOf(Error)
    expect(suggestions(editor)).toHaveLength(0)
  })

  it('sets error state when the provider throws', async () => {
    const provider = new FakeSuggestionProvider(json([]), { error: new Error('boom') })
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(editor.storage.aiSuggestion.state).toBe('error'))
    expect(editor.storage.aiSuggestion.error?.message).toBe('boom')
  })

  it('drops unmatched and unknown-rule suggestions and counts them', async () => {
    const provider = new FakeSuggestionProvider(
      json([
        { ruleId: 'spelling', deleteText: 'teh', replacementText: 'the' },
        { ruleId: 'spelling', deleteText: 'zzz', replacementText: 'q' },
        { ruleId: 'nope', deleteText: 'cat', replacementText: 'dog' },
      ]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(editor.storage.aiSuggestion.state).toBe('idle'))

    expect(suggestions(editor)).toHaveLength(1)
    expect(editor.storage.aiSuggestion.droppedCount).toBe(2)
  })

  it('is single-flight: a second load is rejected while one is in progress', async () => {
    const provider = new FakeSuggestionProvider(json([]), { gated: true })
    editor = makeEditor(provider, '<p>teh cat</p>')

    expect(editor.commands.aiSuggestionLoad()).toBe(true)
    expect(editor.storage.aiSuggestion.state).toBe('loading')
    expect(editor.commands.aiSuggestionLoad()).toBe(false)

    provider.open()
    await vi.waitFor(() => expect(editor.storage.aiSuggestion.state).toBe('idle'))
    expect(provider.calls).toHaveLength(1)
  })

  it('transitions idle -> loading -> idle', async () => {
    const provider = new FakeSuggestionProvider(json([]), { gated: true })
    editor = makeEditor(provider, '<p>teh cat</p>')

    expect(editor.storage.aiSuggestion.state).toBe('idle')
    editor.commands.aiSuggestionLoad()
    expect(editor.storage.aiSuggestion.state).toBe('loading')

    provider.open()
    await vi.waitFor(() => expect(editor.storage.aiSuggestion.state).toBe('idle'))
  })

  it('applies all suggestions in one step', async () => {
    const provider = new FakeSuggestionProvider(
      json([
        { ruleId: 'spelling', deleteText: 'teh', replacementText: 'the' },
        { ruleId: 'spelling', deleteText: 'cat', replacementText: 'dog' },
      ]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(2))

    expect(editor.commands.aiSuggestionApplyAll()).toBe(true)
    expect(editor.getText()).toBe('the dog')
    expect(suggestions(editor)).toHaveLength(0)
  })

  it('clears all suggestions without changing the document', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'teh', replacementText: 'the' }]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    expect(editor.commands.aiSuggestionClear()).toBe(true)
    expect(suggestions(editor)).toHaveLength(0)
    expect(editor.getText()).toBe('teh cat')
    expect(editor.commands.aiSuggestionClear()).toBe(false)
  })

  it('selects a suggestion and marks its decoration', async () => {
    const provider = new FakeSuggestionProvider(
      json([{ ruleId: 'spelling', deleteText: 'teh', replacementText: 'the' }]),
    )
    editor = makeEditor(provider, '<p>teh cat</p>')

    editor.commands.aiSuggestionLoad()
    await vi.waitFor(() => expect(suggestions(editor)).toHaveLength(1))

    const target = suggestions(editor)[0]
    expect(editor.commands.aiSuggestionSelect(target.id)).toBe(true)
    expect(editor.storage.aiSuggestion.selectedId).toBe(target.id)

    const decoration = (aiSuggestionPluginKey.getState(editor.state)?.decorations.find() ?? [])[0]
    expect(
      (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class,
    ).toContain('conote-ai-suggestion--selected')

    expect(editor.commands.aiSuggestionSelect(null)).toBe(true)
    expect(editor.storage.aiSuggestion.selectedId).toBeNull()
  })

  it('returns false when selecting an unknown id', async () => {
    const provider = new FakeSuggestionProvider(json([]))
    editor = makeEditor(provider, '<p>teh cat</p>')
    expect(editor.commands.aiSuggestionSelect('missing')).toBe(false)
  })
})
