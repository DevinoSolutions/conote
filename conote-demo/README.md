# CoNote Demo

A self-contained playground for CoNote's AI Generation feature: a Tiptap editor
wired to `@conote/extension-ai`, streaming completions through a small Node proxy
that keeps your OpenRouter API key server-side.

This demo is part of **CoNote**, an open-source fork of
[Tiptap](https://github.com/ueberdosis/tiptap). It is **not affiliated with or
endorsed by Tiptap GmbH**. MIT licensed.

The demo is intentionally decoupled from the monorepo: it is managed with plain
`npm` (not the pnpm workspace) and resolves the CoNote packages directly from
their source via a Vite alias.

## Prerequisites

- Node.js 18+ (uses the built-in `fetch`)
- An [OpenRouter API key](https://openrouter.ai/keys)

## Setup

```bash
cd conote-demo
cp .env.example .env      # then edit .env and paste your OPENROUTER_API_KEY
npm install
```

## Run

Two processes, in separate terminals:

```bash
# 1. Proxy (port 8787) — holds the API key, forwards to OpenRouter
npm run server

# 2. Vite dev server (port 5173) — the editor UI
npm run dev
```

Open http://localhost:5173. Select some text and click a tool
(Continue writing, Rewrite, Summarize, Tone, Translate, or a custom prompt);
generated tokens stream into the document. The status line reflects the
extension state (idle / pending / streaming / error).

## How it works

- **`server/index.mjs`** — dependency-free Node HTTP proxy. Reads
  `OPENROUTER_API_KEY` from `.env`, exposes `POST /api/chat/completions`, injects
  the `Authorization` header, and streams the SSE response back verbatim. This is
  the reference production pattern: the key never reaches the browser.
- **`src/main.ts`** — builds a Tiptap editor with `StarterKit` and
  `@conote/extension-ai`, configured with an `OpenRouterProvider` in proxy mode
  (`baseUrl: 'http://localhost:8787/api'`, no `apiKey`).

## E2E tests

Real browser end-to-end tests (Playwright, Chromium) exercise all four AI
features against the actual stack: Vite app → demo proxy → OpenRouter → live LLM.
They live in `e2e/` and are managed by `npm` inside this folder (not the pnpm
workspace).

Requirements:

- `OPENROUTER_API_KEY` available, either in the environment or in `conote-demo/.env`
  (the same key the proxy uses). The Playwright config fails fast with a clear
  message if neither is present. The key is never committed; `.env` stays gitignored.
- Chromium installed once via `npx playwright install chromium`.

Run:

```bash
cd conote-demo
npm install
npx playwright install chromium   # first time only
npm run test:e2e                  # headless
npm run test:e2e:headed           # watch it drive the browser
```

Playwright manages the server lifecycle: it starts the proxy (`node
server/index.mjs`, port 8787) and the Vite dev server (port 5173) automatically,
and reuses them if they are already running locally. Tests are serialized
(`workers: 1`) to keep live-LLM calls deterministic and rate-limit friendly.

The suite is served and navigated at `http://localhost:5173` (not `127.0.0.1`)
because the proxy's CORS allowlist and the app's proxy base URL both use
`localhost`; a mismatched host would fail the cross-origin LLM calls.

Because LLM output is nondeterministic, tests assert **invariants** — state
transitions, document-text deltas (read from `editor.state.doc.textContent`),
decoration CSS classes, and panel `data-testid`s — never exact generated text.

## License

MIT
