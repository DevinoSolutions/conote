import type { Editor } from '@tiptap/core'
import type { AiStorage } from '@conote/extension-ai'
import { useState } from 'react'
import { useAiTick } from '../hooks/useAiTick'

/**
 * Generation controls: the button toolbar, the custom-prompt row, and the live
 * status line. State/error are read directly from `editor.storage.ai` on every
 * tick (see useAiTick) so the status always reflects current storage.
 */
export function GenerationToolbar({ editor }: { editor: Editor }) {
  useAiTick(editor)
  const [customPrompt, setCustomPrompt] = useState('')

  const ai = editor.storage.ai as AiStorage
  const errorMessage = ai.state === 'error' && ai.error ? ai.error.message : ''

  const runCustom = (): void => {
    const prompt = customPrompt.trim()
    if (prompt) {
      editor.chain().focus().aiCustomPrompt(prompt).run()
    }
  }

  return (
    <>
      <div className="toolbar">
        <button
          data-testid="ai-continue"
          className="primary"
          title="Continue writing from the cursor"
          onClick={() => editor.chain().focus().aiComplete().run()}
        >
          Continue writing
        </button>
        <button
          data-testid="ai-rewrite"
          title="Rewrite the selection"
          onClick={() => editor.chain().focus().aiRewrite().run()}
        >
          Rewrite
        </button>
        <button
          data-testid="ai-summarize"
          title="Summarize selection or document"
          onClick={() => editor.chain().focus().aiSummarize().run()}
        >
          Summarize
        </button>
        <button
          data-testid="ai-tone-professional"
          title="Adjust selection to a professional tone"
          onClick={() => editor.chain().focus().aiAdjustTone('professional').run()}
        >
          Tone: professional
        </button>
        <button
          data-testid="ai-tone-casual"
          title="Adjust selection to a casual tone"
          onClick={() => editor.chain().focus().aiAdjustTone('casual').run()}
        >
          Tone: casual
        </button>
        <button
          data-testid="ai-translate-french"
          title="Translate selection to French"
          onClick={() => editor.chain().focus().aiTranslate('French').run()}
        >
          Translate: French
        </button>
        <button
          data-testid="ai-abort"
          className="danger"
          title="Abort the in-flight request"
          onClick={() => editor.chain().aiAbort().run()}
        >
          Abort
        </button>
      </div>

      <div className="custom">
        <input
          data-testid="ai-custom-input"
          type="text"
          placeholder="Custom prompt (e.g. 'add a suspenseful closing sentence')"
          value={customPrompt}
          onChange={event => setCustomPrompt(event.target.value)}
        />
        <button data-testid="ai-custom-submit" onClick={runCustom}>
          Run custom prompt
        </button>
      </div>

      <div className="status">
        <span className="label">Status:</span>
        <span className="state" data-testid="ai-status" data-state={ai.state}>
          {ai.state}
        </span>
        <span className="error" data-testid="ai-error">
          {errorMessage}
        </span>
      </div>
    </>
  )
}
