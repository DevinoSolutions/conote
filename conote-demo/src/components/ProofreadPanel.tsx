import type { CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import type { AiSuggestionStorage } from '@conote/extension-ai-suggestion'
import type { AiChangesStorage } from '@conote/extension-ai-changes'
import { useEditorState } from '@tiptap/react'
import { RULE_COLORS, RULE_TITLES } from '../ai-config'
import { useAiTick } from '../hooks/useAiTick'
import { IconCheck, IconDiff, IconProofread, IconX } from './icons'

/** Selects a suggestion and scrolls its decoration into view. */
function selectSuggestion(editor: Editor, id: string): void {
  editor.chain().aiSuggestionSelect(id).run()
  editor.view.dom
    .querySelector('.conote-ai-suggestion--selected')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** Selects a change and scrolls its inline decoration into view. */
function selectChange(editor: Editor, id: string): void {
  editor.chain().aiChangesSelect(id).run()
  editor.view.dom
    .querySelector('.conote-ai-change-del--selected, .conote-ai-change-ins--selected')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/**
 * Proofread workspace: the "Check document" action, the suggestion cards, and
 * the tracked-change cards (shared by Edit-with-AI and the agent). The two lists
 * (and their selected ids) come from `useEditorState` — they only change on
 * transactions — while the live suggestion `state`/`error` scalars are read from
 * storage under `useAiTick`.
 */
export function ProofreadPanel({ editor }: { editor: Editor }) {
  useAiTick(editor)

  const { suggestions, suggestionSelectedId, changes, changeSelectedId } = useEditorState({
    editor,
    selector: ({ editor }) => {
      const suggestion = editor.storage.aiSuggestion as AiSuggestionStorage
      const change = editor.storage.aiChanges as AiChangesStorage
      return {
        suggestions: suggestion.suggestions,
        suggestionSelectedId: suggestion.selectedId,
        changes: change.changes,
        changeSelectedId: change.selectedId,
      }
    },
  })

  const suggestion = editor.storage.aiSuggestion as AiSuggestionStorage
  const suggestionError =
    suggestion.state === 'error' && suggestion.error ? suggestion.error.message : ''
  const busy = suggestion.state !== 'idle' && suggestion.state !== 'error'
  const changesState = (editor.storage.aiChanges as AiChangesStorage).state

  return (
    <section className="panel panel--review">
      <header className="panel-head">
        <span className="panel-eyebrow">
          <IconProofread />
          Proofread
        </span>
        <span className={'statuspill' + (busy ? ' is-busy' : '')} data-state={suggestion.state}>
          <i className="dot" aria-hidden="true" />
          <span
            className="statuspill-text"
            data-testid="suggestion-status"
            data-state={suggestion.state}
          >
            {suggestion.state}
          </span>
        </span>
      </header>

      <div className="panel-body">
        <div className="review-run">
          <button
            data-testid="load-suggestions"
            className="btn btn--primary"
            title="Send the document for proofreading"
            onClick={() => editor.commands.aiSuggestionLoad()}
          >
            <IconProofread size={15} />
            <span>Check document</span>
          </button>
          <span className="status-error" data-testid="suggestion-error">
            {suggestionError}
          </span>
        </div>

        <div className="review-section">
          <div className="review-head">
            <h3 className="review-title">
              Suggestions
              {suggestions.length > 0 ? <span className="count">{suggestions.length}</span> : null}
            </h3>
            <div className="review-actions">
              <button
                data-testid="apply-all"
                className="linkbtn"
                title="Apply every suggestion"
                onClick={() => editor.chain().focus().aiSuggestionApplyAll().run()}
              >
                Apply all
              </button>
              <button
                data-testid="dismiss-all"
                className="linkbtn"
                title="Dismiss every suggestion"
                onClick={() => editor.chain().aiSuggestionClear().run()}
              >
                Dismiss all
              </button>
            </div>
          </div>

          <ul className="card-list" data-testid="suggestion-list">
            {suggestions.length === 0 ? (
              <li className="card-empty">
                {suggestion.state === 'loading'
                  ? 'Checking the document…'
                  : 'No suggestions yet. Run “Check document”.'}
              </li>
            ) : (
              suggestions.map((item, index) => {
                const color = RULE_COLORS.get(item.ruleId) || '#e11d48'
                return (
                  <li
                    key={item.id}
                    className={
                      'card sugg-card' + (item.id === suggestionSelectedId ? ' card--selected' : '')
                    }
                    data-testid={`suggestion-${index}`}
                    data-rule-id={item.ruleId}
                    style={{ '--rule-color': color } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="card-main"
                      title="Highlight this suggestion in the document"
                      onClick={() => selectSuggestion(editor, item.id)}
                    >
                      <span className="chip chip--rule">
                        {RULE_TITLES.get(item.ruleId) ?? item.ruleId}
                      </span>
                      <span className="diff">
                        <span className="diff-del">{item.deleteText}</span>
                        <span className="diff-arrow" aria-hidden="true">
                          →
                        </span>
                        <span className="diff-ins">{item.replacementText}</span>
                      </span>
                      {item.note ? <span className="card-note">{item.note}</span> : null}
                    </button>
                    <div className="card-actions">
                      <button
                        className="mini mini--ok"
                        data-testid={`accept-${index}`}
                        title="Apply this suggestion"
                        onClick={() => editor.chain().focus().aiSuggestionApply(item.id).run()}
                      >
                        <IconCheck size={13} />
                        <span>Accept</span>
                      </button>
                      <button
                        className="mini"
                        data-testid={`reject-${index}`}
                        title="Dismiss this suggestion"
                        onClick={() => editor.chain().aiSuggestionReject(item.id).run()}
                      >
                        <IconX size={13} />
                        <span>Reject</span>
                      </button>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </div>

        <div className="review-section">
          <div className="review-head">
            <h3 className="review-title">
              <IconDiff size={14} />
              Changes
              {changes.length > 0 ? <span className="count">{changes.length}</span> : null}
            </h3>
          </div>

          <ul className="card-list" data-testid="change-list">
            {changes.length === 0 ? (
              <li className="card-empty">
                {changesState === 'loading'
                  ? 'Proposing changes…'
                  : 'No changes staged. Use “Edit with AI” or the agent.'}
              </li>
            ) : (
              changes.map((change, index) => (
                <li
                  key={change.id}
                  className={
                    'card change-card' + (change.id === changeSelectedId ? ' card--selected' : '')
                  }
                  data-testid={`change-${index}`}
                  data-change-id={change.id}
                >
                  <button
                    type="button"
                    className="card-main"
                    title="Highlight this change in the document"
                    onClick={() => selectChange(editor, change.id)}
                  >
                    <span className="diff">
                      <span className="diff-del">{change.oldText || '∅'}</span>
                      <span className="diff-arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="diff-ins">{change.newText || '∅'}</span>
                    </span>
                  </button>
                  <div className="card-actions">
                    <button
                      className="mini mini--ok"
                      data-testid={`accept-change-${index}`}
                      title="Accept this change"
                      onClick={() => editor.chain().focus().aiChangesAccept(change.id).run()}
                    >
                      <IconCheck size={13} />
                      <span>Accept</span>
                    </button>
                    <button
                      className="mini"
                      data-testid={`reject-change-${index}`}
                      title="Reject this change"
                      onClick={() => editor.chain().aiChangesReject(change.id).run()}
                    >
                      <IconX size={13} />
                      <span>Reject</span>
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </section>
  )
}
