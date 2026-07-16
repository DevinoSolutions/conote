# @conote/extension-ai

AI Generation extension for [Tiptap](https://tiptap.dev). It adds streaming AI editing commands
that write tokens directly into the document through ProseMirror transactions and expose their
lifecycle through extension storage so you can bind UI to it.

Part of **CoNote**, an open-source fork of Tiptap maintained by Devino. CoNote is **not affiliated
with or endorsed by Tiptap GmbH**. This extension is an independent implementation written from
scratch; it contains no code from Tiptap's proprietary AI products. MIT licensed.

## Install

```bash
pnpm add @conote/extension-ai @conote/ai-core
```

## Usage

Provide any `CompletionProvider` from `@conote/ai-core`. In production, point the provider at a proxy
so the API key stays server-side; use `apiKey` only for local development.

```ts
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { OpenRouterProvider } from '@conote/ai-core'
import { Ai } from '@conote/extension-ai'

const provider = new OpenRouterProvider({
  baseUrl: '/api/ai', // proxy that injects OPENROUTER_API_KEY server-side
  defaultModel: 'anthropic/claude-haiku-4.5',
})

const editor = new Editor({
  extensions: [
    StarterKit,
    Ai.configure({
      provider,
      defaultModel: 'anthropic/claude-haiku-4.5',
      temperature: 0.7,
      // systemPrompt: 'Custom base system prompt…',
      // context: () => `Title: ${docTitle}`,
    }),
  ],
})
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `provider` | `CompletionProvider` | **Required.** Performs completions. |
| `defaultModel` | `string` | Model used when a command does not override it. |
| `temperature` | `number` | Sampling temperature used when a command does not override it. |
| `systemPrompt` | `string` | Overrides the base system prompt shared by every command. |
| `context` | `() => string` | Supplies extra document context, added to the prompt as a system message. |

## Commands

All commands live in the `ai` namespace. Each accepts an optional
`{ model?, temperature?, insert? }` object where `insert` is `'cursor' | 'replaceSelection'` and
overrides the command's default insertion behavior. Commands return `true` immediately and stream
in the background.

| Command | Behavior |
| --- | --- |
| `aiComplete(options?)` | Continue writing from the cursor using up to ~2000 characters before it. Inserts at the cursor. |
| `aiRewrite(options?)` | Rewrite the current selection. Requires a non-empty selection (returns `false` otherwise); replaces it. |
| `aiSummarize(options?)` | Summarize the selection, or the whole document when the selection is empty. Replaces the selection / inserts at the cursor respectively. |
| `aiAdjustTone(tone, options?)` | Change the tone of the selection. Requires a non-empty selection; replaces it. |
| `aiTranslate(language, options?)` | Translate the selection into `language`. Requires a non-empty selection; replaces it. |
| `aiCustomPrompt(prompt, options?)` | Apply an arbitrary instruction to the selection (replace) or at the cursor when the selection is empty (insert). |
| `aiAbort()` | Abort the in-flight request. Returns `true` if something was aborted. |

```ts
editor.commands.aiComplete()
editor.commands.aiRewrite({ temperature: 0.4 })
editor.commands.aiAdjustTone('formal')
editor.commands.aiTranslate('French')
editor.commands.aiCustomPrompt('Turn this into a bulleted list')
editor.commands.aiAbort()
```

## State binding

The extension exposes its lifecycle through `editor.storage.ai`:

```ts
interface AiStorage {
  state: 'idle' | 'pending' | 'streaming' | 'error'
  error: Error | null
  abortController: AbortController | null
}
```

Read it after each transaction to drive UI:

```ts
editor.on('transaction', () => {
  const { state, error } = editor.storage.ai
  toolbar.setLoading(state === 'pending' || state === 'streaming')
  toolbar.setError(state === 'error' ? error?.message : null)
})
```

## Behavior notes

- **Concurrency:** only one request runs at a time. Starting a generation command while another is
  `pending` or `streaming` returns `false` (use `aiAbort()` first to interrupt).
- **Aborting:** aborts are user-initiated and are not errors — state returns to `idle` and any text
  streamed so far is kept.
- **Errors:** provider errors set `state` to `'error'` and store the error; the document is left at
  the last inserted token.
- **Undo:** streamed insertions are grouped by Tiptap's history plugin using its default time-based
  grouping, so a generation typically collapses into a single undo step; a long pause mid-generation
  may split it into an additional step.
- **Plain text:** Phase 1 reads and inserts plain text only.

## License

MIT. See the repository root for details.
