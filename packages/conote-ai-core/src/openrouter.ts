import { AiProviderError } from './errors.js'
import { SseLineParser } from './sse.js'
import type {
  AgentMessage,
  AssistantTurn,
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  CompletionRequest,
  StreamingChatCompletionProvider,
  ToolCall,
  ToolDefinition,
} from './types.js'

export interface OpenRouterProviderOptions {
  /** Dev only — a key in the browser is unsafe for prod. Prefer a proxy via `baseUrl`. */
  apiKey?: string
  /** Default 'https://openrouter.ai/api/v1'; point at a proxy in prod. */
  baseUrl?: string
  /** Default 'anthropic/claude-haiku-4.5'. */
  defaultModel?: string
  /** Extra headers (e.g. HTTP-Referer, X-Title for OpenRouter). */
  headers?: Record<string, string>
  /** Injectable for tests. */
  fetch?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'

interface ChatCompletionBody {
  model: string
  messages: ChatMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
}

/** OpenAI wire shape for a single message sent to `/chat/completions`. */
interface WireMessage {
  role: string
  content: string | null
  tool_call_id?: string
  tool_calls?: WireToolCall[]
}

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface WireTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

interface ChatBody {
  model: string
  messages: WireMessage[]
  stream: boolean
  tools?: WireTool[]
  temperature?: number
  max_tokens?: number
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: unknown }
      }>
    }
    finish_reason?: string | null
  }>
}

/**
 * OpenRouter completion provider. OpenRouter is OpenAI-chat-compatible, so this
 * adapter also works against any endpoint implementing that surface (including a
 * production proxy that injects the API key server-side).
 */
export class OpenRouterProvider implements StreamingChatCompletionProvider {
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

  /**
   * Runs one non-streaming, tool-aware chat turn. Messages are serialized to the
   * OpenAI wire shape (tool results as `{role:'tool', tool_call_id, content}`,
   * assistant tool-call turns with a `tool_calls` array) and the response is read
   * from `choices[0].message`, with each tool call's `arguments` JSON-parsed
   * defensively. Errors and aborts behave exactly like `complete()`.
   */
  async chatComplete(request: ChatRequest): Promise<AssistantTurn> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders('application/json'),
      body: JSON.stringify(this.buildChatBody(request, false)),
      signal: request.signal,
    })

    if (!response.ok) {
      throw await toProviderError(response)
    }

    const data = (await response.json()) as ChatCompletionResponse
    const choice = data?.choices?.[0]
    const message = choice?.message
    const content = typeof message?.content === 'string' ? message.content : null
    const toolCalls = (message?.tool_calls ?? []).map(parseToolCall)
    return { content, toolCalls, finishReason: choice?.finish_reason ?? null }
  }

  /**
   * Streams one tool-aware chat turn (`stream: true`). Assistant text is emitted
   * as `text` deltas the moment it arrives; OpenAI-wire `tool_calls` fragments are
   * reassembled by index (id/name arrive once, `function.arguments` accumulates as
   * string chunks). When generation stops, a single `toolCalls` event (if the turn
   * requested any) is emitted, then a terminal `done` event carrying the same
   * assembled `AssistantTurn` that `chatComplete` would return — its tool-call
   * arguments JSON-parsed defensively (malformed → `{}` + `malformedArguments`).
   * Errors and aborts behave exactly like `stream()`/`complete()`.
   */
  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildChatBody(request, true)),
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
    const state: ChatStreamState = {
      content: null,
      finishReason: null,
      tools: new ToolCallAccumulator(),
    }

    let finished = false
    try {
      while (!finished) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        const text = decoder.decode(value, { stream: true })
        for (const data of parser.push(text)) {
          const result = this.applyChatData(data, state)
          if (result.text !== undefined) {
            yield { type: 'text', delta: result.text }
          }
          if (result.done) {
            finished = true
            break
          }
        }
      }

      // Flush the decoder, then any buffered final line never newline-terminated.
      if (!finished) {
        const tail = decoder.decode()
        const remaining = tail ? parser.push(tail) : []
        for (const data of remaining.concat(parser.flush())) {
          const result = this.applyChatData(data, state)
          if (result.text !== undefined) {
            yield { type: 'text', delta: result.text }
          }
          if (result.done) {
            break
          }
        }
      }
    } finally {
      // Release the stream so an aborted/short-circuited read frees resources.
      reader.cancel().catch(() => {})
    }

    const toolCalls = state.tools.finalize()
    if (toolCalls.length > 0) {
      yield { type: 'toolCalls', toolCalls }
    }
    yield {
      type: 'done',
      turn: { content: state.content, toolCalls, finishReason: state.finishReason },
    }
  }

  /**
   * Folds one streamed SSE `data` payload into `state`, returning any assistant
   * text delta to emit and whether the `[DONE]` sentinel was seen.
   */
  private applyChatData(data: string, state: ChatStreamState): { text?: string; done?: boolean } {
    const chunk = this.readChatChunk(data)
    if (chunk === DONE) {
      return { done: true }
    }
    if (chunk === undefined) {
      return {}
    }
    if (chunk.toolCalls) {
      state.tools.push(chunk.toolCalls)
    }
    if (chunk.finishReason !== undefined) {
      state.finishReason = chunk.finishReason
    }
    if (chunk.content !== undefined && chunk.content.length > 0) {
      state.content = (state.content ?? '') + chunk.content
      return { text: chunk.content }
    }
    return {}
  }

  /**
   * Parse one streamed SSE `data` payload for chat. Returns the DONE sentinel on
   * `[DONE]`, the extracted delta fields when present, or undefined for
   * empty/keepalive/non-JSON frames.
   */
  private readChatChunk(data: string): ChatChunkFields | typeof DONE | undefined {
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

    const choice = (parsed as ChatCompletionStreamChunk)?.choices?.[0]
    const delta = choice?.delta
    return {
      content: typeof delta?.content === 'string' ? delta.content : undefined,
      toolCalls: Array.isArray(delta?.tool_calls) ? delta.tool_calls : undefined,
      finishReason: choice?.finish_reason ?? undefined,
    }
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

  private buildChatBody(request: ChatRequest, stream: boolean): ChatBody {
    const body: ChatBody = {
      model: request.model ?? this.defaultModel,
      messages: request.messages.map(toWireMessage),
      stream,
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toWireTool)
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }
    return body
  }

  private buildHeaders(accept = 'text/event-stream'): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: accept,
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

