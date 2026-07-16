# @conote/extension-ai-agent

A conversational AI agent for [Tiptap](https://github.com/ueberdosis/tiptap). The user chats with it; the agent reads the document and edits it through tool calls. By default its edits are **staged as tracked changes** through [`@conote/extension-ai-changes`](https://github.com/DevinoSolutions/CoNote/tree/main/packages/conote-extension-ai-changes), so you review and accept them before anything lands.

Part of **[CoNote](https://github.com/DevinoSolutions/CoNote)** — an open-source fork of [Tiptap](https://github.com/ueberdosis/tiptap) maintained by Devino that adds self-hostable AI editing features. This package is written from scratch and is not affiliated with or endorsed by Tiptap GmbH.

## Install

```bash
pnpm add @conote/extension-ai-agent @conote/ai-core
# For the default review mode, also install the changes extension:
pnpm add @conote/extension-ai-changes
```

## Usage (review mode + AiChanges)

Register `AiChanges` alongside `AiAgent`. In review mode the agent stages its edits through the changes extension's `aiChangesSet` command, discovered at runtime.

```ts
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { OpenRouterProvider } from '@conote/ai-core'
import { AiChanges } from '@conote/extension-ai-changes'
import { AiAgent } from '@conote/extension-ai-agent'

const editor = new Editor({
  extensions: [
    StarterKit,
    AiChanges,
    AiAgent.configure({
      provider: new OpenRouterProvider({ baseUrl: '/api/ai' }),
    }),
  ],
})

editor.commands.aiAgentSend('Make the intro more concise and fix any typos.')
// The agent's edits appear in the AiChanges sidebar for accept/reject.
```

The agent needs a `ChatCompletionProvider` (from `@conote/ai-core` v0.2.0+) — the provider that implements the non-streaming, tool-aware `chatComplete` turn.

### Direct mode

Set `applyMode: 'direct'` to apply edits immediately via transactions, with no review step and no dependency on AiChanges:

```ts
AiAgent.configure({ provider, applyMode: 'direct' })
```

## Tools exposed to the model

All editing is text-anchored (never character offsets), so quotes survive edits elsewhere in the document:

| Tool | Arguments | Effect |
| --- | --- | --- |
| `read_document` | — | Returns the document as plain text (paragraphs separated by newlines). |
| `replace_text` | `{ find, replace, before_context? }` | Replaces the first occurrence of `find`; `before_context` disambiguates repeats; empty `replace` deletes. |
| `insert_text` | `{ position: 'start' \| 'end', text }` | Inserts text at the document start or end. |

In review mode, `read_document` returns the **virtual** text (the base document with the edits staged so far applied) so the model reasons consistently within a run; edit tools always report success even though the real document is untouched until you accept the staged changes.

## Options

```ts
interface AiAgentOptions {
  provider: ChatCompletionProvider   // required
  defaultModel?: string
  temperature?: number
  systemPrompt?: string              // overrides the built-in prompt
  applyMode?: 'review' | 'direct'    // default 'review'
  maxTurns?: number                  // default 8
}
```

## Commands

| Command | Description |
| --- | --- |
| `aiAgentSend(message)` | Sends a user message and runs the loop. Single-flight: returns `false` while a run is in progress. In review mode, returns `false` with an error state if AiChanges is missing. |
| `aiAgentAbort()` | Aborts the in-flight run. State returns to idle; the transcript keeps what completed. |
| `aiAgentReset()` | Clears the transcript and resets state (aborts any in-flight run). |

## Storage

Bind your UI to `editor.storage.aiAgent`:

```ts
interface AiAgentStorage {
  state: 'idle' | 'working' | 'error'
  error: Error | null
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>
  lastStagedCount: number
}
```

The transcript holds only the user- and assistant-visible turns; the internal tool call/result exchanges are not exposed.

## The loop

`aiAgentSend` appends the user message and runs up to `maxTurns` (default 8) chat turns. Each turn: the provider may return tool calls, which are executed and fed back as results, or a plain reply, which ends the run. Exceeding `maxTurns`, or a turn with neither content nor tool calls, sets the error state. The run is single-flight and abortable — `aiAgentAbort()` threads an `AbortSignal` through the provider; on abort the state returns to idle and the transcript keeps whatever completed. In review mode, the accumulated edits are staged in one `aiChangesSet` call when the loop finishes.

## Relationship to `@conote/extension-ai-changes`

`@conote/extension-ai-changes` is **not** a hard dependency. Review mode discovers its `aiChangesSet` command on the editor at runtime; if the extension is not registered, `aiAgentSend` returns `false` and sets an error state (see the required-extension note above). Direct mode does not use it at all.

## Notes and limitations

- **Stale positions.** Edit tools compute ranges against the document as it was when the run started. If the user edits the document mid-run, some staged ranges may no longer match; `aiChangesSet` validates each change against the real document and silently drops any whose `oldText` no longer matches. `lastStagedCount` reflects the changes submitted for staging.
- **Block boundaries.** A `replace_text` whose match would span a paragraph boundary cannot be anchored and is reported back to the model as an error; ask it to edit one paragraph at a time.

## License

MIT
