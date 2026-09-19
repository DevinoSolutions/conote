import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { Ai } from '../src/index.js'
import type { AiOptions } from '../src/index.js'
import { FakeProvider } from './fakeProvider.js'

let editor: Editor

afterEach(() => {
  editor?.destroy()
})

function makeEditor(
  provider: FakeProvider,
  content: string,
  extra: Partial<Omit<AiOptions, 'provider'>> = {},
): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, Ai.configure({ provider, ...extra })],
    content,
  })
}

function selectEnd(target: Editor): void {
  target.view.dispatch(target.state.tr.setSelection(TextSelection.atEnd(target.state.doc)))
}

function select(target: Editor, from: number, to: number): void {
  target.view.dispatch(
    target.state.tr.setSelection(TextSelection.create(target.state.doc, from, to)),
  )
}

describe('Ai extension', () => {
  it('aiComplete streams chunks into the document at the cursor', async () => {
    const provider = new FakeProvider([' world', '!'])
    editor = makeEditor(provider, '<p>Hello</p>')
    selectEnd(editor)

    expect(editor.commands.aiComplete()).toBe(true)

    await vi.waitFor(() => expect(editor.getText()).toBe('Hello world!'))

    const request = provider.lastRequest
    expect(request?.messages[0].content).toContain('Continue the text')
    expect(request?.messages.at(-1)?.content).toContain('Hello')
  })

  it('aiRewrite replaces the selection with streamed output', async () => {
    const provider = new FakeProvider(['Hi there'])
    editor = makeEditor(provider, '<p>Hello</p>')
    select(editor, 1, 6)

    expect(editor.commands.aiRewrite()).toBe(true)

    await vi.waitFor(() => expect(editor.getText()).toBe('Hi there'))
    expect(provider.lastRequest?.messages.at(-1)?.content).toBe('Hello')
  })

  it('aiRewrite returns false on an empty selection', () => {
    editor = makeEditor(new FakeProvider(['x']), '<p>Hello</p>')
    selectEnd(editor)

    expect(editor.commands.aiRewrite()).toBe(false)
    expect(editor.storage.ai.state).toBe('idle')
  })

  it('rejects a concurrent command while streaming', async () => {
    const provider = new FakeProvider(['a', 'b'], { gated: true })
    editor = makeEditor(provider, '<p>Hello</p>')
    selectEnd(editor)

    expect(editor.commands.aiComplete()).toBe(true)
    expect(editor.storage.ai.state).toBe('pending')

    provider.open(0)
    await vi.waitFor(() => expect(editor.storage.ai.state).toBe('streaming'))

    expect(editor.commands.aiComplete()).toBe(false)

    provider.openAll()
    await vi.waitFor(() => expect(editor.storage.ai.state).toBe('idle'))
  })

  it('aiAbort stops mid-stream, returns to idle, and keeps partial text', async () => {
    const provider = new FakeProvider([' one', ' two'], { gated: true })
    editor = makeEditor(provider, '<p>Hi</p>')
    selectEnd(editor)

    editor.commands.aiComplete()
    provider.open(0)
    await vi.waitFor(() => expect(editor.getText()).toBe('Hi one'))
    expect(editor.storage.ai.state).toBe('streaming')

    expect(editor.commands.aiAbort()).toBe(true)

    await vi.waitFor(() => expect(editor.storage.ai.state).toBe('idle'))
    expect(editor.getText()).toBe('Hi one')
    expect(editor.storage.ai.error).toBeNull()
  })

  it('aiAbort returns false when nothing is in flight', () => {
    editor = makeEditor(new FakeProvider(['x']), '<p>Hello</p>')
    expect(editor.commands.aiAbort()).toBe(false)
  })

  it('surfaces a provider error as error state', async () => {
    const provider = new FakeProvider(['x'], { error: new Error('boom'), errorAfter: 0 })
    editor = makeEditor(provider, '<p>Hello</p>')
    selectEnd(editor)

    editor.commands.aiComplete()

    await vi.waitFor(() => expect(editor.storage.ai.state).toBe('error'))
    expect(editor.storage.ai.error?.message).toBe('boom')
  })

  it('aiAdjustTone builds a prompt with the tone and selection', async () => {
    const provider = new FakeProvider(['x'])
    editor = makeEditor(provider, '<p>Hello</p>')
    select(editor, 1, 6)

    editor.commands.aiAdjustTone('formal')

    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())
    const request = provider.lastRequest
    expect(request?.messages[0].content).toContain('formal')
    expect(request?.messages[0].content).toContain('tone')
    expect(request?.messages.at(-1)?.content).toBe('Hello')
  })

  it('aiAdjustTone returns false on an empty selection', () => {
    editor = makeEditor(new FakeProvider(['x']), '<p>Hello</p>')
    selectEnd(editor)
    expect(editor.commands.aiAdjustTone('formal')).toBe(false)
  })

  it('aiTranslate builds a prompt with the language and selection', async () => {
    const provider = new FakeProvider(['x'])
    editor = makeEditor(provider, '<p>Hello</p>')
    select(editor, 1, 6)

    editor.commands.aiTranslate('French')

    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())
    const request = provider.lastRequest
    expect(request?.messages[0].content).toContain('French')
    expect(request?.messages.at(-1)?.content).toBe('Hello')
  })

  it('aiCustomPrompt applies an instruction to the selection', async () => {
    const provider = new FakeProvider(['x'])
    editor = makeEditor(provider, '<p>Hello</p>')
    select(editor, 1, 6)

    editor.commands.aiCustomPrompt('Make it rhyme')

    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())
    const request = provider.lastRequest
    expect(request?.messages[0].content).toContain('Make it rhyme')
    expect(request?.messages.at(-1)?.content).toBe('Hello')
  })

  it('aiSummarize summarizes the whole document when the selection is empty', async () => {
    const provider = new FakeProvider(['Summary'])
    editor = makeEditor(provider, '<p>Long text here</p>')
    selectEnd(editor)

    editor.commands.aiSummarize()

    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())
    expect(provider.lastRequest?.messages.at(-1)?.content).toContain('Long text here')
  })

  it('passes per-command model and temperature overrides to the provider', async () => {
    const provider = new FakeProvider(['x'])
    editor = makeEditor(provider, '<p>Hello</p>', { defaultModel: 'base', temperature: 0.1 })
    select(editor, 1, 6)

    editor.commands.aiRewrite({ model: 'override-model', temperature: 0.9 })

    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())
    expect(provider.lastRequest?.model).toBe('override-model')
    expect(provider.lastRequest?.temperature).toBe(0.9)
  })

  it('falls back to the extension default model and temperature', async () => {
    const provider = new FakeProvider(['x'])
    editor = makeEditor(provider, '<p>Hello</p>', { defaultModel: 'base', temperature: 0.1 })
    select(editor, 1, 6)

    editor.commands.aiRewrite()

    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())
    expect(provider.lastRequest?.model).toBe('base')
    expect(provider.lastRequest?.temperature).toBe(0.1)
  })

  it('honors an insert override that replaces the selection', async () => {
    const provider = new FakeProvider(['Bye'])
    editor = makeEditor(provider, '<p>Hello</p>')
    select(editor, 1, 6)

    editor.commands.aiComplete({ insert: 'replaceSelection' })

    await vi.waitFor(() => expect(editor.getText()).toBe('Bye'))
  })

  it('transitions idle -> pending -> streaming -> idle', async () => {
    const provider = new FakeProvider(['a', 'b'], { gated: true })
    editor = makeEditor(provider, '<p>Hi</p>')
    selectEnd(editor)

    expect(editor.storage.ai.state).toBe('idle')

    editor.commands.aiComplete()
    expect(editor.storage.ai.state).toBe('pending')

    provider.open(0)
    await vi.waitFor(() => expect(editor.storage.ai.state).toBe('streaming'))

    provider.open(1)
    await vi.waitFor(() => expect(editor.storage.ai.state).toBe('idle'))
  })

  it('appends document context supplied via options', async () => {
    const provider = new FakeProvider(['x'])
    editor = makeEditor(provider, '<p>Hello</p>', { context: () => 'PROJECT FACTS' })
    select(editor, 1, 6)

    editor.commands.aiRewrite()

    await vi.waitFor(() => expect(provider.lastRequest).toBeDefined())
    const contents = provider.lastRequest?.messages.map(message => message.content) ?? []
    expect(contents.some(content => content.includes('PROJECT FACTS'))).toBe(true)
  })
})
