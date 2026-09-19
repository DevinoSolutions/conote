# @conote/extension-ai-changes

Reviewable AI tracked changes for [Tiptap](https://tiptap.dev). Ask an LLM to rewrite the selection
(or the whole document), then review the result as tracked changes — deletions struck through,
insertions highlighted — accepting or rejecting each word-level hunk individually or in bulk. **The
document is never modified until you accept a change.** Changes live in a ProseMirror plugin and are
mirrored into extension storage so you can bind UI to them.

Part of **CoNote**, an open-source fork of Tiptap maintained by Devino. CoNote is **not affiliated
with or endorsed by Tiptap GmbH**. This extension is an independent implementation written from
scratch; it contains no code from Tiptap's proprietary AI products. MIT licensed.

## Install

```bash
pnpm add @conote/extension-ai-changes @conote/ai-core
```

## Usage

Provide any `CompletionProvider` from `@conote/ai-core`. In production, point the provider at a proxy
so the API key stays server-side.

```ts
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { OpenRouterProvider } from '@conote/ai-core'
import { AiChanges } from '@conote/extension-ai-changes'

const editor = new Editor({
  extensions: [
    StarterKit,
    AiChanges.configure({
      provider: new OpenRouterProvider({ baseUrl: '/api/ai' }),
      defaultModel: 'anthropic/claude-haiku-4.5',
    }),
  ],
})

// Rewrite the current selection, or the whole document when nothing is selected.
editor.commands.aiChangesPropose({ prompt: 'Make this more concise and formal.' })
```

Once a proposal resolves, read `editor.storage.aiChanges.changes` to render review UI, and call the
accept/reject commands as the user decides.

## Options

| Option         | Type                 | Description                                                     |
| -------------- | -------------------- | --------------------------------------------------------------- |
| `provider`     | `CompletionProvider` | **Required.** Performs completions.                             |
| `defaultModel` | `string`             | Model used when a proposal does not override it.                |
| `temperature`  | `number`             | Sampling temperature used when a proposal does not override it. |

## Commands

All commands live in the `aiChanges` namespace.

| Command                                              | Behavior                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiChangesPropose({ prompt, model?, temperature? })` | Send the selection (or whole doc) to the provider and stage the diff. Single-flight: returns `false` while a proposal is in progress.                             |
| `aiChangesAccept(id)`                                | Replace the change's range with its `newText`, drop it, and remap the rest.                                                                                       |
| `aiChangesReject(id)`                                | Drop one change without changing the document.                                                                                                                    |
| `aiChangesAcceptAll()`                               | Accept every change in one transaction (equivalent to the full rewrite).                                                                                          |
| `aiChangesRejectAll()`                               | Drop every change without changing the document.                                                                                                                  |
| `aiChangesSelect(id \| null)`                        | Mark a change selected, or clear the selection.                                                                                                                   |
| `aiChangesSet(changes)`                              | Stage changes programmatically. Each is `Omit<AiChange, 'id'>`; entries with an out-of-bounds range or an `oldText` that does not match the document are dropped. |

## Data model

```ts
interface AiChange {
  id: string
  range: { from: number; to: number } // ProseMirror range of the old text (from === to for a pure insertion)
  oldText: string // '' for a pure insertion
  newText: string // '' for a pure deletion
}
```

## State binding

The extension exposes its state through `editor.storage.aiChanges`:

```ts
interface AiChangesStorage {
  state: 'idle' | 'loading' | 'error'
  error: Error | null
  changes: AiChange[] // mirror of plugin state, in document order
  selectedId: string | null
}
```

The authoritative source is the ProseMirror plugin; storage is refreshed after each view update.

## Styling

Preview decorations are unstyled by default — style these hooks yourself. No CSS is bundled.

| Hook                                                                  | Applied to                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `.conote-ai-change-del`                                               | The deletion (old text) part of a change.                        |
| `.conote-ai-change-ins`                                               | The insertion (new text) part of a change, rendered as a widget. |
| `.conote-ai-change-del--selected` / `.conote-ai-change-ins--selected` | The parts of the selected change.                                |
| `[data-change-id="<id>"]`                                             | Both parts of a specific change.                                 |

```css
.conote-ai-change-del {
  text-decoration: line-through;
  background: color-mix(in srgb, #e11d48 12%, transparent);
}
.conote-ai-change-ins {
  background: color-mix(in srgb, #16a34a 16%, transparent);
}
.conote-ai-change-del--selected,
.conote-ai-change-ins--selected {
  outline: 1px solid currentColor;
}
```

## How it works

The selection (or whole document) is projected to plain text — text blocks joined with `\n`
separators — and sent to the provider with your instruction. The system prompt asks for only the
revised text; surrounding markdown fences are stripped defensively. The old and new texts are diffed
at the word level (tokenize into words with trailing whitespace, LCS over tokens, merge adjacent
delete/insert runs into hunks). Each hunk is anchored back to a ProseMirror range via the plain-text
projection; hunks that would span a block boundary are dropped, and every hunk is validated
(`textBetween` must equal `oldText`) before it is staged. Staged ranges are then mapped through every
transaction: a change is invalidated if the text under it stops matching `oldText` (e.g. you edit
inside it) and shifted when you edit before it. Pure insertions are kept as long as the mapping does
not delete their position.

## Behavior notes

- **Non-destructive preview.** The document is untouched until a change is accepted.
- **Manual.** There is no auto-proposal; call `aiChangesPropose()` explicitly.
- **Single-flight.** Starting a proposal while one is in progress returns `false`.
- **Errors.** A provider failure sets `state` to `'error'` and stores the error.
- **Programmatic entry point.** `aiChangesSet` lets other code route edits through the same review UI.

## License

MIT. See the repository root for details.
