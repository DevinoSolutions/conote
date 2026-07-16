# CoNote Phase 2 Design — AI Suggestion

**Date:** 2026-07-16
**Status:** Approved by Amin ("go for it", 2026-07-16)
**Depends on:** Phase 1 (`@conote/ai-core`, `@conote/extension-ai`) — see 2026-07-16-conote-phase1-design.md for legal ground rules (from-scratch implementation, no proprietary Tiptap AI code, attribution-only use of the Tiptap name). Those rules apply unchanged.

## Goal

`@conote/extension-ai-suggestion` (`packages/conote-extension-ai-suggestion`): rule-based proofreading suggestions over the document, shown as inline decorations, individually or collectively accept/rejectable. Comparable in capability to Tiptap's proprietary "AI Suggestion" product, independently designed and implemented.

## Architecture

### Data model

```ts
interface AiSuggestionRule { id: string; title: string; prompt: string; color?: string }
interface AiSuggestion {
  id: string                 // generated
  ruleId: string
  range: { from: number; to: number }   // ProseMirror positions, remapped on edits
  deleteText: string         // exact doc text to replace
  replacementText: string
  note?: string              // model's short explanation
}
```

### LLM round trip

- `aiSuggestionLoad()` sends the document plain text to the provider (`CompletionProvider` from `@conote/ai-core`, non-streaming `complete()`) with the rules and a strict-JSON instruction: return `{"suggestions": [{"ruleId", "deleteText", "replacementText", "note"}]}`. Response parsing tolerates markdown fences; invalid JSON → error state.
- LLM character offsets are unreliable, so positions are derived locally: each `deleteText` is located by exact string search over the document text (with occurrence disambiguation via optional `beforeText` context the model is asked to include). Unmatched suggestions are dropped silently (counted in storage for debugging).
- Loading is **manual** in Phase 2 (explicit command / button). No auto-reload debounce yet — YAGNI; can be added later without API breakage.

### Decorations & lifecycle

- A ProseMirror plugin holds `DecorationSet` with one inline decoration per suggestion (class `conote-ai-suggestion` + `data-rule-id`, style hook per rule color).
- Decorations and suggestion ranges are **mapped through every transaction**; a suggestion is invalidated (removed) if its range's text no longer equals `deleteText`.
- Popover/UI is left to the integrator: storage exposes `suggestions`, `selectedId`, `state: idle|loading|error`, `error`.

### Commands

- `aiSuggestionLoad(options?)` — fetch suggestions (single-flight; returns false while loading)
- `aiSuggestionApply(id)` — replace range with `replacementText`, remove suggestion, remap others
- `aiSuggestionReject(id)` — remove suggestion
- `aiSuggestionApplyAll()` / `aiSuggestionClear()`
- `aiSuggestionSelect(id | null)` — mark selected (adds `conote-ai-suggestion--selected` class)

### Demo integration

`conote-demo` gains a "Proofread" section: rules preconfigured (spelling/grammar, conciseness), Load suggestions button, sidebar list (rule title, before → after, accept/reject buttons), highlights in the editor, sample text seeded with deliberate errors. Testable via data-testids.

### Testing

Vitest with a scripted fake provider returning canned JSON: decorations created at correct ranges; apply replaces text and remaps remaining suggestions; reject removes; edits inside a suggestion invalidate it; edits before a suggestion shift its range; fenced/invalid JSON handling; unmatched deleteText dropped; single-flight; state transitions. Browser E2E on the demo.
