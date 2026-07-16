import { describe, expect, it, vi } from 'vitest'

import { AiProviderError, OpenRouterProvider } from '../src/index.js'
import type { ChatRequest, ChatStreamEvent, CompletionRequest } from '../src/index.js'

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
    const fetch = vi.fn(
      async () =>
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

    await provider.complete({
      ...request,
      model: 'openai/gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 128,
    })

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

/** A non-streaming JSON chat-completions response. */
function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const chatRequest: ChatRequest = {
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Rewrite the note.' },
  ],
}

describe('OpenRouterProvider.chatComplete', () => {
  it('parses a plain assistant reply and finishReason', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }],
      }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const turn = await provider.chatComplete(chatRequest)

    expect(turn).toEqual({ content: 'Done.', toolCalls: [], finishReason: 'stop' })
    // Non-streaming request.
    const body = JSON.parse(fetch.mock.calls[0][1].body as string)
    expect(body.stream).toBe(false)
    // JSON, not SSE.
    const headers = fetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Accept).toBe('application/json')
  })

  it('parses tool calls with JSON-string arguments', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'replace_text', arguments: '{"find":"cat","replace":"dog"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const turn = await provider.chatComplete(chatRequest)

    expect(turn.content).toBeNull()
    expect(turn.finishReason).toBe('tool_calls')
    expect(turn.toolCalls).toEqual([
      { id: 'call_1', name: 'replace_text', arguments: { find: 'cat', replace: 'dog' } },
    ])
  })

  it('falls back to {} and flags malformed tool-call arguments', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'c',
                  type: 'function',
                  function: { name: 'read_document', arguments: '{not json' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const turn = await provider.chatComplete(chatRequest)

    expect(turn.toolCalls[0].arguments).toEqual({})
    expect(turn.toolCalls[0].malformedArguments).toBe(true)
  })

  it('treats empty-string arguments as {} without flagging them malformed', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c', function: { name: 'read_document', arguments: '' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const turn = await provider.chatComplete(chatRequest)

    expect(turn.toolCalls[0].arguments).toEqual({})
    expect(turn.toolCalls[0].malformedArguments).toBeUndefined()
  })

  it('serializes tool results and assistant tool-call turns to the wire shape', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    await provider.chatComplete({
      messages: [
        { role: 'user', content: 'Fix it.' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'call_9', name: 'replace_text', arguments: { find: 'a', replace: 'b' } },
          ],
        },
        { role: 'tool', toolCallId: 'call_9', content: 'Replaced "a" with "b".' },
      ],
      tools: [
        {
          name: 'replace_text',
          description: 'Replace text.',
          parameters: { type: 'object', properties: { find: { type: 'string' } } },
        },
      ],
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body as string)

    // Assistant tool-call turn.
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_9',
          type: 'function',
          function: { name: 'replace_text', arguments: '{"find":"a","replace":"b"}' },
        },
      ],
    })
    // Tool result.
    expect(body.messages[2]).toEqual({
      role: 'tool',
      content: 'Replaced "a" with "b".',
      tool_call_id: 'call_9',
    })
    // Tools serialized under function envelopes.
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'replace_text',
          description: 'Replace text.',
          parameters: { type: 'object', properties: { find: { type: 'string' } } },
        },
      },
    ])
  })

  it('omits tools from the body when none are provided', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    await provider.chatComplete(chatRequest)

    const body = JSON.parse(fetch.mock.calls[0][1].body as string)
    expect(body.tools).toBeUndefined()
  })

  it('throws AiProviderError with status and message on non-2xx', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    await expect(provider.chatComplete(chatRequest)).rejects.toMatchObject({
      name: 'AiProviderError',
      status: 400,
      message: 'bad request',
    })
    await expect(provider.chatComplete(chatRequest)).rejects.toBeInstanceOf(AiProviderError)
  })

  it('propagates an abort without wrapping it', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const promise = provider.chatComplete({ ...chatRequest, signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

/** An SSE data frame carrying a streamed chat chunk (delta + optional finish_reason). */
function chatFrame(delta: unknown, finishReason?: string | null): string {
  const choice: Record<string, unknown> = { delta }
  if (finishReason !== undefined) {
    choice.finish_reason = finishReason
  }
  return `data: ${JSON.stringify({ choices: [choice] })}\n\n`
}

async function collectEvents(iterable: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const event of iterable) {
    out.push(event)
  }
  return out
}

describe('OpenRouterProvider.chatStream', () => {
  it('streams a text-only turn and finishes with a done event', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        chatFrame({ content: 'Hello' }),
        chatFrame({ content: ', world' }),
        chatFrame({}, 'stop'),
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const events = await collectEvents(provider.chatStream(chatRequest))

    expect(events).toEqual([
      { type: 'text', delta: 'Hello' },
      { type: 'text', delta: ', world' },
      { type: 'done', turn: { content: 'Hello, world', toolCalls: [], finishReason: 'stop' } },
    ])
    // Streaming request advertising tools would set stream:true; here no tools.
    const body = JSON.parse(fetch.mock.calls[0][1].body as string)
    expect(body.stream).toBe(true)
    const headers = fetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Accept).toBe('text/event-stream')
  })

  it('reassembles a tool call from index-keyed fragments', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        // id and name arrive once; arguments accumulate across chunks.
        chatFrame({
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'replace_text', arguments: '' },
            },
          ],
        }),
        chatFrame({ tool_calls: [{ index: 0, function: { arguments: '{"find":"ca' } }] }),
        chatFrame({ tool_calls: [{ index: 0, function: { arguments: 't","replace":"dog"}' } }] }),
        chatFrame({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const events = await collectEvents(
      provider.chatStream({
        ...chatRequest,
        tools: [{ name: 'replace_text', description: 'x', parameters: {} }],
      }),
    )

    const toolCalls = [
      { id: 'call_1', name: 'replace_text', arguments: { find: 'cat', replace: 'dog' } },
    ]
    expect(events).toEqual([
      { type: 'toolCalls', toolCalls },
      { type: 'done', turn: { content: null, toolCalls, finishReason: 'tool_calls' } },
    ])
    // Tools serialized into the streaming body.
    const body = JSON.parse(fetch.mock.calls[0][1].body as string)
    expect(body.stream).toBe(true)
    expect(body.tools[0].function.name).toBe('replace_text')
  })

  it('reassembles multiple tool calls keyed by index', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        chatFrame({
          tool_calls: [
            { index: 0, id: 'a', function: { name: 'replace_text', arguments: '{"find":"x"' } },
          ],
        }),
        chatFrame({
          tool_calls: [
            {
              index: 1,
              id: 'b',
              function: { name: 'insert_text', arguments: '{"position":"end"' },
            },
          ],
        }),
        chatFrame({ tool_calls: [{ index: 0, function: { arguments: ',"replace":"y"}' } }] }),
        chatFrame({ tool_calls: [{ index: 1, function: { arguments: ',"text":"!"}' } }] }),
        chatFrame({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const events = await collectEvents(provider.chatStream(chatRequest))
    const toolEvent = events.find(e => e.type === 'toolCalls') as Extract<
      ChatStreamEvent,
      { type: 'toolCalls' }
    >

    expect(toolEvent.toolCalls).toEqual([
      { id: 'a', name: 'replace_text', arguments: { find: 'x', replace: 'y' } },
      { id: 'b', name: 'insert_text', arguments: { position: 'end', text: '!' } },
    ])
  })

  it('emits text deltas and then tool calls for a mixed turn', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        chatFrame({ content: 'Let me fix that. ' }),
        chatFrame({
          tool_calls: [
            { index: 0, id: 'c1', function: { name: 'read_document', arguments: '{}' } },
          ],
        }),
        chatFrame({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const events = await collectEvents(provider.chatStream(chatRequest))

    const toolCalls = [{ id: 'c1', name: 'read_document', arguments: {} }]
    expect(events).toEqual([
      { type: 'text', delta: 'Let me fix that. ' },
      { type: 'toolCalls', toolCalls },
      {
        type: 'done',
        turn: { content: 'Let me fix that. ', toolCalls, finishReason: 'tool_calls' },
      },
    ])
  })

  it('flags malformed accumulated tool-call arguments as chatComplete does', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        chatFrame({
          tool_calls: [
            { index: 0, id: 'c', function: { name: 'read_document', arguments: '{not ' } },
          ],
        }),
        chatFrame({ tool_calls: [{ index: 0, function: { arguments: 'json' } }] }),
        chatFrame({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const events = await collectEvents(provider.chatStream(chatRequest))
    const done = events.find(e => e.type === 'done') as Extract<ChatStreamEvent, { type: 'done' }>

    expect(done.turn.toolCalls[0].arguments).toEqual({})
    expect(done.turn.toolCalls[0].malformedArguments).toBe(true)
  })

  it('reassembles a chat frame split mid-line across network chunks', async () => {
    const frame = chatFrame({ content: 'spanned' })
    const mid = Math.floor(frame.length / 2)
    const fetch = vi.fn(async () =>
      sseResponse([
        frame.slice(0, mid),
        frame.slice(mid),
        chatFrame({}, 'stop'),
        'data: [DONE]\n\n',
      ]),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const events = await collectEvents(provider.chatStream(chatRequest))

    expect(events).toEqual([
      { type: 'text', delta: 'spanned' },
      { type: 'done', turn: { content: 'spanned', toolCalls: [], finishReason: 'stop' } },
    ])
  })

  it('throws AiProviderError with status and message on non-2xx', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 503 }),
    )
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    await expect(collectEvents(provider.chatStream(chatRequest))).rejects.toMatchObject({
      name: 'AiProviderError',
      status: 503,
      message: 'nope',
    })
  })

  it('propagates an abort mid-stream without wrapping it', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(encoder.encode(chatFrame({ content: 'first' })))
          signal.addEventListener('abort', () => {
            ctrl.error(new DOMException('Aborted', 'AbortError'))
          })
        },
      })
      return new Response(stream, { status: 200 })
    })
    const provider = new OpenRouterProvider({ apiKey: 'k', fetch })

    const received: ChatStreamEvent[] = []
    await expect(
      (async () => {
        for await (const event of provider.chatStream({
          ...chatRequest,
          signal: controller.signal,
        })) {
          received.push(event)
          controller.abort()
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // The first text delta was surfaced before the abort tore the stream down;
    // no toolCalls/done events were emitted.
    expect(received).toEqual([{ type: 'text', delta: 'first' }])
  })
})
