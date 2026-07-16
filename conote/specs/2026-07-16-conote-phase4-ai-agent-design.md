# CoNote Phase 4 Design — AI Agent

**Date:** 2026-07-16
**Status:** Approved by Amin ("go for phase 4", 2026-07-16)
**Depends on:** Phases 1–3. Legal ground rules from the Phase 1 spec apply unchanged (from-scratch implementation, no proprietary Tiptap AI code, attribution-only use of the Tiptap name).

## Goal

`@conote/extension-ai-agent` (`packages/conote-extension-ai-agent`): a conversational agent embedded in the editor. The user chats with it; the agent can read the document and make edits via tool calls. By default its edits are **staged through `@conote/extension-ai-changes`** (`aiChangesSet`) so the user reviews them as tracked changes before anything lands. Comparable in capability to Tiptap's proprietary "AI Agent" product, independently designed and implemented.

## Part A — tool calling in `@conote/ai-core` (additive, v0.2.0)

OpenRouter is OpenAI-chat-compatible and supports the `tools` parameter; our demo proxy forwards bodies verbatim, so native tool calling works in proxy mode too.

New exports (nothing existing changes):

```ts
export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> } // JSON Schema
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> } // arguments JSON-parsed; malformed → {} + flag
export interface ToolResultMessage { role: 'tool'; toolCallId: string; content: string }
export interface AssistantToolCallMessage { role: 'assistant'; content: string | null; toolCalls: ToolCall[] }
export type AgentMessage = ChatMessage | ToolResultMessage | AssistantToolCallMessage
export interface ChatRequest { messages: AgentMessage[]; tools?: ToolDefinition[]; model?; temperature?; maxTokens?; signal? }
export interface AssistantTurn { content: string | null; toolCalls: ToolCall[]; finishReason: string | null }
export interface ChatCompletionProvider extends CompletionProvider {
  chatComplete(request: ChatRequest): Promise<AssistantTurn>
}
```

`OpenRouterProvider` implements `ChatCompletionProvider`: non-streaming POST (`stream: false`), messages serialized to OpenAI wire shape (tool results as `{role:'tool', tool_call_id, content}`, assistant tool-call turns with `tool_calls: [{id, type:'function', function:{name, arguments: JSON-string}}]`), response parsed from `choices[0].message` (`tool_calls[].function.arguments` JSON-parsed defensively). Errors/abort behave exactly like `complete()`.

## Part B — the agent extension

### Tools exposed to the model

Text-anchored (never character offsets — same robustness rationale as Phases 2–3):

- `read_document()` → current document plain text (paragraphs separated by newlines)
- `replace_text({ find, replace, before_context? })` → replace the first occurrence of `find` (disambiguated by optional `before_context`); returns success or "not found"
- `insert_text({ position: 'start' | 'end', text })` → insert at document start/end
- Deletion = `replace_text` with empty `replace`.

### Apply modes

- `applyMode: 'review'` (default): edit tools accumulate hunks; when the agent loop finishes, they are staged in one `aiChangesSet` call so the user accepts/rejects each as tracked changes. Requires the AiChanges extension on the editor — `aiAgentSend` returns false with an error state if missing. Tool results still report success so the model reasons as if applied; `read_document` reflects the *virtual* text (base text + staged edits applied) for consistency within the loop.
- `applyMode: 'direct'`: edits applied immediately via transactions.

### The loop

`aiAgentSend(message)`: append user message to transcript → loop up to `maxTurns` (default 8): `chatComplete(system + transcript + tool exchanges, tools)`; tool calls → execute, append results, continue; plain content → final assistant reply, stop. `finishReason` other than tool use with no content → generic error. Abortable via `aiAgentAbort()` (AbortSignal threaded through; abort → state idle, transcript keeps what completed). Single-flight.

### Options / storage / commands

- Options: `{ provider: ChatCompletionProvider, defaultModel?, temperature?, systemPrompt?, applyMode?: 'review'|'direct', maxTurns? }`
- Storage `aiAgent`: `{ state: 'idle'|'working'|'error', error, transcript: Array<{role:'user'|'assistant', content}>, lastStagedCount }` (tool exchanges are internal; transcript holds only user/assistant-visible turns)
- Commands: `aiAgentSend(message)`, `aiAgentAbort()`, `aiAgentReset()` (clears transcript)

### Demo integration

Chat panel: message input + send, transcript rendering (user/assistant bubbles), working indicator, reset. Agent runs in review mode — its edits appear in the existing Changes sidebar for accept/reject. Testable via data-testids.

### Testing

Vitest, scripted fake ChatCompletionProvider (queue of AssistantTurns): wire serialization of tool results/assistant tool-call turns (assert on request messages); replace_text exact + before_context disambiguation + not-found result; insert start/end; review mode stages via aiChangesSet with correct ranges and doc untouched; virtual read_document mid-loop; direct mode applies immediately; maxTurns cutoff → error state; abort mid-loop; provider error → error; single-flight; reset. Plus ai-core unit tests for chatComplete parsing (tool_calls, string arguments, malformed arguments, no tools). Browser E2E on the demo.
