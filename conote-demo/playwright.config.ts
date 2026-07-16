import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Fail fast before spawning anything: the demo proxy needs an OpenRouter key,
// sourced from process.env or conote-demo/.env. Every AI spec hits the live LLM,
// so a missing key would surface as a wall of opaque timeouts instead.
const envFile = fileURLToPath(new URL('./.env', import.meta.url))
const hasKey = Boolean(process.env.OPENROUTER_API_KEY) || existsSync(envFile)
if (!hasKey) {
  throw new Error(
    'OPENROUTER_API_KEY is required for the CoNote E2E suite. ' +
      'Set it in the environment or create conote-demo/.env (copy .env.example). ' +
      'The key is never committed; see conote-demo/README.md.',
  )
}

// NOTE: the page is served and navigated at `localhost` (not `127.0.0.1`) on
// purpose. The demo proxy hardcodes `Access-Control-Allow-Origin:
// http://localhost:5173` (server/index.mjs) and main.ts posts to
// http://localhost:8787/api. Serving the page from 127.0.0.1 would make every
// cross-origin LLM call fail CORS. `localhost` keeps the origin in sync.
const BASE_URL = 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node server/index.mjs',
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
