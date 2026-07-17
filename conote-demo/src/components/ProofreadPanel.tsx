import type { CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import type { AiSuggestionStorage } from '@conote/extension-ai-suggestion'
import type { AiChangesStorage } from '@conote/extension-ai-changes'
import { useEditorState } from '@tiptap/react'
import { RULE_COLORS, RULE_TITLES } from '../ai-config'
import { useAiTick } from '../hooks/useAiTick'
import { EditorPanel } from './EditorPanel'

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
 * Proofread workspace: the "Check document" bar, the editor surface, and the
 * sidebar of suggestion + change cards. The two lists (and their selected ids)
 * come from `useEditorState` — they only change on transactions — while the live
 * suggestion `state`/`error` scalars are read from storage under `useAiTick`.
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

  return (
    <div className="proofread">
      <div className="proofread-main">
        <div className="proofread-bar">
          <button
            data-testid="load-suggestions"
            className="primary"
            title="Send the document for proofreading"
            onClick={() => editor.commands.aiSuggestionLoad()}
          >
            Check document
          </button>
          <span className="label">Proofread:</span>
          <span className="state" data-testid="suggestion-status" data-state={suggestion.state}>
            {suggestion.state}
          </span>
          <span className="error" data-testid="suggestion-error">
            {suggestionError}
          </span>
        </div>
        <EditorPanel editor={editor} />
      </div>

      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>Suggestions</h2>
          <div className="sidebar-actions">
            <button
              data-testid="apply-all"
              title="Apply every suggestion"
              onClick={() => editor.chain().focus().aiSuggestionApplyAll().run()}
            >
              Apply all
            </button>
            <button
              data-testid="dismiss-all"
              title="Dismiss every suggestion"
              onClick={() => editor.chain().aiSuggestionClear().run()}
            >
              Dismiss all
            </button>
          </div>
        </div>

        <ul className="suggestion-list" data-testid="suggestion-list">
          {suggestions.length === 0 ? (
            <li className="suggestion-empty">
              {suggestion.state === 'loading'
                ? 'Checking…'
                : 'No suggestions. Click "Check document".'}
            </li>
          ) : (
            suggestions.map((item, index) => {
              const color = RULE_COLORS.get(item.ruleId) || '#e11d48'
              return (
                <li
                  key={item.id}
                  className={
                    'suggestion-card' +
                    (item.id === suggestionSelectedId ? ' suggestion-card--selected' : '')
                  }
                  data-testid={`suggestion-${index}`}
                  data-rule-id={item.ruleId}
                  style={{ '--rule-color': color } as CSSProperties}
                >
                  <button
                    type="button"
                    className="suggestion-body"
                    title="Highlight this suggestion in the document"
                    onClick={() => selectSuggestion(editor, item.id)}
                  >
                    <span className="suggestion-rule">
                      {RULE_TITLES.get(item.ruleId) ?? item.ruleId}
                    </span>
                    <span className="suggestion-diff">
                      <span className="suggestion-delete">{item.deleteText}</span>
                      <span className="suggestion-arrow">{' → '}</span>
                      <span className="suggestion-replacement">{item.replacementText}</span>
                    </span>
                    {item.note ? <span className="suggestion-note">{item.note}</span> : null}
                  </button>
                  <div className="suggestion-actions">
                    <button
                      className="accept"
                      data-testid={`accept-${index}`}
                      onClick={() => editor.chain().focus().aiSuggestionApply(item.id).run()}
                    >
                      Accept
                    </button>
                    <button
                      className="reject"
                      data-testid={`reject-${index}`}
                      onClick={() => editor.chain().aiSuggestionReject(item.id).run()}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              )
            })
          )}
        </ul>

        <div className="sidebar-head sidebar-head--changes">
          <h2>Changes</h2>
        </div>

        <ul className="change-list" data-testid="change-list">
          {changes.length === 0 ? (
            <li className="change-empty">
              {(editor.storage.aiChanges as AiChangesStorage).state === 'loading'
                ? 'Proposing…'
                : 'No changes. Type an instruction and propose.'}
            </li>
          ) : (
            changes.map((change, index) => (
              <li
                key={change.id}
                className={
                  'change-card' + (change.id === changeSelectedId ? ' change-card--selected' : '')
                }
                data-testid={`change-${index}`}
                data-change-id={change.id}
              >
                <button
                  type="button"
                  className="change-body"
                  title="Highlight this change in the document"
                  onClick={() => selectChange(editor, change.id)}
                >
                  <span className="change-diff">
                    <span className="change-delete">{change.oldText || '∅'}</span>
                    <span className="change-arrow">{' → '}</span>
                    <span className="change-insert">{change.newText || '∅'}</span>
                  </span>
                </button>
                <div className="change-actions">
                  <button
                    className="accept"
                    data-testid={`accept-change-${index}`}
                    onClick={() => editor.chain().focus().aiChangesAccept(change.id).run()}
                  >
                    Accept
                  </button>
                  <button
                    className="reject"
                    data-testid={`reject-change-${index}`}
                    onClick={() => editor.chain().aiChangesReject(change.id).run()}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </aside>
    </div>
  )
}
