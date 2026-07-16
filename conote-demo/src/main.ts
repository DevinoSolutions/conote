import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { OpenRouterProvider } from '@conote/ai-core'
import { Ai } from '@conote/extension-ai'
import type { AiStorage } from '@conote/extension-ai'
import { AiSuggestion } from '@conote/extension-ai-suggestion'
import type { AiSuggestionRule, AiSuggestionStorage } from '@conote/extension-ai-suggestion'
import { AiChanges } from '@conote/extension-ai-changes'
import type { AiChangesStorage } from '@conote/extension-ai-changes'
import { AiAgent } from '@conote/extension-ai-agent'
import type { AiAgentStorage } from '@conote/extension-ai-agent'
import './style.css'

// Proxy mode: no apiKey in the browser. The provider posts to the local proxy,
// which injects the OpenRouter key server-side. baseUrl + '/chat/completions'
// resolves to http://localhost:8787/api/chat/completions.
const provider = new OpenRouterProvider({
  baseUrl: 'http://localhost:8787/api',
  defaultModel: 'anthropic/claude-haiku-4.5',
})

const SAMPLE_CONTENT = `
  <p>Last week our team recieved the final report, and we where definately impressed by the results. If we could of started sooner, the outcome might have been even better.</p>
  <p>The committee shared there feedback with the group. Due to the fact that we had a large amount of time at our disposal, we were able to carefully and thoroughly review each and every single section of the document in great detail.</p>
`

