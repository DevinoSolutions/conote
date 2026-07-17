# CoNote Demo — AI Panel UI design

**Date:** 2026-07-17
**Status:** Approved by Amin ("Yes lets design our own AI panel UI", 2026-07-17)
**Depends on:** the React demo conversion (2026-07-16 spec). Legal ground rules unchanged and extended below.

## Goal

Give `conote-demo` a production-quality visual design. Two layers:

1. **Editor chrome:** vendor the free MIT "Simple Editor" pieces from `ueberdosis/tiptap-ui-components` (via `npx @tiptap/cli` inside conote-demo, or manual copy) — toolbar, buttons, base editor styling — pinned snapshot, credited in the demo README with source, version, and license. If the CLI route proves impractical (network/structure), build an equivalent clean shell from scratch and say so.
2. **AI panels (ours, forever):** design CoNote's own UI for the four AI surfaces — generation toolbar + bubble menu, Edit-with-AI tracked-changes review sidebar, agent chat (with streaming bubble), proofread suggestions — in the same design language as the shell, so the demo reads as one coherent product. This is deliberate: tiptap's AI UI components are Pro-locked and cloud-bound; CoNote ships an open MIT reference UI instead.

## Research (inspiration, not copying)

Use the stealth browser to view tiptap's **public** Content AI pages/demos to learn the UX patterns (how suggestions are surfaced, how change review reads, how the AI menu is laid out). Hard rules:

- Screenshots for reference only. **No code, CSS, markup, or assets may be taken from tiptap's site or Pro products.**
- No tiptap logos, brand colors, or lookalike branding. CoNote's design language must be visually its own.
- The existing README non-affiliation statement stays true and accurate.

## Constraints

- No new runtime UI dependencies (no component libraries); vendored Simple Editor files + hand-written CSS only. React/@tiptap/react stay as-is.
- All existing `data-testid`s and `window.editor` preserved verbatim; behavior unchanged.
- `npm run typecheck` clean; **Playwright E2E 7/7 unchanged** (a selector inside e2e/helpers may be touched only if a DOM restructuring truly requires it, with justification).
- Dark theme first (current demo is dark); light support optional.
- Accessibility: focus states, aria labels on icon buttons, adequate contrast.

## Verification

typecheck + full live E2E + visual review via browser screenshots (desktop and ~1024px). Dev servers left running afterward for the user.
