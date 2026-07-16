# CoNote Phase 5 Design — E2E tests + CI

**Date:** 2026-07-16
**Status:** Approved by Amin ("We should ship E2E tests for the AI features … bundle the openrouter key … onto the CI/CD pipeline", 2026-07-16)
**Depends on:** Phases 1–4. Legal ground rules from the Phase 1 spec apply unchanged.

## Goal

Real browser end-to-end tests for all four AI features, exercising the actual stack — Vite demo app → demo proxy → OpenRouter → live LLM — plus a GitHub Actions pipeline that runs unit tests and the E2E suite on every push/PR, with the OpenRouter key stored as a repository secret (`OPENROUTER_API_KEY`), never in the repo.

## Part A — Playwright E2E suite (in `conote-demo/`)

`conote-demo` is npm-managed and decoupled from the pnpm workspace, so adding `@playwright/test` there avoids the pnpm `minimumReleaseAge` policy entirely.

### Layout & scripts

- `conote-demo/e2e/*.spec.ts` — one spec file per feature + one smoke spec.
- `conote-demo/playwright.config.ts`:
  - Two `webServer` entries: proxy (`node server/index.mjs`, port 8787, env passthrough) and Vite (`npm run dev -- --host 127.0.0.1`, port 5173). `reuseExistingServer: !process.env.CI` so local runs reuse the already-running dev servers.
  - Chromium only. `workers: 1` and `fullyParallel: false` (serialize live-LLM calls — determinism + rate-limit friendliness). `retries: 2` on CI, 0 locally. Per-test timeout 120 s, `expect` timeout 30 s.
  - `use: { baseURL: 'http://127.0.0.1:5173' }`.
- New npm scripts: `"test:e2e": "playwright test"`, `"test:e2e:headed": "playwright test --headed"`.
- devDependency: `@playwright/test` (latest stable). Update `conote-demo/README.md` with an "E2E tests" section.
- Key handling: the proxy already reads `conote-demo/.env` or process env. The config asserts up front that `OPENROUTER_API_KEY` is available (process env or `.env` file) and fails fast with a clear message if not.

### Test design principles

Live-LLM output is nondeterministic — assert **invariants**, never exact text:

- state transitions in extension storage (exposed already via the demo panels / `window` editor handle; if the demo doesn't expose `editor` on `window`, add `window.__conoteEditor = editor` in `src/main.ts` — one line, test-only convenience, harmless in a demo),
- document text length/deltas and containment of seeded markers,
- decoration presence via CSS classes (`.conote-ai-suggestion`, `.conote-ai-change-del`, `.conote-ai-change-ins`),
- panel state via existing `data-testid`s.

Known gotcha (from Phase 3 browser testing): `.ProseMirror` `textContent` includes insertion-widget text — measure real doc text by cloning the node and stripping `.conote-ai-change-ins` first, or read `editor.state.doc.textContent` through the window handle (preferred).

The demo panels rerender on a 150 ms interval, so drive interactions via `page.getByTestId(...)` (Playwright re-resolves locators — the uid-rotation problem from a11y-snapshot-driven testing does not apply).

### Specs

1. `smoke.spec.ts` — app loads, editor visible, proxy `/api/chat/completions` reachable (a minimal real completion round-trip: seed doc, run one small AI command, expect state → idle with no error). This is the fastest LLM canary; if it fails, the rest will too.
2. `ai-generation.spec.ts` — select seeded text, run a custom prompt (cheap, constrained, e.g. "Reply with exactly the word DONE"), assert streaming state observed or final idle state, doc text changed, no error state. Also test abort: start a longer generation, click abort, assert state returns idle and no crash.
3. `ai-suggestion.spec.ts` — seed doc with deliberate misspellings, run proofread, assert ≥1 `.conote-ai-suggestion` decoration and ≥1 sidebar card; apply the first suggestion → its old text no longer in doc text; reject-all → decorations gone, doc unchanged from post-apply snapshot.
4. `ai-changes.spec.ts` — seed misspelled doc, propose "Fix all spelling mistakes. Change nothing else.", assert ≥1 change card, **doc text unchanged while previewing** (via `editor.state.doc.textContent`), accept-all → doc text differs from original and change list empty. Second scenario: propose then reject-all → doc identical to original.
5. `ai-agent.spec.ts` — send a constrained instruction ("Replace the word X with Y using your tools", with X seeded), assert working indicator appears, then: transcript gains an assistant turn, staged changes appear in the Changes sidebar (review mode), doc unchanged until accept, accept-all → doc contains Y and not X.

Each spec navigates fresh and reseeds the editor content through the window handle (`editor.commands.setContent(...)`) so tests are independent.

## Part B — GitHub Actions workflow

`.github/workflows/conote-ai.yml` — a **new** file (upstream workflows untouched, per fork rules).

- Triggers: `push` to `main`, `pull_request`, `workflow_dispatch`. `paths` filter: `packages/conote-*/**`, `conote-demo/**`, `.github/workflows/conote-ai.yml`.
- Job `unit`:
  - `pnpm/action-setup` (pnpm 11.2.2 per `packageManager`), Node 22, `pnpm install --frozen-lockfile` (validated locally — the lockfile is complete; frozen mode also sidesteps the release-age policy),
  - run vitest over the five conote packages: `./node_modules/.bin/vitest run packages/conote-ai-core packages/conote-extension-ai packages/conote-extension-ai-suggestion packages/conote-extension-ai-changes packages/conote-extension-ai-agent`.
- Job `e2e` (needs: unit):
  - Node 22, `npm ci` in `conote-demo`, `npx playwright install --with-deps chromium`,
  - `npm run test:e2e` with `env: OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`,
  - upload `conote-demo/playwright-report/` as artifact on failure,
  - **fork-PR guard:** secrets are unavailable on PRs from forks; skip the e2e job (not fail) when the secret is empty, with an explicit notice.
- Concurrency group per ref, cancel-in-progress.

### Secret

`OPENROUTER_API_KEY` is set on `DevinoSolutions/CoNote` via `gh secret set` from the local `.env` value. The key never appears in any committed file; `.env` remains gitignored.

## Verification

1. Full local `npm run test:e2e` pass against live OpenRouter (reusing running dev servers).
2. Push and watch the GitHub Actions run to green (`gh run watch`).
