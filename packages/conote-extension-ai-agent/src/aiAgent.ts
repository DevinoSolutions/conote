import { Extension } from '@tiptap/core'
import type { CommandProps, Editor } from '@tiptap/core'
import type {
  AgentMessage,
  AssistantTurn,
  ChatCompletionProvider,
  ChatRequest,
  StreamingChatCompletionProvider,
} from '@conote/ai-core'

import { createEditSession } from './session.js'
import type { StagedChange } from './session.js'
import { AGENT_TOOLS, DEFAULT_SYSTEM_PROMPT } from './tools.js'
import type { AiAgentOptions, AiAgentStorage } from './types.js'

/** True for a signal-triggered abort, which must not be treated as an error. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : Boolean(error) && (error as { name?: string }).name === 'AbortError'
}

/** Reads the runtime-discovered `aiChangesSet` command, if the AiChanges extension is present. */
function getAiChangesSet(editor: Editor): ((changes: StagedChange[]) => boolean) | undefined {
  const command = (
    editor.commands as unknown as {
      aiChangesSet?: (changes: StagedChange[]) => boolean
    }
  ).aiChangesSet
  return typeof command === 'function' ? command : undefined
}

/**
 * CoNote AI Agent extension for Tiptap.
 *
 * A conversational agent that reads the document and edits it through tool calls.
 * In the default `'review'` apply mode its edits are staged as tracked changes via
 * the companion `@conote/extension-ai-changes` extension (discovered at runtime),
 * so the user accepts or rejects each before anything lands. In `'direct'` mode
 * edits are applied immediately.
 *
 * @example
 * ```typescript
 * import { Editor } from '@tiptap/core'
 * import StarterKit from '@tiptap/starter-kit'
 * import { OpenRouterProvider } from '@conote/ai-core'
 * import { AiChanges } from '@conote/extension-ai-changes'
 * import { AiAgent } from '@conote/extension-ai-agent'
 *
 * const editor = new Editor({
 *   extensions: [
 *     StarterKit,
 *     AiChanges,
 *     AiAgent.configure({ provider: new OpenRouterProvider({ baseUrl: '/api/ai' }) }),
 *   ],
 * })
 *
 * editor.commands.aiAgentSend('Make the intro more concise.')
 * ```
 */
export const AiAgent = Extension.create<AiAgentOptions>({
  name: 'aiAgent',

  addOptions() {
    return {
      provider: undefined as unknown as ChatCompletionProvider,
      defaultModel: undefined,
      temperature: undefined,
      systemPrompt: undefined,
      applyMode: 'review',
      maxTurns: 8,
    }
  },

  addStorage(): AiAgentStorage {
    return {
      state: 'idle',
      error: null,
      transcript: [],
      lastStagedCount: 0,
      streamingText: '',
    }
  },

  addCommands() {
    const extension = this
    let abortController: AbortController | null = null

    return {
      aiAgentSend:
        (message: string) =>
        ({ editor }: CommandProps) => {
          const storage = editor.storage.aiAgent as AiAgentStorage
          if (storage.state === 'working') {
            return false
          }
          const opts = extension.options
          const applyMode = opts.applyMode ?? 'review'
          if (applyMode !== 'direct' && !getAiChangesSet(editor)) {
            storage.state = 'error'
            storage.error = new Error(
              'aiAgentSend in review mode requires the AiChanges extension (its aiChangesSet command) on the editor.',
            )
            return false
          }

          storage.transcript = [...storage.transcript, { role: 'user', content: message }]
          storage.state = 'working'
          storage.error = null
          abortController = new AbortController()
          void runAgentLoop(editor, opts, abortController.signal)
          return true
        },

      aiAgentAbort: () => () => {
        abortController?.abort()
        return true
      },

      aiAgentReset:
        () =>
        ({ editor }: CommandProps) => {
          const storage = editor.storage.aiAgent as AiAgentStorage
          abortController?.abort()
          abortController = null
          storage.transcript = []
          storage.state = 'idle'
          storage.error = null
          storage.lastStagedCount = 0
          storage.streamingText = ''
          return true
        },
    }
  },
})

