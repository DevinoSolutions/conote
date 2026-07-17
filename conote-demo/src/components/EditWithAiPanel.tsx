import type { Editor } from '@tiptap/core'
import type { AiChangesStorage } from '@conote/extension-ai-changes'
import { useState } from 'react'
import { useAiTick } from '../hooks/useAiTick'
import { IconCheck, IconWand, IconX } from './icons'

/**
 * "Edit with AI" controls: prompt an instruction, propose reviewable changes,
 * and accept/reject them all. The proposed changes themselves render as cards in
 * the Proofread panel (see ProofreadPanel → change list).
 */
export function EditWithAiPanel({ editor }: { editor: Editor }) {
  useAiTick(editor)
  const [prompt, setPrompt] = useState('')

  const changes = editor.storage.aiChanges as AiChangesStorage
  const errorMessage = changes.state === 'error' && changes.error ? changes.error.message : ''
  const busy = changes.state !== 'idle' && changes.state !== 'error'

  const propose = (): void => {
    const value = prompt.trim()
    if (value) {
      editor.chain().focus().aiChangesPropose({ prompt: value }).run()
    }
  }

  return (
    <section className="panel panel--edit">
      <header className="panel-head">
        <span className="panel-eyebrow">
          <IconWand />
          Edit with AI
        </span>
        <span className={'statuspill' + (busy ? ' is-busy' : '')} data-state={changes.state}>
          <i className="dot" aria-hidden="true" />
          <span className="statuspill-text" data-testid="changes-status" data-state={changes.state}>
            {changes.state}
          </span>
        </span>
      </header>

      <div className="panel-body">
        <p className="panel-hint">
          Describe an edit and preview it as tracked changes — nothing touches the document until
          you accept.
        </p>

        <div className="field-row">
          <div className="field">
            <input
              data-testid="change-prompt"
              type="text"
              placeholder="e.g. Make the text more formal"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  propose()
                }
              }}
            />
          </div>
          <button
            data-testid="propose-changes"
            className="btn btn--primary"
            title="Propose reviewable AI changes for the selection or document"
            onClick={propose}
          >
            Propose
          </button>
        </div>

        <span className="status-error" data-testid="changes-error">
          {errorMessage}
        </span>

        <div className="bulk-row">
          <button
            data-testid="accept-all-changes"
            className="btn btn--ok btn--sm"
            title="Accept every proposed change"
            onClick={() => editor.chain().focus().aiChangesAcceptAll().run()}
          >
            <IconCheck size={14} />
            <span>Accept all</span>
          </button>
          <button
            data-testid="reject-all-changes"
            className="btn btn--ghost btn--sm"
            title="Reject every proposed change"
            onClick={() => editor.chain().aiChangesRejectAll().run()}
          >
            <IconX size={14} />
            <span>Reject all</span>
          </button>
        </div>
      </div>
    </section>
  )
}
