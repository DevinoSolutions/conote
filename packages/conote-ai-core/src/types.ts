export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionRequest {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface CompletionProvider {
  /** Resolves with the full completion text */
  complete(request: CompletionRequest): Promise<string>
  /** Yields incremental text chunks (plain strings) */
  stream(request: CompletionRequest): AsyncIterable<string>
}
