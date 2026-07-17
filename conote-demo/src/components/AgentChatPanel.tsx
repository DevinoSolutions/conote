import type { Editor } from '@tiptap/core'
import type { AiAgentStorage } from '@conote/extension-ai-agent'
import { useEditorState } from '@tiptap/react'
import { useState } from 'react'
import { useAiTick } from '../hooks/useAiTick'

/**
 * Agent chat. The transcript (a list that only grows on transactions) comes from
 * `useEditorState` for its deep-equal memoization. The volatile scalars — live
 * `state`, `error`, and the in-flight `streamingText` — are read straight from
 * storage and kept fresh by `useAiTick`, which polls while the run is working.
 */
export function AgentChatPanel({ editor }: { editor: Editor }) {
  useAiTick(editor)
  const [message, setMessage] = useState('')

  const { transcript } = useEditorState({
    editor,
    selector: ({ editor }) => ({
      transcript: (editor.storage.aiAgent as AiAgentStorage).transcript,
    }),
  })

  const agent = editor.storage.aiAgent as AiAgentStorage
  const errorMessage = agent.state === 'error' && agent.error ? agent.error.message : ''
  const isWorking = agent.state === 'working'
  const showStreaming = isWorking && agent.streamingText.length > 0
  const showStagedHint = !isWorking && agent.lastStagedCount > 0

  const send = (): void => {
    const value = message.trim()
    if (value && (editor.storage.aiAgent as AiAgentStorage).state !== 'working') {
      editor.commands.aiAgentSend(value)
      setMessage('')
    }
  }

  return (
    <div className="agent">
      <div className="agent-head">
        <h2>Agent</h2>
        <span className="agent-state" data-testid="agent-status" data-state={agent.state}>
          {agent.state}
        </span>
        <span className="error" data-testid="agent-error">
          {errorMessage}
        </span>
      </div>

      <div className="agent-transcript" data-testid="agent-transcript">
        {transcript.length === 0 && !showStreaming ? (
          <div className="agent-empty">No messages yet. Ask the agent to edit the document.</div>
        ) : (
          transcript.map((turn, index) => (
            <div key={index} className={`agent-bubble agent-bubble--${turn.role}`}>
              {turn.content}
            </div>
          ))
        )}
        {showStreaming && (
          <div
            className="agent-bubble agent-bubble--assistant agent-bubble--streaming"
            data-testid="agent-streaming"
          >
            {agent.streamingText}
          </div>
        )}
      </div>

      <div className="agent-hint" data-testid="agent-staged-hint" hidden={!showStagedHint}>
        {showStagedHint
          ? `${agent.lastStagedCount} edit(s) staged — review them in the Changes panel.`
          : ''}
      </div>

      <div className="agent-bar">
        <input
          data-testid="agent-input"
          type="text"
          placeholder="Ask the agent to edit the document (e.g. 'fix the typos')"
          value={message}
          onChange={event => setMessage(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              send()
            }
          }}
        />
        <button
          data-testid="agent-send"
          className="primary"
          title="Send a message to the agent"
          disabled={isWorking}
          onClick={send}
        >
          Send
        </button>
        <button
          data-testid="agent-abort"
          className="danger"
          title="Abort the in-flight agent run"
          onClick={() => editor.commands.aiAgentAbort()}
        >
          Abort
        </button>
        <button
          data-testid="agent-reset"
          title="Clear the transcript"
          onClick={() => editor.commands.aiAgentReset()}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
