import { describe, expect, it, vi } from 'vitest'

import { AiProviderError, OpenRouterProvider } from '../src/index.js'
import type { CompletionRequest } from '../src/index.js'

const encoder = new TextEncoder()

/** Build a Response whose body streams the given raw string chunks as bytes. */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, { status: 200, ...init })
}

/** An SSE data frame carrying an OpenAI-style delta. */
function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const chunk of iterable) {
    out.push(chunk)
  }
  return out
}

const request: CompletionRequest = {
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hi' },
  ],
}

describe('OpenRouterProvider', () => {
  it('streams delta content across frames (happy path)', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([delta('Hello'), delta(', '), delta('world'), 'data: [DONE]\n\n']),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const chunks = await collect(provider.stream(request))

    expect(chunks).toEqual(['Hello', ', ', 'world'])
  })

  it('reassembles a data line split mid-line across network chunks', async () => {
    const frame = delta('spanned')
    const mid = Math.floor(frame.length / 2)
    const fetch = vi.fn(async () =>
      // Split one SSE frame at an arbitrary byte boundary.
      sseResponse([frame.slice(0, mid), frame.slice(mid), 'data: [DONE]\n\n']),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const chunks = await collect(provider.stream(request))

    expect(chunks).toEqual(['spanned'])
  })

  it('stops at [DONE] and ignores anything after it', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([delta('a'), 'data: [DONE]\n\n', delta('should-not-appear')]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const chunks = await collect(provider.stream(request))

    expect(chunks).toEqual(['a'])
  })

  it('ignores comments, empty deltas and keepalive lines', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        ': openrouter keepalive\n\n',
        delta(''), // empty delta content
        `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`, // no content field
        delta('real'),
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const chunks = await collect(provider.stream(request))

    expect(chunks).toEqual(['real'])
  })

  it('complete() concatenates the full stream', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([delta('foo'), delta('bar'), delta('baz'), 'data: [DONE]\n\n']),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const text = await provider.complete(request)

    expect(text).toBe('foobarbaz')
  })

  it('throws AiProviderError with status and body message on non-2xx', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
      }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    await expect(provider.complete(request)).rejects.toMatchObject({
      name: 'AiProviderError',
      status: 429,
      message: 'rate limited',
    })
    await expect(provider.complete(request)).rejects.toBeInstanceOf(AiProviderError)
  })

  it('propagates an abort mid-stream without wrapping it', async () => {
    const controller = new AbortController()

    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(encoder.encode(delta('first')))
          // Never close; abort should tear the stream down.
          signal.addEventListener('abort', () => {
            ctrl.error(new DOMException('Aborted', 'AbortError'))
          })
        },
      })
      return new Response(stream, { status: 200 })
    })

    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const received: string[] = []
    await expect(
      (async () => {
        for await (const chunk of provider.stream({ ...request, signal: controller.signal })) {
          received.push(chunk)
          controller.abort()
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(received).toEqual(['first'])
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('omits the Authorization header when no apiKey is given (proxy mode)', async () => {
    const fetch = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
    const provider = new OpenRouterProvider({ fetch })

    await provider.complete(request)

    const headers = fetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('sends a Bearer Authorization header when apiKey is given', async () => {
    const fetch = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
    const provider = new OpenRouterProvider({ apiKey: 'secret', fetch })

    await provider.complete(request)

    const headers = fetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer secret')
  })

  it('passes through custom baseUrl, model and headers', async () => {
    const fetch = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
    const provider = new OpenRouterProvider({
      apiKey: 'k',
      baseUrl: 'https://proxy.example/v1/',
      defaultModel: 'anthropic/claude-3.5-sonnet',
      headers: { 'X-Title': 'CoNote', 'HTTP-Referer': 'https://conote.example' },
      fetch,
    })

    await provider.complete({ ...request, model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 128 })

    const [url, init] = fetch.mock.calls[0]
    // Trailing slash on baseUrl is normalized.
    expect(url).toBe('https://proxy.example/v1/chat/completions')

    const headers = init.headers as Record<string, string>
    expect(headers['X-Title']).toBe('CoNote')
    expect(headers['HTTP-Referer']).toBe('https://conote.example')

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      model: 'openai/gpt-4o-mini', // request model overrides defaultModel
      temperature: 0.3,
      max_tokens: 128,
      stream: true,
      messages: request.messages,
    })
  })

  it('uses defaultModel when the request omits a model', async () => {
    const fetch = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
    const provider = new OpenRouterProvider({
      apiKey: 'k',
      defaultModel: 'anthropic/claude-3.5-sonnet',
      fetch,
    })

    await provider.complete(request)

    const body = JSON.parse(fetch.mock.calls[0][1].body as string)
    expect(body.model).toBe('anthropic/claude-3.5-sonnet')
  })
})
