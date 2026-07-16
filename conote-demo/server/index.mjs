// CoNote demo proxy.
//
// The reference production pattern for CoNote AI: the OpenRouter API key lives
// only on the server, and the browser talks to this proxy instead of OpenRouter
// directly. It forwards POST /api/chat/completions to OpenRouter verbatim,
// injecting the Authorization header, and streams the SSE response straight back.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = 8787
const ALLOWED_ORIGIN = 'http://localhost:5173'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const here = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = join(here, '..', '.env')

/**
 * Minimal .env parser: `KEY=value` per line, `#` comments and blank lines
 * ignored, surrounding single/double quotes stripped. No dependencies.
 */
function loadEnv(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq === -1) {
      continue
    }
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const fileEnv = loadEnv(ENV_PATH)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || fileEnv.OPENROUTER_API_KEY || ''

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function sendJson(res, status, body) {
  setCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handleChatCompletions(req, res) {
  if (!OPENROUTER_API_KEY) {
    sendJson(res, 500, {
      error:
        'OPENROUTER_API_KEY is not configured. Copy conote-demo/.env.example to conote-demo/.env and set the key, then restart the server.',
    })
    return
  }

  const body = await readBody(req)

  let upstream
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': ALLOWED_ORIGIN,
        'X-Title': 'CoNote Demo',
      },
      body,
    })
  } catch (error) {
    sendJson(res, 502, {
      error: `Failed to reach OpenRouter: ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }

  // Propagate non-2xx status and body verbatim so the client surfaces the real
  // upstream error message.
  if (!upstream.ok) {
    const text = await upstream.text()
    setCors(res)
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    })
    res.end(text)
    return
  }

  // Stream the SSE response back chunk-by-chunk, flushing as we go.
  setCors(res)
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  if (!upstream.body) {
    res.end()
    return
  }

  try {
    for await (const chunk of upstream.body) {
      res.write(chunk)
      // Flush proxied SSE frames immediately when compression middleware is present.
      if (typeof res.flush === 'function') {
        res.flush()
      }
    }
  } catch (error) {
    // Client aborted or upstream dropped; nothing more we can send.
    void error
  } finally {
    res.end()
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? ''

  if (req.method === 'OPTIONS') {
    setCors(res)
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && url.startsWith('/api/chat/completions')) {
    handleChatCompletions(req, res).catch((error) => {
      sendJson(res, 500, {
        error: `Proxy error: ${error instanceof Error ? error.message : String(error)}`,
      })
    })
    return
  }

  sendJson(res, 404, { error: `Not found: ${req.method} ${url}` })
})

server.listen(PORT, () => {
  const keyStatus = OPENROUTER_API_KEY ? 'key loaded' : 'NO KEY — set OPENROUTER_API_KEY in .env'
  console.log(`CoNote demo proxy listening on http://localhost:${PORT} (${keyStatus})`)
})
