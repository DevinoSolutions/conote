import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiChanges, aiChangesPluginKey } from '../../conote-extension-ai-changes/src/index.js'
import { AiAgent } from '../src/index.js'
import { INSERT_TEXT, READ_DOCUMENT, REPLACE_TEXT } from '../src/index.js'
import type { AiAgentOptions } from '../src/index.js'
import { FakeChatProvider, replyTurn, toolTurn } from './fakeProvider.js'

let editor: Editor

afterEach(() => {
  editor?.destroy()
})

/** Editor with AiChanges + AiAgent (review mode can stage). */
function makeReviewEditor(
  provider: FakeChatProvider,
  content: string,
  extra: Partial<Omit<AiAgentOptions, 'provider'>> = {},
): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, AiChanges, AiAgent.configure({ provider, ...extra })],
    content,
  })
}

/** Editor with AiAgent only (no AiChanges) — for direct mode or the missing-dep case. */
function makeAgentOnlyEditor(
  provider: FakeChatProvider,
  content: string,
  extra: Partial<Omit<AiAgentOptions, 'provider'>> = {},
): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, AiAgent.configure({ provider, ...extra })],
    content,
  })
}

function stagedChanges(target: Editor) {
  return aiChangesPluginKey.getState(target.state)?.changes ?? []
}

function agentStorage(target: Editor) {
  return target.storage.aiAgent
}

