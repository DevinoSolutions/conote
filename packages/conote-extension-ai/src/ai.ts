import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import type { CompletionProvider, CompletionRequest } from '@conote/ai-core'

import { aiPluginKey, createAiPlugin } from './plugin.js'
import {
  buildMessages,
  customInstruction,
  DEFAULT_SYSTEM_PROMPT,
  INSTRUCTIONS,
  toneInstruction,
  translateInstruction,
} from './prompts.js'
import type { AiCommandOptions, AiInsertMode, AiOptions, AiStorage } from './types.js'

/** How much text before the insertion point is used as context for `aiComplete`. */
const MAX_CONTEXT_CHARS = 2000

/** Meta key marking transactions produced by this extension. */
const AI_META = 'conoteAi'

/** Context handed to a command's prompt builder. */
interface BuilderContext {
  hasSelection: boolean
  selectionText: string
  docText: string
  before: string
}

/** What a prompt builder produces, or `null` to reject the command. */
interface Generation {
  instruction: string
  input: string
  mode: AiInsertMode
}

type Builder = (context: BuilderContext) => Generation | null

/**
 * CoNote AI Generation extension for Tiptap.
 *
 * Adds streaming AI editing commands (`ai` namespace) that write tokens into the
 * document through ProseMirror transactions and expose their lifecycle via
 * `editor.storage.ai` for UI binding.
 *
 * @example
 * ```typescript
 * import { Editor } from '@tiptap/core'
 * import StarterKit from '@tiptap/starter-kit'
 * import { OpenRouterProvider } from '@conote/ai-core'
 * import { Ai } from '@conote/extension-ai'
 *
 * const editor = new Editor({
 *   extensions: [
 *     StarterKit,
 *     Ai.configure({ provider: new OpenRouterProvider({ baseUrl: '/api/ai' }) }),
 *   ],
 * })
 *
 * editor.commands.aiComplete()
 * ```
 */
export const Ai = Extension.create<AiOptions>({
  name: 'ai',

  addOptions() {
    return {
      provider: undefined as unknown as CompletionProvider,
      defaultModel: undefined,
      temperature: undefined,
      systemPrompt: undefined,
      context: undefined,
    }
  },

  addStorage(): AiStorage {
    return {
      state: 'idle',
      error: null,
      abortController: null,
    }
  },

  addProseMirrorPlugins() {
    return [createAiPlugin()]
  },

  addCommands() {
    const complete: Builder = ({ before }) => ({
      instruction: INSTRUCTIONS.complete,
      input: before,
      mode: 'cursor',
    })

    const rewrite: Builder = ({ hasSelection, selectionText }) => {
      if (!hasSelection) {
        return null
      }
      return { instruction: INSTRUCTIONS.rewrite, input: selectionText, mode: 'replaceSelection' }
    }

    const summarize: Builder = ({ hasSelection, selectionText, docText }) => ({
      instruction: INSTRUCTIONS.summarize,
      input: hasSelection ? selectionText : docText,
      mode: hasSelection ? 'replaceSelection' : 'cursor',
    })

    return {
      aiComplete: (options?: AiCommandOptions) => (props: CommandProps) =>
        run(this, props, options, complete),

      aiRewrite: (options?: AiCommandOptions) => (props: CommandProps) =>
        run(this, props, options, rewrite),

      aiSummarize: (options?: AiCommandOptions) => (props: CommandProps) =>
        run(this, props, options, summarize),

      aiAdjustTone: (tone: string, options?: AiCommandOptions) => (props: CommandProps) =>
        run(this, props, options, ({ hasSelection, selectionText }) => {
          if (!hasSelection) {
            return null
          }
          return {
            instruction: toneInstruction(tone),
            input: selectionText,
            mode: 'replaceSelection',
          }
        }),

      aiTranslate: (language: string, options?: AiCommandOptions) => (props: CommandProps) =>
        run(this, props, options, ({ hasSelection, selectionText }) => {
          if (!hasSelection) {
            return null
          }
          return {
            instruction: translateInstruction(language),
            input: selectionText,
            mode: 'replaceSelection',
          }
        }),

      aiCustomPrompt: (prompt: string, options?: AiCommandOptions) => (props: CommandProps) =>
        run(this, props, options, ({ hasSelection, selectionText, before }) => ({
          instruction: customInstruction(prompt),
          input: hasSelection ? selectionText : before,
          mode: hasSelection ? 'replaceSelection' : 'cursor',
        })),

      aiAbort:
        () =>
        ({ editor }: CommandProps) => {
          const storage = editor.storage.ai as AiStorage
          const controller = storage.abortController
          if (!controller) {
            return false
          }
          controller.abort()
          return true
        },
    }
  },
})

