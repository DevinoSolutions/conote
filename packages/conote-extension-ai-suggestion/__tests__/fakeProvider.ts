import type { CompletionProvider, CompletionRequest } from '@conote/ai-core'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>(res => {
    resolve = res
  })
  return { promise, resolve }
}

export interface FakeSuggestionProviderOptions {
  /** When set, `complete` waits for `open()` before resolving. */
  gated?: boolean
  /** Error rejected by `complete`. */
  error?: Error
}

/**
 * Scripted `CompletionProvider` for tests. Records requests and returns a canned
 * response string (or a factory), optionally gated so a test can control timing.
 */
export class FakeSuggestionProvider implements CompletionProvider {
  readonly calls: CompletionRequest[] = []
  private readonly gate: Deferred | null

  constructor(
    private readonly response: string | (() => string),
    private readonly options: FakeSuggestionProviderOptions = {},
  ) {
    this.gate = options.gated ? deferred() : null
  }

  get lastRequest(): CompletionRequest | undefined {
    return this.calls[this.calls.length - 1]
  }

  /** Release a gated `complete` call. */
  open(): void {
    this.gate?.resolve()
  }

  async complete(request: CompletionRequest): Promise<string> {
    this.calls.push(request)
    if (this.gate) {
      await this.gate.promise
    } else {
      await Promise.resolve()
    }
    if (this.options.error) {
      throw this.options.error
    }
    return typeof this.response === 'function' ? this.response() : this.response
  }

  // Deliberately an async generator that only throws: the provider contract makes `stream`
  // lazy, so the "not used" failure must surface on first iteration rather than at call time.
  // eslint-disable-next-line require-yield -- the stub throws instead of yielding, by design
  async *stream(): AsyncIterable<string> {
    throw new Error('FakeSuggestionProvider.stream is not used')
  }
}
