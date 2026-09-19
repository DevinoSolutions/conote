import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import type { CompletionProvider, CompletionRequest } from '@conote/ai-core'

import { normalizeReplacement } from './apply.js'
import { buildDocTextIndex, docPlainText, locateSuggestion } from './locate.js'
import { aiSuggestionPluginKey, createAiSuggestionPlugin } from './plugin.js'
import { buildSuggestionMessages, parseSuggestionResponse } from './prompts.js'
import type { AiSuggestionLoadOptions, AiSuggestionOptions, AiSuggestionStorage } from './types.js'

/**
 * A single suggested edit located in the document.
 *
 * Declared here — rather than in `types.ts` — so it declaration-merges with the
 * `AiSuggestion` extension const below into one public `AiSuggestion` export.
 */
export interface AiSuggestion {
  /** Generated identifier, unique within a load. */
  id: string
  /** The rule that produced this suggestion. */
  ruleId: string
  /** ProseMirror positions of the text to replace, remapped on every edit. */
  range: { from: number; to: number }
  /** Exact document text the suggestion replaces; used to validate the range after edits. */
  deleteText: string
  /** Text that replaces `deleteText` when the suggestion is applied. */
  replacementText: string
  /** Optional short explanation from the model. */
  note?: string
}

let idCounter = 0

/** Generates a suggestion id, preferring `crypto.randomUUID` when available. */
function nextId(): string {
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  idCounter += 1
  return `conote-ai-suggestion-${idCounter}`
}

/**
 * CoNote AI Suggestion extension for Tiptap.
 *
 * Runs rule-based proofreading over the document and renders each suggestion as
 * an inline decoration that can be accepted or rejected individually or in bulk.
 * Suggestions and the current selection live in a ProseMirror plugin and are
 * mirrored into `editor.storage.aiSuggestion` for UI binding.
 *
 * @example
 * ```typescript
 * import { Editor } from '@tiptap/core'
 * import StarterKit from '@tiptap/starter-kit'
 * import { OpenRouterProvider } from '@conote/ai-core'
 * import { AiSuggestion } from '@conote/extension-ai-suggestion'
 *
 * const editor = new Editor({
 *   extensions: [
 *     StarterKit,
 *     AiSuggestion.configure({
 *       provider: new OpenRouterProvider({ baseUrl: '/api/ai' }),
 *       rules: [{ id: 'spelling', title: 'Spelling & grammar', prompt: 'Fix spelling and grammar mistakes.' }],
 *     }),
 *   ],
 * })
 *
 * editor.commands.aiSuggestionLoad()
 * ```
 */
