import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { CompletionProvider, CompletionRequest } from '@conote/ai-core'

import { normalizeReplacement } from './apply.js'
import { diffWords, isWhitespaceOnlyEdit } from './diff.js'
import { anchorHunk, buildDocTextIndex } from './locate.js'
import { aiChangesPluginKey, createAiChangesPlugin } from './plugin.js'
import { buildChangeMessages, stripFences } from './prompts.js'
import type {
  AiChange,
  AiChangesOptions,
  AiChangesProposeOptions,
  AiChangesStorage,
} from './types.js'

let idCounter = 0

/** Generates a change id, preferring `crypto.randomUUID` when available. */
function nextId(): string {
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  idCounter += 1
  return `conote-ai-change-${idCounter}`
}

/** Validates a candidate change against the current document. */
function isValidChange(doc: ProseMirrorNode, from: number, to: number, oldText: string): boolean {
  if (!(from >= 0 && from <= to && to <= doc.content.size)) {
    return false
  }
  return doc.textBetween(from, to, '\n') === oldText
}

/**
 * CoNote AI Changes extension for Tiptap.
 *
 * Proposes an LLM rewrite of the selection (or the whole document) and presents
 * the word-level diff as reviewable tracked changes — deletions struck through,
 * insertions highlighted — each acceptable or rejectable individually or in bulk.
 * The document is not modified until a change is accepted. Changes live in a
 * ProseMirror plugin and are mirrored into `editor.storage.aiChanges` for UI binding.
 *
 * @example
 * ```typescript
 * import { Editor } from '@tiptap/core'
 * import StarterKit from '@tiptap/starter-kit'
 * import { OpenRouterProvider } from '@conote/ai-core'
 * import { AiChanges } from '@conote/extension-ai-changes'
 *
 * const editor = new Editor({
 *   extensions: [
 *     StarterKit,
 *     AiChanges.configure({ provider: new OpenRouterProvider({ baseUrl: '/api/ai' }) }),
 *   ],
 * })
 *
 * editor.commands.aiChangesPropose({ prompt: 'Make it more formal.' })
 * ```
 */
