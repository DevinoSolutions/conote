# CoNote Phase 1 Design — Fork Setup + AI Core + AI Generation

**Date:** 2026-07-16
**Status:** Approved by Amin (2026-07-16)
**Repo:** https://github.com/DevinoSolutions/CoNote

## What CoNote is

CoNote is an open-source fork of [Tiptap](https://github.com/ueberdosis/tiptap) maintained by Devino. It tracks upstream Tiptap (the MIT-licensed editor) and adds an independent, self-hostable implementation of AI editing features comparable to Tiptap's proprietary cloud AI products.

**Legal ground rules (non-negotiable):**

- Tiptap's editor core is MIT — we fork it, keep the LICENSE and all copyright notices intact.
- Tiptap's AI features (AI Generation, AI Suggestion, AI Changes, AI Agent) are proprietary cloud products. **Zero code from those products is used or referenced.** We reimplement the capabilities from scratch against publicly documented behavior only.
- "Tiptap" is used for attribution/crediting only. No Tiptap logos or branding in CoNote marketing. README states clearly: not affiliated with or endorsed by Tiptap GmbH.
- Nothing is hidden: the README says plainly that this is a fork and what was added.

## Phase 1 scope

1. **Fork setup** — import full `ueberdosis/tiptap` git history into `DevinoSolutions/CoNote` `main`; keep `upstream` remote for future `git merge upstream/main`. All CoNote code lives in _new_ packages so upstream merges stay near-conflict-free. Upstream packages are never modified.
2. **README & licensing** — rewrite root README per the ground rules above; preserve upstream README as `README.upstream.md`; our packages are MIT.
3. **`@conote/ai-core`** — provider-agnostic AI layer.
4. **`@conote/extension-ai`** — AI Generation extension (Tiptap extension).
5. **Demo proxy + demo app** — reference deployment pattern + browser-testable playground.
6. **Tests** — unit tests per package + real-browser E2E verification.

Out of scope (later phases, each with its own spec): AI Suggestion (Phase 2), AI Changes (Phase 3), AI Agent (Phase 4).

## Architecture

### Package layout (inside the monorepo)

```
packages/
  ...upstream @tiptap/* packages (untouched)
  conote-ai-core/          → npm: @conote/ai-core
  conote-extension-ai/     → npm: @conote/extension-ai
demos/ or playground per upstream conventions
conote-demo/               → Vite demo app + Node proxy (not published)
```

Follow upstream's build tooling (workspace manager, bundler, TS config) exactly — our packages should look native to the monorepo.

### `@conote/ai-core`

- `CompletionProvider` interface: `stream(request: CompletionRequest): AsyncIterable<TextChunk>` plus non-streaming `complete()`.
- `CompletionRequest`: messages (system/user), model, temperature, maxTokens, abort signal.
- Built-in **OpenRouter adapter**: SSE streaming via `fetch`. Configurable with either an `apiKey` (local dev) or a `baseUrl` pointing at a proxy (production pattern — key stays server-side).
- No extension code knows about OpenRouter specifically; any backend can implement `CompletionProvider`.

### `@conote/extension-ai` (AI Generation)

Tiptap extension exposing editor commands:

- `aiComplete` — continue writing from cursor/selection context
- `aiRewrite` — rewrite selection
- `aiSummarize` — summarize selection
- `aiAdjustTone(tone)` — change tone of selection
- `aiTranslate(language)` — translate selection
- `aiCustomPrompt(prompt)` — arbitrary instruction over selection/document

Behavior:

- Streams tokens into the document via ProseMirror transactions; two insertion modes: insert-at-cursor and replace-selection.
- Exposes state (idle / pending / streaming / error) via extension storage for UI binding.
- Abort support (`aiAbort` command) wired to the provider's abort signal.
- Command surface is _similar in spirit_ to Tiptap's documented AI API so migration is intuitive, but independently designed and implemented.

### Demo proxy + demo app (`conote-demo/`)

- **Proxy:** small Node server (Hono) holding `OPENROUTER_API_KEY` in a gitignored `.env`; forwards streaming completion requests. This is the reference production pattern (never ship the key to the browser).
- **App:** Vite + Tiptap editor with `@conote/extension-ai` wired up, buttons/menu for each AI command, streaming visible live.
- Verified end-to-end in a real browser (Chrome DevTools MCP).

### Error handling

- Provider errors (network, 4xx/5xx, rate limits) surface as extension `error` state with message; document is left consistent (no half-applied replace: replace-selection buffers apply progressively but an abort/error stops cleanly at last inserted token, with undo available as a single history step where feasible).
- Aborts are user-initiated and not errors.

### Testing

- Unit tests for `ai-core` (adapter parsing, streaming, abort) and `extension-ai` (commands, transactions, state) using upstream's existing test setup.
- Manual/automated browser E2E on the demo app.

## Security notes

- `OPENROUTER_API_KEY` lives only in local `.env` (gitignored). The key shared during planning is considered semi-exposed and should be rotated.
