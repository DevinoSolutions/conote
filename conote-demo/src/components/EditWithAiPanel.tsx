import type { Editor } from '@tiptap/core'
import type { AiChangesStorage } from '@conote/extension-ai-changes'
import { useState } from 'react'
import { useAiTick } from '../hooks/useAiTick'

/**
 * "Edit with AI" controls: prompt an instruction, propose reviewable changes,
 * and accept/reject them all. The proposed changes themselves render as cards in
 * the Proofread sidebar (see ProofreadPanel → ChangeList).
 */
export function EditWithAiPanel({ editor }: { editor: Editor }) {
  useAiTick(editor)
  const [prompt, setPrompt] = useState('')

  const changes = editor.storage.aiChanges as AiChangesStorage
  const errorMessage = changes.state === 'error' && changes.error ? changes.error.message : ''

  const propose = (): void => {
    const value = prompt.trim()
    if (value) {
      editor.chain().focus().aiChangesPropose({ prompt: value }).run()
    }
  }

  return (
    <div className="changes">
      <div className="changes-bar">
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
        <button
          data-testid="propose-changes"
          className="primary"
          title="Propose reviewable AI changes for the selection or document"
          onClick={propose}
        >
          Propose changes
        </button>
      </div>
      <div className="changes-status">
        <span className="label">Edit with AI:</span>
        <span className="state" data-testid="changes-status" data-state={changes.state}>
          {changes.state}
        </span>
        <span className="error" data-testid="changes-error">
          {errorMessage}
        </span>
        <span className="spacer"></span>
        <button
          data-testid="accept-all-changes"
          title="Accept every proposed change"
          onClick={() => editor.chain().focus().aiChangesAcceptAll().run()}
        >
          Accept all
        </button>
        <button
          data-testid="reject-all-changes"
          title="Reject every proposed change"
          onClick={() => editor.chain().aiChangesRejectAll().run()}
        >
          Reject all
        </button>
      </div>
    </div>
  )
}
