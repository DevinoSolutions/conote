# CoNote

CoNote is an open-source fork of [Tiptap](https://github.com/ueberdosis/tiptap), the MIT-licensed headless rich-text editor built on [ProseMirror](https://prosemirror.net/). It is maintained by [Devino](https://github.com/DevinoSolutions) at https://github.com/DevinoSolutions/CoNote. There is nothing hidden about what this project is: it is a fork that tracks upstream Tiptap and adds a small number of independently written AI packages on top.

The upstream project's original README is preserved unchanged at [README.upstream.md](README.upstream.md).

## What is CoNote

CoNote keeps the full Tiptap editor — the headless, framework-agnostic editor core and its extensions — and layers on an independent, self-hostable, open-source implementation of AI editing features. In upstream Tiptap, those AI capabilities are delivered as proprietary paid cloud products (Content AI). CoNote provides comparable capabilities that you can run against any LLM backend you choose, with the provider key kept on your own server.

The goals of the fork are:

- **Track upstream Tiptap.** Regularly merge changes from `ueberdosis/tiptap` so CoNote stays current with the editor core and extensions. All CoNote code lives in new packages, and upstream packages are never modified, so these merges stay near-conflict-free.
- **Add open, self-hostable AI editing.** Offer AI features (AI text generation today; AI suggestions, AI change review, and an AI agent on the roadmap) that are open source and provider-agnostic rather than tied to a proprietary cloud service.

CoNote's AI packages are **written from scratch**. They contain **no code from Tiptap's proprietary AI products** and do not depend on Tiptap's cloud services. They only implement comparable capabilities against a provider-agnostic interface — an OpenRouter adapter is included, and any LLM backend can be plugged in by implementing that interface.

## Relationship to Tiptap

CoNote is a fork, not a rewrite. The editor and its extensions come directly from upstream Tiptap and remain under Tiptap's MIT license, with all copyright notices intact. We maintain an `upstream` git remote pointing at `ueberdosis/tiptap` and periodically merge its changes into CoNote.

What CoNote adds sits entirely in separate, new packages (see [Packages](#packages)). This separation is deliberate: it keeps the fork easy to keep in sync with upstream and makes it obvious which code originates from Tiptap and which is CoNote's own work.

The AI command surface in CoNote is designed to feel familiar to developers who know Tiptap's documented AI API, so migration is intuitive — but it is independently designed and implemented, based only on publicly documented behavior. No proprietary Tiptap AI code is used.

## AI features

| Feature | Description | Status |
| --- | --- | --- |
| AI Generation | Text generation and editing commands (complete, rewrite, summarize, adjust tone, translate, custom prompt) that stream into the document. | In progress — Phase 1 |
| AI Suggestion | Inline AI-driven suggestions surfaced in the editor. | Planned |
| AI Changes | Review and accept/reject AI-proposed changes. | Planned |
| AI Agent | An AI agent that can operate over document content. | Planned |

All of these are, or will be, implemented independently and provider-agnostically. The included OpenRouter adapter is one backend; you can supply your own.

## Packages

The CoNote-specific packages are maintained under the monorepo alongside the upstream `@tiptap/*` packages. They are MIT-licensed and written from scratch.

| Package | Location | Description |
| --- | --- | --- |
| `@conote/ai-core` | `packages/conote-ai-core` | Provider-agnostic AI layer. Defines the completion-provider interface (streaming and non-streaming) and ships an OpenRouter adapter. No editor or provider-specific code leaks across the interface. |
| `@conote/extension-ai` | `packages/conote-extension-ai` | Tiptap extension implementing AI Generation. Exposes editor commands that stream tokens into the document via ProseMirror transactions, with abort support and state for UI binding. |

These packages may not all exist yet — they are being built out as part of Phase 1. This README documents the intended layout so the structure is clear from the start.

## Development

CoNote uses the same tooling as upstream Tiptap. The monorepo is managed with [pnpm](https://pnpm.io/). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution guidelines.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

The demos app can be run locally with `pnpm dev`. New demos are scaffolded with `pnpm run make:demo` (see [CONTRIBUTING.md](CONTRIBUTING.md) for details).

## Staying in sync with upstream

CoNote tracks `ueberdosis/tiptap`. To pull in upstream changes, add the upstream remote once and merge from it:

```bash
# One-time: register the upstream remote
git remote add upstream https://github.com/ueberdosis/tiptap.git

# Fetch and merge upstream changes into your branch
git fetch upstream
git merge upstream/main
```

Because all CoNote code lives in separate packages (`packages/conote-*`) and upstream packages are left untouched, these merges are expected to be near-conflict-free.

## License & attribution

CoNote is distributed under the MIT License. The upstream Tiptap editor and extensions retain their original MIT license and copyright notices — see [LICENSE.md](LICENSE.md). CoNote's own packages (`@conote/ai-core`, `@conote/extension-ai`, and future AI packages) are likewise MIT-licensed.

### Trademarks and affiliation

Tiptap is created by [überdosis / Tiptap GmbH](https://tiptap.dev/). "Tiptap" is referenced here solely for attribution and to describe compatibility. CoNote is **not affiliated with, sponsored by, or endorsed by** Tiptap GmbH. No Tiptap logos or brand assets are used in CoNote.

The editor is built on [ProseMirror](https://prosemirror.net/) by Marijn Haverbeke, whose work underpins both Tiptap and, by extension, CoNote.

CoNote's AI packages are original work by Devino. They contain no code from Tiptap's proprietary AI products and only reimplement comparable capabilities against a provider-agnostic interface.
