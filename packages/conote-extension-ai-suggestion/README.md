# @conote/extension-ai-suggestion

Rule-based AI proofreading for [Tiptap](https://tiptap.dev). It sends the document to a completion
provider with a set of rules, locates each proposed edit back in the document, and renders it as an
inline decoration you can accept or reject — individually or in bulk. Suggestions live in a
ProseMirror plugin and are mirrored into extension storage so you can bind UI to them.

Part of **CoNote**, an open-source fork of Tiptap maintained by Devino. CoNote is **not affiliated
with or endorsed by Tiptap GmbH**. This extension is an independent implementation written from
scratch; it contains no code from Tiptap's proprietary AI products. MIT licensed.

## Install

```bash
pnpm add @conote/extension-ai-suggestion @conote/ai-core
```

## Usage

Provide any `CompletionProvider` from `@conote/ai-core` and a list of rules. In production, point the
provider at a proxy so the API key stays server-side.

```ts
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { OpenRouterProvider } from '@conote/ai-core'
import { AiSuggestion } from '@conote/extension-ai-suggestion'

const editor = new Editor({
  extensions: [
    StarterKit,
    AiSuggestion.configure({
      provider: new OpenRouterProvider({ baseUrl: '/api/ai' }),
      defaultModel: 'anthropic/claude-haiku-4.5',
      rules: [
        {
          id: 'spelling',
          title: 'Spelling & grammar',
          prompt: 'Fix spelling and grammar mistakes.',
          color: '#e11d48',
        },
        {
          id: 'concise',
          title: 'Conciseness',
          prompt: 'Make wordy sentences more concise.',
          color: '#2563eb',
        },
      ],
    }),
  ],
})

editor.commands.aiSuggestionLoad()
```

## Options

| Option         | Type                 | Description                                                                                    |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `provider`     | `CompletionProvider` | **Required.** Performs completions.                                                            |
| `rules`        | `AiSuggestionRule[]` | **Required.** Rules the model applies. A suggestion referencing an unknown rule id is dropped. |
| `defaultModel` | `string`             | Model used when a load does not override it.                                                   |
| `temperature`  | `number`             | Sampling temperature used when a load does not override it.                                    |

Each `AiSuggestionRule` is `{ id, title, prompt, color? }`.

## Commands

All commands live in the `aiSuggestion` namespace.

| Command                          | Behavior                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `aiSuggestionLoad(options?)`     | Fetch suggestions from the provider. Single-flight: returns `false` while a load is in progress. `options` is `{ model?, temperature? }`. |
| `aiSuggestionApply(id)`          | Replace the suggestion's range with its `replacementText`, remove it, and remap the rest.                                                 |
| `aiSuggestionReject(id)`         | Remove one suggestion without changing the document.                                                                                      |
| `aiSuggestionApplyAll()`         | Apply every suggestion in one transaction.                                                                                                |
| `aiSuggestionClear()`            | Remove every suggestion without changing the document.                                                                                    |
| `aiSuggestionSelect(id \| null)` | Mark a suggestion selected, or clear the selection.                                                                                       |

## State binding

The extension exposes its state through `editor.storage.aiSuggestion`:

```ts
interface AiSuggestionStorage {
  state: 'idle' | 'loading' | 'error'
  error: Error | null
  suggestions: AiSuggestion[] // mirror of plugin state, in document order
  selectedId: string | null
  droppedCount: number // suggestions dropped in the last load (unmatched / unknown rule)
}
```

The authoritative source is the ProseMirror plugin; storage is refreshed after each view update.

## Styling

Decorations are plain inline decorations you style yourself. No CSS is bundled.

| Hook                              | Applied to                                               |
| --------------------------------- | -------------------------------------------------------- |
| `.conote-ai-suggestion`           | Every suggestion.                                        |
| `.conote-ai-suggestion--selected` | The selected suggestion.                                 |
| `[data-rule-id="<id>"]`           | Suggestions from a specific rule.                        |
| `--conote-ai-suggestion-color`    | CSS variable set from the rule's `color`, when provided. |

```css
.conote-ai-suggestion {
  border-bottom: 2px solid var(--conote-ai-suggestion-color, #e11d48);
  background: color-mix(in srgb, var(--conote-ai-suggestion-color, #e11d48) 12%, transparent);
  cursor: pointer;
}
.conote-ai-suggestion--selected {
  background: color-mix(in srgb, var(--conote-ai-suggestion-color, #e11d48) 28%, transparent);
}
```

## How positions are resolved

Character offsets from the model are unreliable, so ranges are derived locally: the document is
projected to plain text (text blocks joined with newlines), each `deleteText` is found by exact
substring search, and the model's optional `beforeText` context disambiguates repeated matches.
Unmatched suggestions are dropped and counted in `droppedCount`. Once resolved, ranges are mapped
through every transaction; a suggestion is invalidated if the text under its range stops matching
`deleteText` (e.g. you edit inside it), and shifted when you edit before it.

## Behavior notes

- **Loading is manual.** There is no auto-reload; call `aiSuggestionLoad()` explicitly.
- **Single-flight.** Starting a load while one is in progress returns `false`.
- **Errors.** Invalid JSON or a provider failure sets `state` to `'error'` and stores the error.
- **Plain text.** Suggestions operate on plain text; ranges never span block boundaries.

## License

MIT. See the repository root for details.
