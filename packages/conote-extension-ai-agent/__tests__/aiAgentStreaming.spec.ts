import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiChanges, aiChangesPluginKey } from '../../conote-extension-ai-changes/src/index.js'
import { AiAgent } from '../src/index.js'
import type { AiAgentOptions } from '../src/index.js'
import { FakeStreamingChatProvider, streamReplyTurn, streamToolTurn } from './fakeProvider.js'

let editor: Editor

afterEach(() => {
  editor?.destroy()
})

function makeReviewEditor(
  provider: FakeStreamingChatProvider,
  content: string,
  extra: Partial<Omit<AiAgentOptions, 'provider'>> = {},
): Editor {
  return new Editor({
    // The provider is a StreamingChatCompletionProvider, structurally a ChatCompletionProvider.
    extensions: [
      Document,
      Paragraph,
      Text,
      AiChanges,
      AiAgent.configure({ provider: provider as never, ...extra }),
    ],
    content,
  })
}

function agentStorage(target: Editor) {
  return target.storage.aiAgent
}

function stagedChanges(target: Editor) {
  return aiChangesPluginKey.getState(target.state)?.changes ?? []
}

describe('AiAgent streaming', () => {
  it('mirrors in-flight assistant text into streamingText, then clears it into the transcript', async () => {
    const provider = new FakeStreamingChatProvider([streamReplyTurn('Hello', ', ', 'world')], {
      gated: true,
    })
    editor = makeReviewEditor(provider, '<p>hi</p>')

    editor.commands.aiAgentSend('greet')

    // Mid-stream: the deltas have accumulated but the turn has not completed.
    await vi.waitFor(() => expect(agentStorage(editor).streamingText).toBe('Hello, world'))
    expect(agentStorage(editor).state).toBe('working')
    // Not yet in the transcript.
    expect(agentStorage(editor).transcript).toEqual([{ role: 'user', content: 'greet' }])

    provider.open()
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    // Completed: streamingText cleared, content landed in the transcript.
    expect(agentStorage(editor).streamingText).toBe('')
    expect(agentStorage(editor).transcript).toEqual([
      { role: 'user', content: 'greet' },
      { role: 'assistant', content: 'Hello, world' },
    ])
  })

  it('still stages tool-call edits via aiChangesSet on the streaming path', async () => {
    const provider = new FakeStreamingChatProvider([
      streamToolTurn('replace_text', { find: 'cat', replace: 'dog' }, ['Fixing… ']),
      streamReplyTurn('Changed cat to dog.'),
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
    expect(agentStorage(editor).lastStagedCount).toBe(1)
    // The tool turn's lead-in text did not leak into the transcript or streaming buffer.
    expect(agentStorage(editor).streamingText).toBe('')
    expect(agentStorage(editor).transcript).toEqual([
      { role: 'user', content: 'fix' },
      { role: 'assistant', content: 'Changed cat to dog.' },
    ])
  })

  it('discards partial streamed text on abort and returns to idle', async () => {
    const provider = new FakeStreamingChatProvider([streamReplyTurn('partial reply')], {
      gated: true,
    })
    editor = makeReviewEditor(provider, '<p>hi</p>')

    expect(editor.commands.aiAgentSend('go')).toBe(true)
    await vi.waitFor(() => expect(agentStorage(editor).streamingText).toBe('partial reply'))

    editor.commands.aiAgentAbort()
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    // Partial text discarded; only the user turn remains.
    expect(agentStorage(editor).streamingText).toBe('')
    expect(agentStorage(editor).transcript).toEqual([{ role: 'user', content: 'go' }])
    expect(stagedChanges(editor)).toHaveLength(0)
  })

  it('sets the error state and clears partial streamingText when the stream fails', async () => {
    const provider = new FakeStreamingChatProvider([streamReplyTurn('oops')], {
      error: new Error('stream boom'),
    })
    editor = makeReviewEditor(provider, '<p>hi</p>')

    editor.commands.aiAgentSend('go')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('error'))

    expect(agentStorage(editor).error?.message).toBe('stream boom')
    expect(agentStorage(editor).streamingText).toBe('')
    // The failed run kept only the user turn.
    expect(agentStorage(editor).transcript).toEqual([{ role: 'user', content: 'go' }])
  })

  it('falls back to chatComplete and leaves streamingText empty for a non-streaming provider', async () => {
    // A provider WITHOUT chatStream — the loop must use the unchanged chatComplete path.
    const provider = {
      calls: [] as unknown[],
      async chatComplete(request: { messages: unknown[] }) {
        this.calls.push(request)
        return { content: 'plain answer', toolCalls: [], finishReason: 'stop' }
      },
      async complete() {
        return ''
      },
      async *stream() {},
    }
    editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        AiChanges,
        AiAgent.configure({ provider: provider as never }),
      ],
      content: '<p>hi</p>',
    })

    editor.commands.aiAgentSend('hello')
    await vi.waitFor(() => expect(agentStorage(editor).state).toBe('idle'))

    expect(agentStorage(editor).streamingText).toBe('')
    expect(agentStorage(editor).transcript).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'plain answer' },
    ])
    expect(provider.calls).toHaveLength(1)
  })
})
