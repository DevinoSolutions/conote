import { AiProviderError } from './errors.js'
import { SseLineParser } from './sse.js'
import type { ChatMessage, CompletionProvider, CompletionRequest } from './types.js'

export interface OpenRouterProviderOptions {
  /** Dev only — a key in the browser is unsafe for prod. Prefer a proxy via `baseUrl`. */
  apiKey?: string
  /** Default 'https://openrouter.ai/api/v1'; point at a proxy in prod. */
  baseUrl?: string
  /** Default 'anthropic/claude-3.5-haiku'. */
  defaultModel?: string
  /** Extra headers (e.g. HTTP-Referer, X-Title for OpenRouter). */
  headers?: Record<string, string>
  /** Injectable for tests. */
  fetch?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'anthropic/claude-3.5-haiku'

interface ChatCompletionBody {
  model: string
  messages: ChatMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
}

/**
 * OpenRouter completion provider. OpenRouter is OpenAI-chat-compatible, so this
 * adapter also works against any endpoint implementing that surface (including a
 * production proxy that injects the API key server-side).
 */
export class OpenRouterProvider implements CompletionProvider {
  private readonly apiKey?: string
  private readonly baseUrl: string
  private readonly defaultModel: string
  private readonly headers: Record<string, string>
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenRouterProviderOptions = {}) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL
    this.headers = options.headers ?? {}

    const fetchImpl = options.fetch ?? globalThis.fetch
    if (!fetchImpl) {
      throw new AiProviderError('No fetch implementation available; pass one via options.fetch')
    }
    // Preserve `this` binding for the global fetch.
    this.fetchImpl = options.fetch ?? fetchImpl.bind(globalThis)
  }

  async complete(request: CompletionRequest): Promise<string> {
    let result = ''
    for await (const chunk of this.stream(request)) {
      result += chunk
    }
    return result
  }

  async *stream(request: CompletionRequest): AsyncIterable<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildBody(request)),
      signal: request.signal,
    })

    if (!response.ok) {
      throw await toProviderError(response)
    }

    if (!response.body) {
      throw new AiProviderError('Response body is empty', response.status)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseLineParser()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        const text = decoder.decode(value, { stream: true })
        for (const data of parser.push(text)) {
          const chunk = this.readDelta(data)
          if (chunk === DONE) {
            return
          }
          if (chunk) {
            yield chunk
          }
        }
      }

      // Flush the decoder's remaining bytes, then any buffered final line that
      // was never newline-terminated.
      const tail = decoder.decode()
      if (tail) {
        for (const data of parser.push(tail)) {
          const chunk = this.readDelta(data)
          if (chunk === DONE) {
            return
          }
          if (chunk) {
            yield chunk
          }
        }
      }
      for (const data of parser.flush()) {
        const chunk = this.readDelta(data)
        if (chunk === DONE) {
          return
        }
        if (chunk) {
          yield chunk
        }
      }
    } finally {
      // Release the stream so an aborted/short-circuited read frees resources.
      reader.cancel().catch(() => {})
    }
  }

  private buildBody(request: CompletionRequest): ChatCompletionBody {
    const body: ChatCompletionBody = {
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      stream: true,
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }
    return body
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...this.headers,
    }
    // Proxy mode sends no key; the proxy injects it server-side.
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    return headers
  }

  /**
   * Parse one SSE `data` payload. Returns the DONE sentinel on `[DONE]`, the
   * delta text when present, or undefined for empty/keepalive frames.
   */
  private readDelta(data: string): string | typeof DONE | undefined {
    const trimmed = data.trim()
    if (trimmed === '') {
      return undefined
    }
    if (trimmed === '[DONE]') {
      return DONE
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Ignore frames that are not valid JSON (e.g. provider comments).
      return undefined
    }

    const content = (parsed as ChatCompletionChunk)?.choices?.[0]?.delta?.content
    return typeof content === 'string' && content.length > 0 ? content : undefined
  }
}

const DONE = Symbol('done')

interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string } }>
}

async function toProviderError(response: Response): Promise<AiProviderError> {
  let message = `Request failed with status ${response.status}`
  try {
    const text = await response.text()
    if (text) {
      try {
        const json = JSON.parse(text)
        const extracted = json?.error?.message ?? json?.message ?? json?.error
        if (typeof extracted === 'string' && extracted.length > 0) {
          message = extracted
        } else {
          message = text
        }
      } catch {
        message = text
      }
    }
  } catch {
    // Body already consumed or unreadable; keep the status-based message.
  }
  return new AiProviderError(message, response.status)
}