/**
 * Drives the agent loop outside the command so `aiAgentSend` returns synchronously.
 * Runs up to `maxTurns` chat turns: tool calls are executed and their results fed
 * back; a plain assistant reply ends the loop. In review mode the accumulated
 * edits are staged in a single `aiChangesSet` call on successful completion.
 */
async function runAgentLoop(
  editor: Editor,
  opts: AiAgentOptions,
  signal: AbortSignal,
): Promise<void> {
  const storage = editor.storage.aiAgent as AiAgentStorage
  const provider = opts.provider
  const applyMode = opts.applyMode ?? 'review'
  const maxTurns = opts.maxTurns ?? 8
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT

  const session = createEditSession(editor, applyMode)

  const messages: AgentMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const turn of storage.transcript) {
    messages.push({ role: turn.role, content: turn.content })
  }

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const result = await runTurn(storage, provider, {
        messages,
        tools: AGENT_TOOLS,
        model: opts.defaultModel,
        temperature: opts.temperature,
        signal,
      })
      if (editor.isDestroyed) {
        return
      }

      if (result.toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })
        for (const call of result.toolCalls) {
          const output = session.execute(call.name, call.arguments)
          messages.push({ role: 'tool', toolCallId: call.id, content: output })
        }
        continue
      }

      if (result.content === null) {
        storage.state = 'error'
        storage.error = new Error('The agent returned no content and no tool calls.')
        return
      }

      // Plain reply: finish the run.
      storage.transcript = [...storage.transcript, { role: 'assistant', content: result.content }]
      if (applyMode !== 'direct') {
        storage.lastStagedCount = stageChanges(editor, session.collect())
      }
      storage.state = 'idle'
      return
    }

    storage.state = 'error'
    storage.error = new Error(`The agent did not finish within maxTurns (${maxTurns}).`)
  } catch (error) {
    if (editor.isDestroyed) {
      return
    }
    // Discard any partial in-flight streamed text; it never reaches the transcript.
    storage.streamingText = ''
    if (isAbortError(error)) {
      // Abort: return to idle, keeping whatever the transcript already holds.
      storage.state = 'idle'
      return
    }
    storage.error = error instanceof Error ? error : new Error(String(error))
    storage.state = 'error'
  }
}

/** True when the provider can stream a chat turn (has a `chatStream` method). */
function isStreamingProvider(
  provider: ChatCompletionProvider,
): provider is StreamingChatCompletionProvider {
  return typeof (provider as Partial<StreamingChatCompletionProvider>).chatStream === 'function'
}

/**
 * Runs one chat turn. With a streaming provider it consumes `chatStream`, mirroring
 * in-flight assistant text into `storage.streamingText` as deltas arrive and
 * clearing it once the turn's `done` event lands; otherwise it falls back to the
 * non-streaming `chatComplete` path unchanged.
 */
async function runTurn(
  storage: AiAgentStorage,
  provider: ChatCompletionProvider,
  request: ChatRequest,
): Promise<AssistantTurn> {
  if (!isStreamingProvider(provider)) {
    return provider.chatComplete(request)
  }

  storage.streamingText = ''
  let turn: AssistantTurn | null = null
  for await (const event of provider.chatStream(request)) {
    if (event.type === 'text') {
      storage.streamingText += event.delta
    } else if (event.type === 'done') {
      turn = event.turn
    }
  }
  // The completed turn's content lands in the transcript by the caller; the live
  // buffer is done streaming.
  storage.streamingText = ''
  return turn ?? { content: null, toolCalls: [], finishReason: null }
}

/** Stages review-mode changes via the runtime-discovered `aiChangesSet`. Returns the count staged. */
function stageChanges(editor: Editor, changes: StagedChange[]): number {
  if (changes.length === 0) {
    return 0
  }
  const setChanges = getAiChangesSet(editor)
  if (!setChanges) {
    return 0
  }
  setChanges(changes)
  return changes.length
}
