import type { Editor } from '@tiptap/core'
import type { AiStorage } from '@conote/extension-ai'
import { useState } from 'react'
import { useAiTick } from '../hooks/useAiTick'
import {
  IconContinue,
  IconRewrite,
  IconSend,
  IconStop,
  IconSummarize,
  IconTone,
  IconTranslate,
  IconWand,
} from './icons'

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
  const busy = ai.state !== 'idle' && ai.state !== 'error'

  const runCustom = (): void => {
    const prompt = customPrompt.trim()
    if (prompt) {
      editor.chain().focus().aiCustomPrompt(prompt).run()
    }
  }

  return (
    <section className="gen">
      <div className="gen-tools">
        <button
          data-testid="ai-continue"
          className="btn btn--primary"
          title="Continue writing from the cursor"
          onClick={() => editor.chain().focus().aiComplete().run()}
        >
          <IconContinue />
          <span>Continue writing</span>
        </button>

        <span className="tool-divider" aria-hidden="true" />

        <div className="tool-group" role="group" aria-label="Transform the selection">
          <button
            data-testid="ai-rewrite"
            className="btn"
            title="Rewrite the selection"
            onClick={() => editor.chain().focus().aiRewrite().run()}
          >
            <IconRewrite />
            <span>Rewrite</span>
          </button>
          <button
            data-testid="ai-summarize"
            className="btn"
            title="Summarize selection or document"
            onClick={() => editor.chain().focus().aiSummarize().run()}
          >
            <IconSummarize />
            <span>Summarize</span>
          </button>
          <button
            data-testid="ai-tone-professional"
            className="btn"
            title="Adjust selection to a professional tone"
            onClick={() => editor.chain().focus().aiAdjustTone('professional').run()}
          >
            <IconTone />
            <span>Professional</span>
          </button>
          <button
            data-testid="ai-tone-casual"
            className="btn"
            title="Adjust selection to a casual tone"
            onClick={() => editor.chain().focus().aiAdjustTone('casual').run()}
          >
            <IconTone />
            <span>Casual</span>
          </button>
          <button
            data-testid="ai-translate-french"
            className="btn"
            title="Translate selection to French"
            onClick={() => editor.chain().focus().aiTranslate('French').run()}
          >
            <IconTranslate />
            <span>French</span>
          </button>
        </div>

        <span className="tool-spacer" />

        <button
          data-testid="ai-abort"
          className="btn btn--danger"
          title="Abort the in-flight request"
          onClick={() => editor.chain().aiAbort().run()}
        >
          <IconStop />
          <span>Abort</span>
        </button>
      </div>

      <div className="gen-prompt">
        <div className="field">
          <IconWand className="field-lead" />
          <input
            data-testid="ai-custom-input"
            type="text"
            placeholder="Custom prompt — e.g. “add a suspenseful closing sentence”"
            value={customPrompt}
            onChange={event => setCustomPrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runCustom()
              }
            }}
          />
        </div>
        <button data-testid="ai-custom-submit" className="btn btn--solid" onClick={runCustom}>
          <IconSend />
          <span>Run prompt</span>
        </button>
      </div>

      <div className="gen-status">
        <span className="eyebrow">Generation</span>
        <span className={'statuspill' + (busy ? ' is-busy' : '')} data-state={ai.state}>
          <i className="dot" aria-hidden="true" />
          <span className="statuspill-text" data-testid="ai-status" data-state={ai.state}>
            {ai.state}
          </span>
        </span>
        <span className="status-error" data-testid="ai-error">
          {errorMessage}
        </span>
      </div>
    </section>
  )
}
