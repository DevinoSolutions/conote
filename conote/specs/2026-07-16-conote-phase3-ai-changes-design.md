# CoNote Phase 3 Design — AI Changes

**Date:** 2026-07-16
**Status:** Approved by Amin ("go for it", 2026-07-16)
**Depends on:** Phase 1 (`@conote/ai-core`) and the legal ground rules in 2026-07-16-conote-phase1-design.md (from-scratch implementation, no proprietary Tiptap AI code, attribution-only use of the Tiptap name). Those rules apply unchanged.

## Goal

`@conote/extension-ai-changes` (`packages/conote-extension-ai-changes`): let an LLM propose an edit to the document (or a selection) and present the result as **reviewable tracked changes** — deletions struck through, insertions highlighted — each individually acceptable/rejectable, with accept-all/reject-all. The document is **not modified until a change is accepted**. Comparable in capability to Tiptap's proprietary "AI Changes" product, independently designed and implemented.

## Architecture

### Data model

```ts
interface AiChange {
  id: string
  range: { from: number; to: number }  // ProseMirror range of the OLD text (empty for pure insertions)
  oldText: string                       // '' for pure insertion
  newText: string                       // '' for pure deletion
}
```

A change set is produced by diffing the current text against the LLM's rewrite. Hunks are **word-level**: tokenize into words + trailing whitespace, LCS (dynamic programming) over tokens, merge adjacent delete+insert runs into replace hunks. The diff is implemented from scratch in the package (zero runtime deps beyond `@conote/ai-core`).

### LLM round trip

- `aiChangesPropose({ prompt, model?, temperature? })` — takes the selection (or whole doc when selection is empty) as plain text, sends it with the user instruction via `CompletionProvider.complete()` (non-streaming), diffs old vs new, converts token hunks into `AiChange[]` anchored at ProseMirror positions (using the same plain-text→pos projection technique as Phase 2), and stores them in plugin state. Single-flight; returns false while loading.
- The system prompt instructs the model to return ONLY the revised text (no preamble, no fences); fences are stripped defensively.
- If the diff is empty (model returned identical text) the state returns to idle with zero changes.

### Preview rendering (document unchanged)

A ProseMirror plugin renders each change without touching the document:
- **Deletion part:** inline decoration over `range` with class `conote-ai-change-del` (strikethrough, red tint).
- **Insertion part:** widget decoration at `range.to` with class `conote-ai-change-ins` (green tint) whose DOM node shows `newText`.
- Selected change gets `--selected` modifier classes.
- Ranges are mapped through every transaction; a change is invalidated (dropped) if the mapped range's text no longer equals `oldText`.

### Commands (namespace `aiChanges`)

- `aiChangesPropose(options)` — as above
- `aiChangesAccept(id)` — apply that hunk (replace `range` with `newText`), drop it, remap the rest
- `aiChangesReject(id)` — drop the hunk, document untouched
- `aiChangesAcceptAll()` — apply every hunk in one transaction (right-to-left)
- `aiChangesRejectAll()` — drop all
- `aiChangesSelect(id | null)`
- `aiChangesSet(changes: Omit<AiChange,'id'>[])` — programmatic entry point (used later by the Phase 4 agent to route its edits through review)

### Storage

`editor.storage.aiChanges = { state: 'idle'|'loading'|'error', error, changes, selectedId }`

### Demo integration

`conote-demo` gains an "Edit with AI" panel: instruction input + "Propose changes" button; inline diff view in the editor; sidebar cards (old → new per hunk) with Accept/Reject, plus Accept all / Reject all. Testable via data-testids.

### Testing

Vitest with fake provider: word-diff unit cases (replace, pure insert, pure delete, multiple hunks, identical text → no changes, whitespace-only differences); hunk→position anchoring; preview leaves doc unchanged; accept applies single hunk and remaps others; reject leaves doc; accept-all equals full rewrite; user edit inside a hunk invalidates it, edit before shifts it; fences stripped; provider error → error state; single-flight; select. Browser E2E on the demo.