/**
 * Shared execution path for every generation command. Validates, sets up the
 * insertion anchor and request, then streams tokens asynchronously. Returns
 * synchronously: `true` once a request is started (or would start), `false` when
 * the command cannot run.
 */
function run(
  extension: { options: AiOptions },
  props: CommandProps,
  options: AiCommandOptions | undefined,
  build: Builder,
): boolean {
  const { editor, state, tr, dispatch } = props
  const storage = editor.storage.ai as AiStorage

  // One request at a time: reject while pending or streaming.
  if (storage.state === 'pending' || storage.state === 'streaming') {
    return false
  }

  const { from, to } = state.selection
  const hasSelection = to > from
  const selectionText = hasSelection ? state.doc.textBetween(from, to, '\n', ' ') : ''
  const before = state.doc.textBetween(Math.max(0, to - MAX_CONTEXT_CHARS), to, '\n', ' ')
  const docText = state.doc.textBetween(0, state.doc.content.size, '\n', ' ')

  const generation = build({ hasSelection, selectionText, docText, before })
  if (!generation) {
    return false
  }

  // Dry run (e.g. `can()` chains): report runnable without side effects.
  if (!dispatch) {
    return true
  }

  const opts = extension.options
  const mode: AiInsertMode = options?.insert ?? generation.mode
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  const contextText = opts.context?.()
  const messages = buildMessages({
    system,
    instruction: generation.instruction,
    context: contextText,
    input: generation.input,
  })

  // Set the insertion anchor: for replace-selection, delete first and insert at
  // the selection start; otherwise insert at the selection end / cursor.
  let insertPos: number
  if (mode === 'replaceSelection' && hasSelection) {
    tr.delete(from, to)
    insertPos = from
  } else {
    insertPos = to
  }
  tr.setMeta(aiPluginKey, { type: 'init', pos: insertPos })
  tr.setMeta(AI_META, true)

  const controller = new AbortController()
  storage.error = null
  storage.abortController = controller
  storage.state = 'pending'

  const request: CompletionRequest = {
    messages,
    model: options?.model ?? opts.defaultModel,
    temperature: options?.temperature ?? opts.temperature,
    signal: controller.signal,
  }

  // Fire-and-forget: the initial `tr` above is dispatched by Tiptap after this
  // returns, so the streaming loop reads the updated state on its first tick.
  void streamInto(editor, opts.provider, request, controller, storage)

  return true
}

async function streamInto(
  editor: CommandProps['editor'],
  provider: CompletionProvider,
  request: CompletionRequest,
  controller: AbortController,
  storage: AiStorage,
): Promise<void> {
  let started = false
  try {
    for await (const chunk of provider.stream(request)) {
      if (controller.signal.aborted || editor.isDestroyed) {
        break
      }
      if (!chunk) {
        continue
      }
      const pos = aiPluginKey.getState(editor.state)?.pos
      if (pos == null) {
        break
      }
      if (!started) {
        storage.state = 'streaming'
        started = true
      }
      const insertTr = editor.state.tr.insertText(chunk, pos)
      insertTr.setMeta(AI_META, true)
      editor.view.dispatch(insertTr)
    }
    finish(editor, storage, 'idle')
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      finish(editor, storage, 'idle')
    } else {
      storage.error = error instanceof Error ? error : new Error(String(error))
      finish(editor, storage, 'error')
    }
  }
}

function finish(
  editor: CommandProps['editor'],
  storage: AiStorage,
  state: AiStorage['state'],
): void {
  storage.state = state
  storage.abortController = null
  if (editor.isDestroyed) {
    return
  }
  const tr = editor.state.tr.setMeta(aiPluginKey, { type: 'clear' })
  tr.setMeta(AI_META, true)
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