export const AiChanges = Extension.create<AiChangesOptions>({
  name: 'aiChanges',

  addOptions() {
    return {
      provider: undefined as unknown as CompletionProvider,
      defaultModel: undefined,
      temperature: undefined,
    }
  },

  addStorage(): AiChangesStorage {
    return {
      state: 'idle',
      error: null,
      changes: [],
      selectedId: null,
    }
  },

  addProseMirrorPlugins() {
    return [
      createAiChangesPlugin({
        storage: this.storage as AiChangesStorage,
      }),
    ]
  },

  addCommands() {
    return {
      aiChangesPropose:
        (options: AiChangesProposeOptions) =>
        ({ editor, state }: CommandProps) => {
          const storage = editor.storage.aiChanges as AiChangesStorage
          if (storage.state === 'loading') {
            return false
          }
          const opts = this.options
          const selection = state.selection.empty
            ? null
            : { from: state.selection.from, to: state.selection.to }
          const oldText = buildDocTextIndex(state.doc, selection?.from, selection?.to).text
          const request: CompletionRequest = {
            messages: buildChangeMessages(oldText, options.prompt),
            model: options.model ?? opts.defaultModel,
            temperature: options.temperature ?? opts.temperature,
          }
          storage.state = 'loading'
          storage.error = null
          void proposeChanges(editor, opts, request, selection)
          return true
        },

      aiChangesAccept:
        (id: string) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiChangesPluginKey.getState(state)
          const change = pluginState?.changes.find(item => item.id === id)
          if (!change) {
            return false
          }
          if (!dispatch) {
            return true
          }
          const applied = normalizeReplacement(
            state.doc,
            change.range.from,
            change.range.to,
            change.newText,
          )
          tr.insertText(applied.text, applied.from, applied.to)
          tr.setMeta(aiChangesPluginKey, { type: 'remove', id })
          return true
        },

      aiChangesReject:
        (id: string) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiChangesPluginKey.getState(state)
          if (!pluginState?.changes.some(item => item.id === id)) {
            return false
          }
          if (!dispatch) {
            return true
          }
          tr.setMeta(aiChangesPluginKey, { type: 'remove', id })
          tr.setMeta('addToHistory', false)
          return true
        },

      aiChangesAcceptAll:
        () =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiChangesPluginKey.getState(state)
          if (!pluginState || pluginState.changes.length === 0) {
            return false
          }
          if (!dispatch) {
            return true
          }
          // Apply right-to-left so earlier positions stay valid as we edit.
          const ordered = [...pluginState.changes].sort((a, b) => b.range.from - a.range.from)
          for (const change of ordered) {
            const applied = normalizeReplacement(
              state.doc,
              change.range.from,
              change.range.to,
              change.newText,
            )
            tr.insertText(applied.text, applied.from, applied.to)
          }
          tr.setMeta(aiChangesPluginKey, { type: 'clear' })
          return true
        },

      aiChangesRejectAll:
        () =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiChangesPluginKey.getState(state)
          if (!pluginState || pluginState.changes.length === 0) {
            return false
          }
          if (!dispatch) {
            return true
          }
          tr.setMeta(aiChangesPluginKey, { type: 'clear' })
          tr.setMeta('addToHistory', false)
          return true
        },

      aiChangesSelect:
        (id: string | null) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = aiChangesPluginKey.getState(state)
          if (id !== null && !pluginState?.changes.some(item => item.id === id)) {
            return false
          }
          if (!dispatch) {
            return true
          }
          tr.setMeta(aiChangesPluginKey, { type: 'select', id })
          tr.setMeta('addToHistory', false)
          return true
        },

      aiChangesSet:
        (changes: Array<Omit<AiChange, 'id'>>) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const valid: AiChange[] = []
          for (const change of changes) {
            if (isValidChange(state.doc, change.range.from, change.range.to, change.oldText)) {
              valid.push({ id: nextId(), ...change })
            }
          }
          if (!dispatch) {
            return true
          }
          tr.setMeta(aiChangesPluginKey, { type: 'set', changes: valid })
          tr.setMeta('addToHistory', false)
          return true
        },
    }
  },
})

/**
 * Performs the provider round trip, diffs old against the returned rewrite,
 * anchors each hunk to a validated ProseMirror range, and stages the result.
 * Runs outside the command so the command returns synchronously; on failure it
 * sets the error state.
 */
async function proposeChanges(
  editor: CommandProps['editor'],
  opts: AiChangesOptions,
  request: CompletionRequest,
  selection: { from: number; to: number } | null,
): Promise<void> {
  const storage = editor.storage.aiChanges as AiChangesStorage
  try {
    const raw = await opts.provider.complete(request)
    if (editor.isDestroyed) {
      return
    }
    const newText = stripFences(raw)
    const doc = editor.state.doc
    const size = doc.content.size
    const from = selection ? Math.max(0, Math.min(selection.from, size)) : 0
    const to = selection ? Math.max(from, Math.min(selection.to, size)) : size
    const index = buildDocTextIndex(doc, from, to)

    const changes: AiChange[] = []
    for (const hunk of diffWords(index.text, newText)) {
      const oldText = index.text.slice(hunk.oldStart, hunk.oldEnd)
      // Drop hunks that only reflow whitespace: they render as a struck-through
      // word replaced by the identical word — pure noise for the reviewer.
      if (isWhitespaceOnlyEdit(oldText, hunk.newText)) {
        continue
      }
      const range = anchorHunk(index, hunk)
      if (!range) {
        continue
      }
      if (!isValidChange(doc, range.from, range.to, oldText)) {
        continue
      }
      changes.push({ id: nextId(), range, oldText, newText: hunk.newText })
    }

    const tr = editor.state.tr.setMeta(aiChangesPluginKey, { type: 'set', changes })
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