export const AiSuggestion = Extension.create<AiSuggestionOptions>({
  name: 'aiSuggestion',

  addOptions() {
    return {
      provider: undefined as unknown as CompletionProvider,
      rules: [],
      defaultModel: undefined,
      temperature: undefined,
    }
  },

  addStorage(): AiSuggestionStorage {
    return {
      state: 'idle',
      error: null,
      suggestions: [],
      selectedId: null,
      droppedCount: 0,
    }
  },

  addProseMirrorPlugins() {
    return [
      createAiSuggestionPlugin({
        rules: this.options.rules,
        storage: this.storage as AiSuggestionStorage,
      }),
    ]
  },

  addCommands() {
    return {
      aiSuggestionLoad:
        (options?: AiSuggestionLoadOptions) =>
        ({ editor, state }: CommandProps) => {
          const storage = editor.storage.aiSuggestion as AiSuggestionStorage
          if (storage.state === 'loading') {
            return false
          }
          const opts = this.options
          const messages = buildSuggestionMessages(docPlainText(state.doc), opts.rules)
          const request: CompletionRequest = {
            messages,
            model: options?.model ?? opts.defaultModel,
            temperature: options?.temperature ?? opts.temperature,
          }
          storage.state = 'loading'
          storage.error = null
          void loadSuggestions(editor, opts, request)
          return true
        },

      aiSuggestionApply:
        (id: string) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiSuggestionPluginKey.getState(state)
          const suggestion = pluginState?.suggestions.find(item => item.id === id)
          if (!suggestion) {
            return false
          }
          if (!dispatch) {
            return true
          }
          const applied = normalizeReplacement(
            state.doc,
            suggestion.range.from,
            suggestion.range.to,
            suggestion.replacementText,
          )
          tr.insertText(applied.text, applied.from, applied.to)
          tr.setMeta(aiSuggestionPluginKey, { type: 'remove', id })
          return true
        },

      aiSuggestionReject:
        (id: string) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiSuggestionPluginKey.getState(state)
          if (!pluginState?.suggestions.some(item => item.id === id)) {
            return false
          }
          if (!dispatch) {
            return true
          }
          tr.setMeta(aiSuggestionPluginKey, { type: 'remove', id })
          tr.setMeta('addToHistory', false)
          return true
        },

      aiSuggestionApplyAll:
        () =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiSuggestionPluginKey.getState(state)
          if (!pluginState || pluginState.suggestions.length === 0) {
            return false
          }
          if (!dispatch) {
            return true
          }
          // Apply right-to-left so earlier positions stay valid as we edit.
          const ordered = [...pluginState.suggestions].sort((a, b) => b.range.from - a.range.from)
          for (const suggestion of ordered) {
            const applied = normalizeReplacement(
              state.doc,
              suggestion.range.from,
              suggestion.range.to,
              suggestion.replacementText,
            )
            tr.insertText(applied.text, applied.from, applied.to)
          }
          tr.setMeta(aiSuggestionPluginKey, { type: 'clear' })
          return true
        },

      aiSuggestionClear:
        () =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiSuggestionPluginKey.getState(state)
          if (!pluginState || pluginState.suggestions.length === 0) {
            return false
          }
          if (!dispatch) {
            return true
          }
          tr.setMeta(aiSuggestionPluginKey, { type: 'clear' })
          tr.setMeta('addToHistory', false)
          return true
        },

      aiSuggestionSelect:
        (id: string | null) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiSuggestionPluginKey.getState(state)
          if (id !== null && !pluginState?.suggestions.some(item => item.id === id)) {
            return false
          }
          if (!dispatch) {
            return true
          }
          tr.setMeta(aiSuggestionPluginKey, { type: 'select', id })
          tr.setMeta('addToHistory', false)
          return true
        },
    }
  },
})

/**
 * Performs the provider round trip, locates each suggestion in the current
 * document, and dispatches them into the plugin. Runs outside the command so the
 * command can return synchronously; on failure it sets the error state.
 */
async function loadSuggestions(
  editor: CommandProps['editor'],
  opts: AiSuggestionOptions,
  request: CompletionRequest,
): Promise<void> {
  const storage = editor.storage.aiSuggestion as AiSuggestionStorage
  try {
    const raw = await opts.provider.complete(request)
    const parsed = parseSuggestionResponse(raw)
    if (editor.isDestroyed) {
      return
    }
    const index = buildDocTextIndex(editor.state.doc)
    const validRuleIds = new Set(opts.rules.map(rule => rule.id))
    const suggestions: AiSuggestion[] = []
    let dropped = 0
    for (const item of parsed) {
      if (!validRuleIds.has(item.ruleId)) {
        dropped += 1
        continue
      }
      const range = locateSuggestion(index, item.deleteText, item.beforeText)
      if (!range) {
        dropped += 1
        continue
      }
      suggestions.push({
        id: nextId(),
        ruleId: item.ruleId,
        range,
        deleteText: item.deleteText,
        replacementText: item.replacementText,
        note: item.note,
      })
    }
    storage.droppedCount = dropped
    const tr = editor.state.tr.setMeta(aiSuggestionPluginKey, { type: 'set', suggestions })
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
    storage.state = 'idle'
  } catch (error) {
    if (editor.isDestroyed) {
      return
    }
    storage.error = error instanceof Error ? error : new Error(String(error))
    storage.state = 'error'
  }
}
