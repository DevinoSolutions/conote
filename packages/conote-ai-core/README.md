# @conote/ai-core

Provider-agnostic LLM completion layer with a built-in OpenRouter adapter. Zero runtime dependencies, editor-independent.

Part of **[CoNote](https://github.com/DevinoSolutions/CoNote)** — an open-source fork of [Tiptap](https://github.com/ueberdosis/tiptap) maintained by Devino that adds self-hostable AI editing features. This package is written from scratch and is not affiliated with or endorsed by Tiptap GmbH.

## Install

```bash
pnpm add @conote/ai-core
```

## Concepts

The core contract is `CompletionProvider`:

```ts
interface CompletionProvider {
  complete(request: CompletionRequest): Promise<string>
  stream(request: CompletionRequest): AsyncIterable<string>
}
```

Any backend can implement it; nothing downstream needs to know it is talking to OpenRouter. The bundled `OpenRouterProvider` speaks the OpenAI-compatible chat-completions protocol, so it also works against any endpoint that implements that surface — including a production proxy that injects your API key server-side.

## Usage

### Dev mode (direct key)

Only for local development — see the security note below.

```ts
import { OpenRouterProvider } from '@conote/ai-core'

const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultModel: 'anthropic/claude-haiku-4.5',
  headers: {
    'HTTP-Referer': 'https://your-app.example',
    'X-Title': 'Your App',
  },
})

// Streaming
for await (const chunk of provider.stream({
  messages: [
    { role: 'system', content: 'You are a concise assistant.' },
    { role: 'user', content: 'Give me three names for a note-taking app.' },
  ],
})) {
  process.stdout.write(chunk)
}

// Non-streaming (full text)
const text = await provider.complete({
  messages: [{ role: 'user', content: 'Say hello.' }],
})
```

### Proxy mode (production)

Point `baseUrl` at your own server, which holds the key and forwards to OpenRouter. No key is sent from the client, so no `Authorization` header is added.

```ts
const provider = new OpenRouterProvider({
  baseUrl: 'https://your-app.example/api/ai', // proxy exposing /chat/completions
})
```

### Abort

Pass an `AbortSignal`; aborting rejects/stops the request cleanly and the underlying `AbortError` propagates unwrapped.

```ts
const controller = new AbortController()
const stream = provider.stream({
  messages: [{ role: 'user', content: 'Write a long essay.' }],
  signal: controller.signal,
})
// controller.abort() to stop
```

## Tool calling (v0.2.0+)

`OpenRouterProvider` also implements `ChatCompletionProvider`, adding a non-streaming, tool-aware turn on top of the streaming completion surface:

```ts
interface ChatCompletionProvider extends CompletionProvider {
  chatComplete(request: ChatRequest): Promise<AssistantTurn>
}
```

You describe tools as JSON Schema and drive an agentic loop yourself: call `chatComplete`, run any tool calls it returns, feed the results back as messages, and repeat until it replies with plain content.

```ts
import { OpenRouterProvider } from '@conote/ai-core'
import type { AgentMessage, ToolDefinition } from '@conote/ai-core'

const provider = new OpenRouterProvider({ baseUrl: '/api/ai' })

const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get the current weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
]

const messages: AgentMessage[] = [{ role: 'user', content: 'What is the weather in Paris?' }]

const turn = await provider.chatComplete({ messages, tools })

if (turn.toolCalls.length > 0) {
  // Record the assistant's request, then answer each tool call.
  messages.push({ role: 'assistant', content: turn.content, toolCalls: turn.toolCalls })
  for (const call of turn.toolCalls) {
    // call.arguments is the JSON-parsed argument object ({} if the model sent malformed JSON).
    const result = runTool(call.name, call.arguments)
    messages.push({ role: 'tool', toolCallId: call.id, content: result })
  }
  // Call chatComplete again with the extended messages…
}
```

### Message and turn shapes

- `AgentMessage` is `ChatMessage | ToolResultMessage | AssistantToolCallMessage`.
- Tool results serialize to `{ role: 'tool', tool_call_id, content }`; assistant tool-call turns serialize to a `tool_calls: [{ id, type: 'function', function: { name, arguments } }]` array (`arguments` a JSON string).
- `AssistantTurn` is `{ content: string | null, toolCalls: ToolCall[], finishReason: string | null }`. A turn with tool calls usually has `content: null` and `finishReason: 'tool_calls'`.
- Each `ToolCall.arguments` is JSON-parsed defensively: a malformed argument string yields `{}` and sets `malformedArguments: true` rather than throwing.

`chatComplete` uses the same error and abort semantics as `complete()` — non-2xx throws `AiProviderError`, and an aborted `AbortSignal` rejects with the underlying `AbortError` unwrapped.

## Errors

Non-2xx responses throw `AiProviderError` with the HTTP `status` and a best-effort message extracted from the response body.

```ts
import { AiProviderError } from '@conote/ai-core'

try {
  await provider.complete({ messages: [{ role: 'user', content: 'Hi' }] })
} catch (err) {
  if (err instanceof AiProviderError) {
    console.error(err.status, err.message)
  }
}
```

## Security

Never ship an API key to a browser. The `apiKey` option is for local development and server-side use only. In production, run a proxy that holds `OPENROUTER_API_KEY` server-side and set `baseUrl` to it — the client sends no key.

## License

MIT
