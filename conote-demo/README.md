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

## License

MIT
