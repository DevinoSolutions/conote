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

/**
 * A tool the model may call, described as JSON Schema. Maps to the OpenAI
 * `tools: [{ type: 'function', function: { name, description, parameters } }]` shape.
 */
export interface ToolDefinition {
  /** Function name the model uses to invoke the tool. */
  name: string
  /** Natural-language description of what the tool does and when to use it. */
  description: string
  /** JSON Schema for the tool's arguments object. */
  parameters: Record<string, unknown>
}

/**
 * A tool invocation requested by the model. `arguments` is the JSON-parsed
 * argument object; when the provider returned a malformed JSON string it is `{}`
 * and `malformedArguments` is `true`.
 */
export interface ToolCall {
  /** Provider-assigned id, echoed back on the matching tool result. */
  id: string
  /** Name of the tool to call. */
  name: string
  /** Parsed arguments object (`{}` when the model sent malformed JSON). */
  arguments: Record<string, unknown>
  /** Set when the raw `arguments` string could not be parsed as a JSON object. */
  malformedArguments?: boolean
}

/** The result of running a tool, fed back to the model on the next turn. */
export interface ToolResultMessage {
  role: 'tool'
  /** Id of the `ToolCall` this result answers. */
  toolCallId: string
  /** Tool output as a string (JSON-encode structured data yourself). */
  content: string
}

/** An assistant turn that requested one or more tool calls. */
export interface AssistantToolCallMessage {
  role: 'assistant'
  /** Any assistant text accompanying the tool calls; `null` when there is none. */
  content: string | null
  /** The tool calls the model requested. */
  toolCalls: ToolCall[]
}

/** A message in an agentic conversation: plain chat, tool result, or assistant tool-call turn. */
export type AgentMessage = ChatMessage | ToolResultMessage | AssistantToolCallMessage

/** A non-streaming chat request that may expose tools to the model. */
export interface ChatRequest {
  messages: AgentMessage[]
  /** Tools the model may call this turn. Omit for a plain completion. */
  tools?: ToolDefinition[]
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/** A single assistant turn: text, requested tool calls, and why generation stopped. */
export interface AssistantTurn {
  /** Assistant text, or `null` when the turn is only tool calls. */
  content: string | null
  /** Tool calls the model requested (empty when it produced a plain reply). */
  toolCalls: ToolCall[]
  /** Provider `finish_reason` (e.g. `'stop'`, `'tool_calls'`), or `null` if absent. */
  finishReason: string | null
}

/** A provider that additionally supports non-streaming tool-calling chat turns. */
export interface ChatCompletionProvider extends CompletionProvider {
  /** Runs one non-streaming chat turn and resolves with the assistant's reply. */
  chatComplete(request: ChatRequest): Promise<AssistantTurn>
}

/**
 * An event emitted while streaming a chat turn. Text arrives as incremental
 * `text` deltas; once generation stops, a single `toolCalls` event (when the
 * turn requested any) is followed by a terminal `done` event carrying the
 * fully assembled `AssistantTurn` — the same value `chatComplete` would return.
 */
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'toolCalls'; toolCalls: ToolCall[] }
  | { type: 'done'; turn: AssistantTurn }

/**
 * A `ChatCompletionProvider` that can additionally stream a tool-calling chat
 * turn, surfacing assistant text as it arrives before finishing with the same
 * assembled `AssistantTurn` that `chatComplete` produces.
 */
export interface StreamingChatCompletionProvider extends ChatCompletionProvider {
  /** Streams one chat turn: `text` deltas, then `toolCalls` (if any), then `done`. */
  chatStream(request: ChatRequest): AsyncIterable<ChatStreamEvent>
}
