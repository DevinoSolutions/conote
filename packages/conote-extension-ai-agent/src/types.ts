import type { ChatCompletionProvider } from '@conote/ai-core'

/** How the agent's edits reach the document. */
export type AiAgentApplyMode = 'review' | 'direct'

/** Lifecycle of the agent loop, surfaced through storage for UI binding. */
export type AiAgentState = 'idle' | 'working' | 'error'

/** A user- or assistant-visible turn. Tool exchanges are internal and never stored here. */
export interface AiAgentTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Options for the AI agent extension. */
export interface AiAgentOptions {
  /** Provider that runs tool-aware chat turns (e.g. `OpenRouterProvider` from `@conote/ai-core`). */
  provider: ChatCompletionProvider
  /** Model passed to the provider on each turn. */
  defaultModel?: string
  /** Sampling temperature passed to the provider on each turn. */
  temperature?: number
  /** System prompt that frames the agent and its tools. Overrides the built-in default. */
  systemPrompt?: string
  /**
   * How edits are applied. `'review'` (default) accumulates edits and stages them
   * as tracked changes via the AiChanges extension's `aiChangesSet` command when
   * the loop finishes; `'direct'` applies each edit immediately via transactions.
   */
  applyMode?: AiAgentApplyMode
  /** Maximum chat turns before the loop gives up with an error. Default 8. */
  maxTurns?: number
}

/**
 * Extension storage. Bind UI to these fields. `transcript` holds only the
 * user/assistant-visible turns; the tool call/result exchanges are internal to
 * the loop and are not exposed.
 */
export interface AiAgentStorage {
  /** Current loop state. */
  state: AiAgentState
  /** Last error, set when `state` is `'error'`. Cleared when a new message is sent. */
  error: Error | null
  /** User/assistant conversation so far, in order. */
  transcript: AiAgentTurn[]
  /** Number of tracked changes staged by the most recent review-mode run. */
  lastStagedCount: number
}

declare module '@tiptap/core' {
  interface Storage {
    aiAgent: AiAgentStorage
  }

  interface Commands<ReturnType> {
    aiAgent: {
      /**
       * Send a user message and run the agent loop. Single-flight: returns `false`
       * while a run is in progress. In review mode, returns `false` with an error
       * state if the AiChanges extension (its `aiChangesSet` command) is absent.
       */
      aiAgentSend: (message: string) => ReturnType
      /** Abort the in-flight run. State returns to idle; the transcript keeps what completed. */
      aiAgentAbort: () => ReturnType
      /** Clear the transcript and reset state (aborts any in-flight run). */
      aiAgentReset: () => ReturnType
    }
  }
}
