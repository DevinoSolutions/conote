import type {
  AssistantTurn,
  ChatCompletionProvider,
  ChatRequest,
  ChatStreamEvent,
  CompletionRequest,
  StreamingChatCompletionProvider,
  ToolCall,
} from '@conote/ai-core'

/** A recorded request: the message list snapshotted at call time. */
export interface RecordedRequest {
  messages: ChatRequest['messages']
  tools: ChatRequest['tools']
}

export interface FakeChatProviderOptions {
  /** When true, each `chatComplete` waits for `open()` (or an abort) before resolving. */
  gated?: boolean
  /** Error thrown by `chatComplete` (after recording the request). */
  error?: Error
  /** Returned when the scripted queue is exhausted (defaults to a plain "done" reply). */
  fallback?: AssistantTurn
}

const PLAIN_DONE: AssistantTurn = { content: 'Done.', toolCalls: [], finishReason: 'stop' }

/**
 * Scripted `ChatCompletionProvider` for tests: returns a queue of `AssistantTurn`s
 * in order, records each request (snapshotting the message list), and can be
 * gated so a test controls timing and can abort mid-flight.
 */
export class FakeChatProvider implements ChatCompletionProvider {
  readonly calls: RecordedRequest[] = []
  private readonly queue: AssistantTurn[]
  private release: (() => void) | null = null

  constructor(
    turns: AssistantTurn[],
    private readonly options: FakeChatProviderOptions = {},
  ) {
    this.queue = [...turns]
  }

  get lastRequest(): RecordedRequest | undefined {
    return this.calls[this.calls.length - 1]
  }

  /** Release a gated `chatComplete` call. */
  open(): void {
    this.release?.()
    this.release = null
  }

  async chatComplete(request: ChatRequest): Promise<AssistantTurn> {
    this.calls.push({ messages: [...request.messages], tools: request.tools })

    if (this.options.gated) {
      await new Promise<void>((resolve, reject) => {
        this.release = resolve
        request.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    } else {
      await Promise.resolve()
    }

    if (request.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    if (this.options.error) {
      throw this.options.error
    }

    return this.queue.shift() ?? this.options.fallback ?? PLAIN_DONE
  }

  async complete(_request: CompletionRequest): Promise<string> {
    throw new Error('FakeChatProvider.complete is not used')
  }

  async *stream(): AsyncIterable<string> {
    throw new Error('FakeChatProvider.stream is not used')
  }
}

/** Builds an assistant turn that requests a single tool call. */
export function toolTurn(
  name: string,
  args: Record<string, unknown>,
  id = `call_${name}`,
): AssistantTurn {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: args }],
    finishReason: 'tool_calls',
  }
}

/** Builds a plain assistant reply turn. */
export function replyTurn(content: string): AssistantTurn {
  return { content, toolCalls: [], finishReason: 'stop' }
}

/** One scripted streaming turn: text deltas, then optional tool calls, then done. */
export interface ScriptedStreamTurn {
  /** Assistant text emitted as incremental `text` deltas. */
  textDeltas?: string[]
  /** Tool calls emitted in a single `toolCalls` event before `done`. */
  toolCalls?: ToolCall[]
  /** Provider finish reason on the `done` turn. Defaults to the tool/plain case. */
  finishReason?: string | null
}

export interface FakeStreamingProviderOptions {
  /** When true, each `chatStream` blocks after its text deltas until `open()` (or abort). */
  gated?: boolean
  /** Error thrown by `chatStream` after emitting its text deltas (before `done`). */
  error?: Error
}

/** A scripted streaming turn requesting a single tool call, with optional lead-in text. */
export function streamToolTurn(
  name: string,
  args: Record<string, unknown>,
  textDeltas?: string[],
  id = `call_${name}`,
): ScriptedStreamTurn {
  return { textDeltas, toolCalls: [{ id, name, arguments: args }] }
}

/** A scripted streaming plain reply, emitted as the given text deltas. */
export function streamReplyTurn(...textDeltas: string[]): ScriptedStreamTurn {
  return { textDeltas }
}

/**
 * Scripted `StreamingChatCompletionProvider` for tests: each `chatStream` call
 * emits the next turn's text deltas as `text` events, then a `toolCalls` event
 * (when any), then a `done` event with the assembled `AssistantTurn`. When gated,
 * it blocks after the text deltas until `open()` so a test can observe the
 * in-flight `streamingText` (or abort mid-stream).
 */
export class FakeStreamingChatProvider implements StreamingChatCompletionProvider {
  readonly calls: RecordedRequest[] = []
  private readonly queue: ScriptedStreamTurn[]
  private release: (() => void) | null = null

  constructor(
    turns: ScriptedStreamTurn[],
    private readonly options: FakeStreamingProviderOptions = {},
  ) {
    this.queue = [...turns]
  }

  /** Release a gated `chatStream` call so it can emit its `done` event. */
  open(): void {
    this.release?.()
    this.release = null
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.calls.push({ messages: [...request.messages], tools: request.tools })
    const turn = this.queue.shift() ?? { textDeltas: ['Done.'] }
    const deltas = turn.textDeltas ?? []

    for (const delta of deltas) {
      if (request.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      yield { type: 'text', delta }
    }

    if (this.options.gated) {
      await new Promise<void>((resolve, reject) => {
        this.release = resolve
        request.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    }
    if (request.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    if (this.options.error) {
      throw this.options.error
    }

    const toolCalls = turn.toolCalls ?? []
    const content = deltas.length > 0 ? deltas.join('') : null
    if (toolCalls.length > 0) {
      yield { type: 'toolCalls', toolCalls }
    }
    yield {
      type: 'done',
      turn: {
        content,
        toolCalls,
        finishReason: turn.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
      },
    }
  }

  async chatComplete(): Promise<AssistantTurn> {
    throw new Error('FakeStreamingChatProvider.chatComplete is not used')
  }

  async complete(_request: CompletionRequest): Promise<string> {
    throw new Error('FakeStreamingChatProvider.complete is not used')
  }

  async *stream(): AsyncIterable<string> {
    throw new Error('FakeStreamingChatProvider.stream is not used')
  }
}
