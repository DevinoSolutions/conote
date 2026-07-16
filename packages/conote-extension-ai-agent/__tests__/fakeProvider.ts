import type {
  AssistantTurn,
  ChatCompletionProvider,
  ChatRequest,
  CompletionRequest,
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