// Two proofreading rules exercised by the "Proofread" panel below. Colors match
// the decoration styling in style.css (via the --conote-ai-suggestion-color var).
const SUGGESTION_RULES: AiSuggestionRule[] = [
  {
    id: 'grammar',
    title: 'Spelling & grammar',
    prompt: 'Fix spelling mistakes and grammatical errors.',
    color: '#e11d48',
  },
  {
    id: 'concise',
    title: 'Conciseness',
    prompt: 'Suggest more concise phrasing for wordy passages.',
    color: '#2563eb',
  },
]

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="wrap">
    <header>
      <h1>CoNote Demo</h1>
      <p>AI Generation and Proofreading for Tiptap, streamed through a self-hosted proxy. Select text, then try the tools below, or run "Check document" to proofread.</p>
    </header>

    <div class="toolbar">
      <button id="btn-continue" data-testid="ai-continue" class="primary" title="Continue writing from the cursor">Continue writing</button>
      <button id="btn-rewrite" data-testid="ai-rewrite" title="Rewrite the selection">Rewrite</button>
      <button id="btn-summarize" data-testid="ai-summarize" title="Summarize selection or document">Summarize</button>
      <button id="btn-tone-professional" data-testid="ai-tone-professional" title="Adjust selection to a professional tone">Tone: professional</button>
      <button id="btn-tone-casual" data-testid="ai-tone-casual" title="Adjust selection to a casual tone">Tone: casual</button>
      <button id="btn-translate-french" data-testid="ai-translate-french" title="Translate selection to French">Translate: French</button>
      <button id="btn-abort" data-testid="ai-abort" class="danger" title="Abort the in-flight request">Abort</button>
    </div>

    <div class="custom">
      <input id="custom-input" data-testid="ai-custom-input" type="text" placeholder="Custom prompt (e.g. 'add a suspenseful closing sentence')" />
      <button id="btn-custom" data-testid="ai-custom-submit">Run custom prompt</button>
    </div>

    <div class="status">
      <span class="label">Status:</span>
      <span class="state" id="ai-status" data-testid="ai-status" data-state="idle">idle</span>
      <span class="error" id="ai-error" data-testid="ai-error"></span>
    </div>

    <div class="changes">
      <div class="changes-bar">
        <input id="change-prompt" data-testid="change-prompt" type="text" placeholder="e.g. Make the text more formal" />
        <button id="propose-changes" data-testid="propose-changes" class="primary" title="Propose reviewable AI changes for the selection or document">Propose changes</button>
      </div>
      <div class="changes-status">
        <span class="label">Edit with AI:</span>
        <span class="state" id="changes-status" data-testid="changes-status" data-state="idle">idle</span>
        <span class="error" id="changes-error" data-testid="changes-error"></span>
        <span class="spacer"></span>
        <button id="accept-all-changes" data-testid="accept-all-changes" title="Accept every proposed change">Accept all</button>
        <button id="reject-all-changes" data-testid="reject-all-changes" title="Reject every proposed change">Reject all</button>
      </div>
    </div>

    <div class="agent">
      <div class="agent-head">
        <h2>Agent</h2>
        <span class="agent-state" id="agent-status" data-testid="agent-status" data-state="idle">idle</span>
        <span class="error" id="agent-error" data-testid="agent-error"></span>
      </div>
      <div class="agent-transcript" id="agent-transcript" data-testid="agent-transcript"></div>
      <div class="agent-hint" id="agent-staged-hint" data-testid="agent-staged-hint" hidden></div>
      <div class="agent-bar">
        <input id="agent-input" data-testid="agent-input" type="text" placeholder="Ask the agent to edit the document (e.g. 'fix the typos')" />
        <button id="agent-send" data-testid="agent-send" class="primary" title="Send a message to the agent">Send</button>
        <button id="agent-abort" data-testid="agent-abort" class="danger" title="Abort the in-flight agent run">Abort</button>
        <button id="agent-reset" data-testid="agent-reset" title="Clear the transcript">Reset</button>
      </div>
    </div>

    <div class="proofread">
      <div class="proofread-main">
        <div class="proofread-bar">
          <button id="load-suggestions" data-testid="load-suggestions" class="primary" title="Send the document for proofreading">Check document</button>
          <span class="label">Proofread:</span>
          <span class="state" id="suggestion-status" data-testid="suggestion-status" data-state="idle">idle</span>
          <span class="error" id="suggestion-error" data-testid="suggestion-error"></span>
        </div>
        <div class="editor" id="editor"></div>
      </div>
      <aside class="sidebar">
        <div class="sidebar-head">
          <h2>Suggestions</h2>
          <div class="sidebar-actions">
            <button id="apply-all" data-testid="apply-all" title="Apply every suggestion">Apply all</button>
            <button id="dismiss-all" data-testid="dismiss-all" title="Dismiss every suggestion">Dismiss all</button>
          </div>
        </div>
        <ul class="suggestion-list" id="suggestion-list" data-testid="suggestion-list"></ul>
        <div class="sidebar-head sidebar-head--changes">
          <h2>Changes</h2>
        </div>
        <ul class="change-list" id="change-list" data-testid="change-list"></ul>
      </aside>
    </div>

    <footer>
      Part of <strong>CoNote</strong>, an open-source fork of Tiptap. Not affiliated with or endorsed by Tiptap GmbH. MIT licensed.
    </footer>
  </div>
