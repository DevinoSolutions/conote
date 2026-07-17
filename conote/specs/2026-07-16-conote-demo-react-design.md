# CoNote Demo → React conversion

**Date:** 2026-07-16
**Status:** Approved by Amin ("Make sure the demo is using the react components and the UI rather than just using the headless", 2026-07-16)
**Depends on:** Phases 1–5. Legal ground rules unchanged.

## Goal

Rebuild `conote-demo` on `@tiptap/react` — tiptap's own React bindings and UI extensions from the fork — instead of the current vanilla-TS headless mounting with a hand-rolled 150 ms rerender loop. Feature set, behavior, and the E2E contract stay identical.

## What we use (and don't)

- **Use:** `@tiptap/react` (`useEditor`, `EditorContent`, `useEditorState`), and `@tiptap/react/menus` `BubbleMenu` for selection-scoped AI actions. Installed from npm at `^3.28.0` (same channel/version as the demo's existing `@tiptap/core`); the code is identical to the fork's `packages/react`.
- **Don't use:** `@tiptap/ai-toolkit` (client SDK for Tiptap's proprietary cloud AI — never read, never imported) and the separate `tiptap-ui-components` repo (not part of the fork; its AI components target the paid cloud).

## Changes (all inside `conote-demo/`)

- Dependencies: `react`, `react-dom`, `@tiptap/react@^3.28.0`; dev: `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`. Vite config gains the react plugin; existing `@conote/*` + `@tiptap/pm` aliases unchanged. `dedupe: ['@tiptap/core', '@tiptap/pm', 'react', 'react-dom']` to keep a single core instance across aliased source and npm packages.
- `src/main.ts` → `src/main.tsx` (createRoot) + `src/App.tsx` + `src/components/*`: `EditorPanel` (EditorContent + BubbleMenu with quick AI actions: Rewrite, Summarize, Tone), `GenerationToolbar`, `EditWithAiPanel`, `AgentChatPanel` (incl. streaming bubble), `ProofreadPanel`. `index.html` script tag updated.
- State→UI binding: `useEditorState` with selectors over `editor.storage.{ai,aiChanges,aiSuggestion,aiAgent}` replaces the 150 ms interval. **Known risk:** `useEditorState` recomputes on editor transactions; storage fields updated asynchronously *without* a transaction (e.g. `state: 'pending'`, agent `streamingText` between doc edits) would not trigger a rerender. Mitigation: a small `useAiTick(editor)` hook that also subscribes to a lightweight interval (~150 ms) **only while any AI state ≠ idle**, unioned with transaction-driven updates. Idle app = zero polling.
- Styling stays `src/style.css` (adjust selectors as needed). Footer/attribution text unchanged.

## Invariants (the contract)

1. All existing `data-testid`s keep working (panels may be reorganized visually, testids must not change).
2. `window.editor` is still set to the live Editor instance.
3. All four AI flows behave identically through the proxy.
4. **The Playwright E2E suite passes unchanged** — no edits under `e2e/` except if a wait needs loosening for React render timing (allowed only with justification).
5. `npm run typecheck` passes; no pnpm/workspace files touched.

## Verification

Full `npm run test:e2e` (7/7, live OpenRouter) + `npm run typecheck` + visual spot-check in a browser.
