import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url))

// Resolve the CoNote packages straight from the monorepo SOURCE so the demo
// exercises the real extension without a build step, while staying fully
// decoupled from the pnpm workspace and its lockfile.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  resolve: {
    // A single instance of each of these must be shared across the aliased
    // monorepo source and the npm-installed packages (@tiptap/react, StarterKit,
    // the bubble menu). Two React or two @tiptap/core copies would break hooks
    // and ProseMirror instanceof checks.
    dedupe: ['@tiptap/core', '@tiptap/pm', 'react', 'react-dom'],
    // Anchored regexes so these are EXACT matches — a prefix match would rewrite
    // subpaths like `@tiptap/core/jsx-runtime` into broken paths.
    alias: [
      {
        find: /^@conote\/ai-core$/,
        replacement: fromRoot('../packages/conote-ai-core/src/index.ts'),
      },
      {
        find: /^@conote\/extension-ai$/,
        replacement: fromRoot('../packages/conote-extension-ai/src/index.ts'),
      },
      {
        find: /^@conote\/extension-ai-suggestion$/,
        replacement: fromRoot('../packages/conote-extension-ai-suggestion/src/index.ts'),
      },
      {
        find: /^@conote\/extension-ai-changes$/,
        replacement: fromRoot('../packages/conote-extension-ai-changes/src/index.ts'),
      },
      {
        find: /^@conote\/extension-ai-agent$/,
        replacement: fromRoot('../packages/conote-extension-ai-agent/src/index.ts'),
      },
      // The extension source lives outside this project's tree, so node_modules
      // walking from it misses the demo's install. Pin the exact tiptap
      // specifiers it imports to the demo's copies (this also dedupes @tiptap/core
      // across StarterKit and the extension).
      {
        find: /^@tiptap\/core$/,
        replacement: fromRoot('./node_modules/@tiptap/core/dist/index.js'),
      },
      {
        find: /^@tiptap\/pm\/state$/,
        replacement: fromRoot('./node_modules/@tiptap/pm/dist/state/index.js'),
      },
      {
        find: /^@tiptap\/pm\/view$/,
        replacement: fromRoot('./node_modules/@tiptap/pm/dist/view/index.js'),
      },
      {
        find: /^@tiptap\/pm\/model$/,
        replacement: fromRoot('./node_modules/@tiptap/pm/dist/model/index.js'),
      },
    ],
  },
})