`

const editor = new Editor({
  element: document.querySelector<HTMLElement>('#editor')!,
  extensions: [
    StarterKit,
    Ai.configure({
      provider,
      defaultModel: 'anthropic/claude-haiku-4.5',
    }),
    AiSuggestion.configure({
      provider,
      defaultModel: 'anthropic/claude-haiku-4.5',
      rules: SUGGESTION_RULES,
    }),
    AiChanges.configure({
      provider,
      defaultModel: 'anthropic/claude-haiku-4.5',
    }),
    AiAgent.configure({
      provider,
      defaultModel: 'anthropic/claude-haiku-4.5',
      applyMode: 'review',
    }),
  ],
  content: SAMPLE_CONTENT,
  autofocus: 'end',
})

const RULE_TITLES = new Map(SUGGESTION_RULES.map(rule => [rule.id, rule.title]))
const RULE_COLORS = new Map(SUGGESTION_RULES.map(rule => [rule.id, rule.color ?? '']))

// Expose for debugging / automated browser testing.
;(window as unknown as { editor: Editor }).editor = editor

const statusEl = document.querySelector<HTMLElement>('#ai-status')!
const errorEl = document.querySelector<HTMLElement>('#ai-error')!

function renderStatus(): void {
  const storage = editor.storage.ai as AiStorage
  statusEl.textContent = storage.state
  statusEl.dataset.state = storage.state
  errorEl.textContent = storage.state === 'error' && storage.error ? storage.error.message : ''
}

// State transitions are accompanied by dispatched transactions; a light poll
// covers any async edge so the status line always reflects current storage.
editor.on('transaction', renderStatus)
editor.on('update', renderStatus)
window.setInterval(renderStatus, 150)
renderStatus()

function on(id: string, handler: () => void): void {
  document.querySelector<HTMLButtonElement>(id)!.addEventListener('click', handler)
}

on('#btn-continue', () => editor.chain().focus().aiComplete().run())
on('#btn-rewrite', () => editor.chain().focus().aiRewrite().run())
on('#btn-summarize', () => editor.chain().focus().aiSummarize().run())
on('#btn-tone-professional', () => editor.chain().focus().aiAdjustTone('professional').run())
on('#btn-tone-casual', () => editor.chain().focus().aiAdjustTone('casual').run())
on('#btn-translate-french', () => editor.chain().focus().aiTranslate('French').run())
on('#btn-abort', () => editor.chain().aiAbort().run())

const customInput = document.querySelector<HTMLInputElement>('#custom-input')!
on('#btn-custom', () => {
  const prompt = customInput.value.trim()
  if (prompt) {
    editor.chain().focus().aiCustomPrompt(prompt).run()
  }
})

// --- Proofread panel -------------------------------------------------------

const suggestionStatusEl = document.querySelector<HTMLElement>('#suggestion-status')!
const suggestionErrorEl = document.querySelector<HTMLElement>('#suggestion-error')!
const suggestionListEl = document.querySelector<HTMLUListElement>('#suggestion-list')!

on('#load-suggestions', () => editor.commands.aiSuggestionLoad())
on('#apply-all', () => editor.chain().focus().aiSuggestionApplyAll().run())
on('#dismiss-all', () => editor.chain().aiSuggestionClear().run())

/** Selects a suggestion and scrolls its decoration into view. */
function selectSuggestion(id: string): void {
  editor.chain().aiSuggestionSelect(id).run()
  const decoration = editor.view.dom.querySelector('.conote-ai-suggestion--selected')
  decoration?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** Builds one suggestion card. `index` drives the accept/reject test ids. */
function renderCard(
  suggestion: AiSuggestionStorage['suggestions'][number],
  index: number,
  selectedId: string | null,
): HTMLLIElement {
  const card = document.createElement('li')
  card.className = 'suggestion-card'
  card.dataset.testid = `suggestion-${index}`
  card.dataset.ruleId = suggestion.ruleId
  if (suggestion.id === selectedId) {
    card.classList.add('suggestion-card--selected')
  }
  const color = RULE_COLORS.get(suggestion.ruleId) || '#e11d48'
  card.style.setProperty('--rule-color', color)

  const body = document.createElement('button')
  body.type = 'button'
  body.className = 'suggestion-body'
  body.title = 'Highlight this suggestion in the document'
  body.addEventListener('click', () => selectSuggestion(suggestion.id))

  const title = document.createElement('span')
  title.className = 'suggestion-rule'
  title.textContent = RULE_TITLES.get(suggestion.ruleId) ?? suggestion.ruleId
  body.appendChild(title)

  const diff = document.createElement('span')
  diff.className = 'suggestion-diff'
  const del = document.createElement('span')
  del.className = 'suggestion-delete'
  del.textContent = suggestion.deleteText
  const arrow = document.createElement('span')
  arrow.className = 'suggestion-arrow'
  arrow.textContent = ' → '
  const repl = document.createElement('span')
  repl.className = 'suggestion-replacement'
  repl.textContent = suggestion.replacementText
  diff.append(del, arrow, repl)
  body.appendChild(diff)

  if (suggestion.note) {
    const note = document.createElement('span')
    note.className = 'suggestion-note'
    note.textContent = suggestion.note
    body.appendChild(note)
  }
  card.appendChild(body)

  const actions = document.createElement('div')
  actions.className = 'suggestion-actions'
  const accept = document.createElement('button')
  accept.className = 'accept'
  accept.dataset.testid = `accept-${index}`
  accept.textContent = 'Accept'
  accept.addEventListener('click', () =>
    editor.chain().focus().aiSuggestionApply(suggestion.id).run(),
  )
  const reject = document.createElement('button')
  reject.className = 'reject'
  reject.dataset.testid = `reject-${index}`
  reject.textContent = 'Reject'
  reject.addEventListener('click', () => editor.chain().aiSuggestionReject(suggestion.id).run())
  actions.append(accept, reject)
  card.appendChild(actions)

  return card
}

function renderSuggestions(): void {
  const storage = editor.storage.aiSuggestion as AiSuggestionStorage
  suggestionStatusEl.textContent = storage.state
  suggestionStatusEl.dataset.state = storage.state
  suggestionErrorEl.textContent =
    storage.state === 'error' && storage.error ? storage.error.message : ''

  suggestionListEl.replaceChildren()
  if (storage.suggestions.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'suggestion-empty'
    empty.textContent =
      storage.state === 'loading' ? 'Checking…' : 'No suggestions. Click "Check document".'
    suggestionListEl.appendChild(empty)
    return
  }
  storage.suggestions.forEach((suggestion, index) => {
    suggestionListEl.appendChild(renderCard(suggestion, index, storage.selectedId))
  })
}

editor.on('transaction', renderSuggestions)
editor.on('update', renderSuggestions)
window.setInterval(renderSuggestions, 150)
renderSuggestions()

// --- Edit with AI panel ----------------------------------------------------

const changesStatusEl = document.querySelector<HTMLElement>('#changes-status')!
const changesErrorEl = document.querySelector<HTMLElement>('#changes-error')!
const changeListEl = document.querySelector<HTMLUListElement>('#change-list')!
const changePromptInput = document.querySelector<HTMLInputElement>('#change-prompt')!

function proposeChanges(): void {
  const prompt = changePromptInput.value.trim()
  if (prompt) {
    editor.chain().focus().aiChangesPropose({ prompt }).run()
  }
}

on('#propose-changes', proposeChanges)
changePromptInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    proposeChanges()
  }
})
on('#accept-all-changes', () => editor.chain().focus().aiChangesAcceptAll().run())
on('#reject-all-changes', () => editor.chain().aiChangesRejectAll().run())

/** Selects a change and scrolls its inline decoration into view. */
function selectChange(id: string): void {
  editor.chain().aiChangesSelect(id).run()
  const decoration = editor.view.dom.querySelector(
    '.conote-ai-change-del--selected, .conote-ai-change-ins--selected',
  )
  decoration?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** Builds one change card. `index` drives the accept/reject test ids. */
function renderChangeCard(
  change: AiChangesStorage['changes'][number],
  index: number,
  selectedId: string | null,
): HTMLLIElement {
  const card = document.createElement('li')
  card.className = 'change-card'
  card.dataset.testid = `change-${index}`
  card.dataset.changeId = change.id
  if (change.id === selectedId) {
    card.classList.add('change-card--selected')
  }

  const body = document.createElement('button')
  body.type = 'button'
  body.className = 'change-body'
  body.title = 'Highlight this change in the document'
  body.addEventListener('click', () => selectChange(change.id))

  const diff = document.createElement('span')
  diff.className = 'change-diff'
  const del = document.createElement('span')
  del.className = 'change-delete'
  del.textContent = change.oldText || '∅'
  const arrow = document.createElement('span')
  arrow.className = 'change-arrow'
  arrow.textContent = ' → '
  const ins = document.createElement('span')
  ins.className = 'change-insert'
  ins.textContent = change.newText || '∅'
  diff.append(del, arrow, ins)
  body.appendChild(diff)
  card.appendChild(body)

  const actions = document.createElement('div')
  actions.className = 'change-actions'
  const accept = document.createElement('button')
  accept.className = 'accept'
  accept.dataset.testid = `accept-change-${index}`
  accept.textContent = 'Accept'
  accept.addEventListener('click', () => editor.chain().focus().aiChangesAccept(change.id).run())
  const reject = document.createElement('button')
  reject.className = 'reject'
  reject.dataset.testid = `reject-change-${index}`
  reject.textContent = 'Reject'
  reject.addEventListener('click', () => editor.chain().aiChangesReject(change.id).run())
  actions.append(accept, reject)
  card.appendChild(actions)

  return card
}

function renderChanges(): void {
  const storage = editor.storage.aiChanges as AiChangesStorage
  changesStatusEl.textContent = storage.state
  changesStatusEl.dataset.state = storage.state
  changesErrorEl.textContent =
    storage.state === 'error' && storage.error ? storage.error.message : ''

  changeListEl.replaceChildren()
  if (storage.changes.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'change-empty'
    empty.textContent =
      storage.state === 'loading' ? 'Proposing…' : 'No changes. Type an instruction and propose.'
    changeListEl.appendChild(empty)
    return
  }
  storage.changes.forEach((change, index) => {
    changeListEl.appendChild(renderChangeCard(change, index, storage.selectedId))
  })
}

editor.on('transaction', renderChanges)
editor.on('update', renderChanges)
window.setInterval(renderChanges, 150)
renderChanges()

// --- Agent panel -----------------------------------------------------------

const agentStatusEl = document.querySelector<HTMLElement>('#agent-status')!
const agentErrorEl = document.querySelector<HTMLElement>('#agent-error')!
const agentTranscriptEl = document.querySelector<HTMLElement>('#agent-transcript')!
const agentHintEl = document.querySelector<HTMLElement>('#agent-staged-hint')!
const agentInput = document.querySelector<HTMLInputElement>('#agent-input')!
const agentSendBtn = document.querySelector<HTMLButtonElement>('#agent-send')!

function sendAgentMessage(): void {
  const message = agentInput.value.trim()
  const storage = editor.storage.aiAgent as AiAgentStorage
  if (message && storage.state !== 'working') {
    editor.commands.aiAgentSend(message)
    agentInput.value = ''
  }
}

on('#agent-send', sendAgentMessage)
agentInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    sendAgentMessage()
  }
})
on('#agent-abort', () => editor.commands.aiAgentAbort())
on('#agent-reset', () => editor.commands.aiAgentReset())

/** Builds one chat bubble for a transcript turn. */
function renderBubble(turn: AiAgentStorage['transcript'][number]): HTMLDivElement {
  const bubble = document.createElement('div')
  bubble.className = `agent-bubble agent-bubble--${turn.role}`
  bubble.textContent = turn.content
  return bubble
}

function renderAgent(): void {
  const storage = editor.storage.aiAgent as AiAgentStorage
  agentStatusEl.textContent = storage.state
  agentStatusEl.dataset.state = storage.state
  agentErrorEl.textContent = storage.state === 'error' && storage.error ? storage.error.message : ''

  agentSendBtn.disabled = storage.state === 'working'

  agentTranscriptEl.replaceChildren()
  if (storage.transcript.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'agent-empty'
    empty.textContent = 'No messages yet. Ask the agent to edit the document.'
    agentTranscriptEl.appendChild(empty)
  } else {
    storage.transcript.forEach(turn => {
      agentTranscriptEl.appendChild(renderBubble(turn))
    })
  }

  // While a streaming provider produces the in-flight reply, show it live.
  if (storage.state === 'working' && storage.streamingText.length > 0) {
    const streaming = document.createElement('div')
    streaming.className = 'agent-bubble agent-bubble--assistant agent-bubble--streaming'
    streaming.dataset.testid = 'agent-streaming'
    streaming.textContent = storage.streamingText
    agentTranscriptEl.appendChild(streaming)
  }

  // After a run finishes, surface how many edits were staged for review.
  if (storage.state !== 'working' && storage.lastStagedCount > 0) {
    agentHintEl.hidden = false
    agentHintEl.textContent = `${storage.lastStagedCount} edit(s) staged — review them in the Changes panel.`
  } else {
    agentHintEl.hidden = true
    agentHintEl.textContent = ''
  }
}

editor.on('transaction', renderAgent)
editor.on('update', renderAgent)
window.setInterval(renderAgent, 150)
renderAgent()