/** One streamed `tool_calls` fragment, keyed by `index` across chunks. */
interface WireToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/** A streamed chat chunk carrying text and/or tool-call fragments. */
interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: WireToolCallDelta[] }
    finish_reason?: string | null
  }>
}

/** The fields extracted from one streamed chat chunk. */
interface ChatChunkFields {
  content?: string
  toolCalls?: WireToolCallDelta[]
  finishReason?: string
}

/** Mutable accumulator state while streaming a chat turn. */
interface ChatStreamState {
  content: string | null
  finishReason: string | null
  tools: ToolCallAccumulator
}

interface ToolCallDraft {
  id: string
  name: string
  args: string
}

/**
 * Reassembles streamed OpenAI-wire `tool_calls` fragments. Each fragment is keyed
 * by its `index`: `id` and `function.name` arrive once, while `function.arguments`
 * accumulates as string chunks. `finalize()` JSON-parses each accumulated argument
 * string defensively via the same `parseToolCall` path as `chatComplete`.
 */
class ToolCallAccumulator {
  private readonly drafts = new Map<number, ToolCallDraft>()
  private readonly order: number[] = []

  push(deltas: WireToolCallDelta[]): void {
    for (let i = 0; i < deltas.length; i++) {
      const delta = deltas[i]
      // OpenAI always sends `index`; fall back to array position if it is absent.
      const index = typeof delta.index === 'number' ? delta.index : i
      let draft = this.drafts.get(index)
      if (!draft) {
        draft = { id: '', name: '', args: '' }
        this.drafts.set(index, draft)
        this.order.push(index)
      }
      if (typeof delta.id === 'string' && delta.id.length > 0) {
        draft.id = delta.id
      }
      const name = delta.function?.name
      if (typeof name === 'string' && name.length > 0) {
        draft.name = name
      }
      const args = delta.function?.arguments
      if (typeof args === 'string') {
        draft.args += args
      }
    }
  }

  finalize(): ToolCall[] {
    return this.order.map(index => {
      const draft = this.drafts.get(index) as ToolCallDraft
      return parseToolCall({
        id: draft.id,
        function: { name: draft.name, arguments: draft.args },
      })
    })
  }
}

/** Serializes an `AgentMessage` to the OpenAI wire shape. */
function toWireMessage(message: AgentMessage): WireMessage {
  if ('toolCalls' in message) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    }
  }
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
  }
  return { role: message.role, content: message.content }
}

/** Serializes a `ToolDefinition` to the OpenAI `tools` wire shape. */
function toWireTool(tool: ToolDefinition): WireTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }
}

/** Parses one wire tool call, defensively JSON-parsing its arguments string. */
function parseToolCall(raw: {
  id?: string
  function?: { name?: string; arguments?: unknown }
}): ToolCall {
  const rawArgs = raw?.function?.arguments
  let args: Record<string, unknown> = {}
  let malformed = false

  if (typeof rawArgs === 'string') {
    if (rawArgs.trim() !== '') {
      try {
        const parsed = JSON.parse(rawArgs)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>
        } else {
          malformed = true
        }
      } catch {
        malformed = true
      }
    }
  } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    // Some providers echo an already-parsed object rather than a JSON string.
    args = rawArgs as Record<string, unknown>
  }

  const call: ToolCall = {
    id: raw?.id ?? '',
    name: raw?.function?.name ?? '',
    arguments: args,
  }
  if (malformed) {
    call.malformedArguments = true
  }
  return call
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
