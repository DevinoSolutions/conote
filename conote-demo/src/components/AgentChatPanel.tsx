import type { Editor } from '@tiptap/core'
import type { AiAgentStorage } from '@conote/extension-ai-agent'
import { useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { useAiTick } from '../hooks/useAiTick'
import { IconChat, IconReset, IconSend, IconStop } from './icons'

/**
 * Agent chat. The transcript (a list that only grows on transactions) comes from
 * `useEditorState` for its deep-equal memoization. The volatile scalars — live
 * `state`, `error`, and the in-flight `streamingText` — are read straight from
 * storage and kept fresh by `useAiTick`, which polls while the run is working.
 */
export function AgentChatPanel({ editor }: { editor: Editor }) {
  useAiTick(editor)
  const [message, setMessage] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

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
  const showThinking = isWorking && !showStreaming
  const showStagedHint = !isWorking && agent.lastStagedCount > 0
  const isEmpty = transcript.length === 0 && !showStreaming && !showThinking

  // Keep the newest turn in view as the transcript grows or streams.
  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [transcript.length, agent.streamingText, showThinking])

  const send = (): void => {
    const value = message.trim()
    if (value && (editor.storage.aiAgent as AiAgentStorage).state !== 'working') {
      editor.commands.aiAgentSend(value)
      setMessage('')
    }
  }

  return (
    <section className="panel panel--agent">
      <header className="panel-head">
        <span className="panel-eyebrow">
          <IconChat />
          Agent
        </span>
        <span className={'statuspill' + (isWorking ? ' is-busy' : '')} data-state={agent.state}>
          <i className="dot" aria-hidden="true" />
          <span className="statuspill-text" data-testid="agent-status" data-state={agent.state}>
            {agent.state}
          </span>
        </span>
        <span className="status-error" data-testid="agent-error">
          {errorMessage}
        </span>
      </header>

      <div className="chat-log" data-testid="agent-transcript" ref={logRef}>
        {isEmpty ? (
          <div className="chat-empty">
            <IconChat size={22} />
            <p>
              Ask the agent to edit the document — “fix the typos” or “make paragraph two shorter”.
            </p>
          </div>
        ) : (
          transcript.map((turn, index) => (
            <div key={index} className={`msg msg--${turn.role}`}>
              <span className="msg-role">{turn.role === 'user' ? 'You' : 'Agent'}</span>
              <div className="msg-bubble">{turn.content}</div>
            </div>
          ))
        )}
        {showThinking && (
          <div className="msg msg--assistant">
            <span className="msg-role">Agent</span>
            <div className="msg-bubble msg-bubble--thinking" aria-label="Agent is working">
              <i className="typing-dot" />
              <i className="typing-dot" />
              <i className="typing-dot" />
            </div>
          </div>
        )}
        {showStreaming && (
          <div className="msg msg--assistant">
            <span className="msg-role">Agent</span>
            <div className="msg-bubble msg-bubble--streaming" data-testid="agent-streaming">
              {agent.streamingText}
              <span className="stream-caret" aria-hidden="true" />
            </div>
          </div>
        )}
      </div>

      <div className="staged-note" data-testid="agent-staged-hint" hidden={!showStagedHint}>
        {showStagedHint ? (
          <>
            <span className="staged-badge">{agent.lastStagedCount}</span>
            <span>
              edit{agent.lastStagedCount === 1 ? '' : 's'} staged — review them in{' '}
              <strong>Proofread → Changes</strong> below.
            </span>
          </>
        ) : (
          ''
        )}
      </div>

      <div className="chat-input">
        <div className="field">
          <input
            data-testid="agent-input"
            type="text"
            placeholder="Ask the agent to edit the document…"
            value={message}
            onChange={event => setMessage(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                send()
              }
            }}
          />
        </div>
        <button
          data-testid="agent-send"
          className="btn btn--primary btn--icon"
          title="Send a message to the agent"
          aria-label="Send message"
          disabled={isWorking}
          onClick={send}
        >
          <IconSend />
        </button>
        <button
          data-testid="agent-abort"
          className="btn btn--danger btn--icon"
          title="Abort the in-flight agent run"
          aria-label="Abort agent run"
          onClick={() => editor.commands.aiAgentAbort()}
        >
          <IconStop />
        </button>
        <button
          data-testid="agent-reset"
          className="btn btn--ghost btn--icon"
          title="Clear the transcript"
          aria-label="Clear the transcript"
          onClick={() => editor.commands.aiAgentReset()}
        >
          <IconReset />
        </button>
      </div>
    </section>
  )
}