describe('AiAgent extension', () => {
  it('serializes assistant tool-call turns and tool results into follow-up requests', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'cat', replace: 'dog' }),
      replyTurn('Changed cat to dog.'),
    ])
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('Change cat to dog.')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    // The second request carries the assistant tool-call turn and the tool result.
    const followUp = provider.calls[1].messages
    expect(followUp[2]).toEqual({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'call_replace_text', name: REPLACE_TEXT, arguments: { find: 'cat', replace: 'dog' } }],
    })
    expect(followUp[3]).toEqual({
      role: 'tool',
      toolCallId: 'call_replace_text',
      content: 'Replaced "cat" with "dog".',
    })
    // Tools are advertised on every request.
    expect(provider.calls[0].tools?.map(t => t.name)).toEqual([READ_DOCUMENT, REPLACE_TEXT, INSERT_TEXT])
  })

  it('replace_text stages a change with the correct range without touching the document', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'cat', replace: 'dog' }),
      replyTurn('done'),
    ])
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('fix')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    // Document untouched; the edit is staged for review.
    expect(editor.getText()).toBe('the cat')
    const changes = stagedChanges(editor)
    expect(changes).toHaveLength(1)
    expect(changes[0].oldText).toBe('cat')
    expect(changes[0].newText).toBe('dog')
    expect(changes[0].range).toEqual({ from: 5, to: 8 })
    expect(editor.state.doc.textBetween(5, 8)).toBe('cat')
    expect(agentStorage(editor).lastStagedCount).toBe(1)
  })

  it('replace_text disambiguates with before_context', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'cat', replace: 'dog', before_context: 'dog ' }),
      replyTurn('done'),
    ])
    editor = makeReviewEditor(provider, '<p>cat dog cat</p>')

    editor.commands.aiAgentSend('fix the second cat')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    const changes = stagedChanges(editor)
    expect(changes).toHaveLength(1)
    // The SECOND "cat" (offset 8 → position 9), not the first.
    expect(changes[0].range).toEqual({ from: 9, to: 12 })
    expect(editor.state.doc.textBetween(9, 12)).toBe('cat')
  })

  it('reports "not found" and stages nothing when the quote is absent', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'zebra', replace: 'x' }),
      replyTurn('I could not find that text.'),
    ])
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('replace zebra')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    expect(provider.calls[1].messages[3]).toMatchObject({ role: 'tool' })
    expect((provider.calls[1].messages[3] as { content: string }).content).toContain('Not found')
    expect(stagedChanges(editor)).toHaveLength(0)
    expect(agentStorage(editor).lastStagedCount).toBe(0)
  })

  it('deletes text via replace_text with an empty replace', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'the ', replace: '' }),
      replyTurn('done'),
    ])
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('drop the article')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    const changes = stagedChanges(editor)
    expect(changes).toHaveLength(1)
    expect(changes[0].oldText).toBe('the ')
    expect(changes[0].newText).toBe('')
  })

  it('insert_text stages an insertion at the start', async () => {
    const provider = new FakeChatProvider([
      toolTurn(INSERT_TEXT, { position: 'start', text: 'X ' }),
      replyTurn('done'),
    ])
    editor = makeReviewEditor(provider, '<p>hello</p>')

    editor.commands.aiAgentSend('prefix')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    const changes = stagedChanges(editor)
    expect(changes).toHaveLength(1)
    expect(changes[0].oldText).toBe('')
    expect(changes[0].newText).toBe('X ')
    expect(changes[0].range).toEqual({ from: 1, to: 1 })
    expect(editor.getText()).toBe('hello')
  })

  it('insert_text stages an insertion at the end', async () => {
    const provider = new FakeChatProvider([
      toolTurn(INSERT_TEXT, { position: 'end', text: ' Y' }),
      replyTurn('done'),
    ])
    editor = makeReviewEditor(provider, '<p>hello</p>')

    editor.commands.aiAgentSend('suffix')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    const changes = stagedChanges(editor)
    expect(changes).toHaveLength(1)
    expect(changes[0].newText).toBe(' Y')
    expect(changes[0].range).toEqual({ from: 6, to: 6 })
  })

  it('read_document reflects the virtual text (base + staged edits) mid-loop', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'cat', replace: 'dog' }, 'call_1'),
      toolTurn(READ_DOCUMENT, {}, 'call_2'),
      replyTurn('done'),
    ])
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('fix then read')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    // The read_document result (third request's last tool message) shows the edit applied.
    const thirdRequest = provider.calls[2].messages
    const lastToolResult = thirdRequest[thirdRequest.length - 1] as { role: string; content: string }
    expect(lastToolResult.role).toBe('tool')
    expect(lastToolResult.content).toBe('the dog')
    // But the real document is still untouched (review mode).
    expect(editor.getText()).toBe('the cat')
  })

  it('stages multiple non-overlapping edits with correct ranges', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'quick', replace: 'slow' }, 'a'),
      toolTurn(REPLACE_TEXT, { find: 'fox', replace: 'cat' }, 'b'),
      replyTurn('done'),
    ])
    editor = makeReviewEditor(provider, '<p>the quick fox</p>')

    editor.commands.aiAgentSend('two edits')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    const changes = stagedChanges(editor)
    expect(changes).toHaveLength(2)
    expect(changes.map(c => c.newText).sort()).toEqual(['cat', 'slow'])
    expect(editor.getText()).toBe('the quick fox')
    expect(agentStorage(editor).lastStagedCount).toBe(2)
  })

  it('applies edits immediately in direct mode', async () => {
    const provider = new FakeChatProvider([
      toolTurn(REPLACE_TEXT, { find: 'cat', replace: 'dog' }),
      replyTurn('done'),
    ])
    editor = makeAgentOnlyEditor(provider, '<p>the cat</p>', { applyMode: 'direct' })

    editor.commands.aiAgentSend('fix')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    expect(editor.getText()).toBe('the dog')
    expect(agentStorage(editor).lastStagedCount).toBe(0)
  })

  it('errors when the loop exceeds maxTurns', async () => {
    const provider = new FakeChatProvider([
      toolTurn(READ_DOCUMENT, {}),
      toolTurn(READ_DOCUMENT, {}),
    ])
    editor = makeAgentOnlyEditor(provider, '<p>the cat</p>', { applyMode: 'direct', maxTurns: 2 })

    editor.commands.aiAgentSend('loop forever')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('error'))
    expect(agentStorage(editor).error?.message).toContain('maxTurns')
  })

  it('aborts mid-loop, returning to idle and keeping the completed transcript', async () => {
    const provider = new FakeChatProvider([toolTurn(REPLACE_TEXT, { find: 'cat', replace: 'dog' })], {
      gated: true,
    })
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    expect(editor.commands.aiAgentSend('fix')).toBe(true)
    expect(agentStorage(editor).state).toBe('working')

    editor.commands.aiAgentAbort()
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    // The user turn stays; no assistant reply was produced; nothing staged.
    expect(agentStorage(editor).transcript).toEqual([{ role: 'user', content: 'fix' }])
    expect(stagedChanges(editor)).toHaveLength(0)
  })

  it('sets the error state when the provider throws', async () => {
    const provider = new FakeChatProvider([], { error: new Error('boom') })
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('fix')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('error'))
    expect(agentStorage(editor).error?.message).toBe('boom')
  })

  it('is single-flight: a second send is rejected while one is in progress', async () => {
    const provider = new FakeChatProvider([replyTurn('done')], { gated: true })
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    expect(editor.commands.aiAgentSend('first')).toBe(true)
    expect(agentStorage(editor).state).toBe('working')
    expect(editor.commands.aiAgentSend('second')).toBe(false)

    provider.open()
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))
    expect(provider.calls).toHaveLength(1)
  })

  it('review mode requires the AiChanges extension', async () => {
    const provider = new FakeChatProvider([replyTurn('done')])
    editor = makeAgentOnlyEditor(provider, '<p>the cat</p>')

    expect(editor.commands.aiAgentSend('fix')).toBe(false)
    expect(agentStorage(editor).state).toBe('error')
    expect(agentStorage(editor).error?.message).toContain('AiChanges')
    // The failed send did not record a turn.
    expect(agentStorage(editor).transcript).toHaveLength(0)
  })

  it('records user and assistant turns in the transcript', async () => {
    const provider = new FakeChatProvider([replyTurn('Here is my answer.')])
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('hello')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    expect(agentStorage(editor).transcript).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Here is my answer.' },
    ])
  })

  it('reset clears the transcript and state', async () => {
    const provider = new FakeChatProvider([replyTurn('done')])
    editor = makeReviewEditor(provider, '<p>the cat</p>')

    editor.commands.aiAgentSend('hello')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))
    expect(agentStorage(editor).transcript.length).toBeGreaterThan(0)

    expect(editor.commands.aiAgentReset()).toBe(true)
    expect(agentStorage(editor).transcript).toHaveLength(0)
    expect(agentStorage(editor).state).toBe('idle')
    expect(agentStorage(editor).lastStagedCount).toBe(0)
  })
})
