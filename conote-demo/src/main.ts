import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { OpenRouterProvider } from '@conote/ai-core'
import { Ai } from '@conote/extension-ai'
import type { AiStorage } from '@conote/extension-ai'
import './style.css'

// Proxy mode: no apiKey in the browser. The provider posts to the local proxy,
// which injects the OpenRouter key server-side. baseUrl + '/chat/completions'
// resolves to http://localhost:8787/api/chat/completions.
const provider = new OpenRouterProvider({
  baseUrl: 'http://localhost:8787/api',
  defaultModel: 'anthropic/claude-haiku-4.5',
})

const SAMPLE_CONTENT = `
  <p>The old lighthouse had not shone in forty years, yet every evening the townspeople still glanced toward it out of habit, as if expecting the light to return.</p>
  <p>Maren climbed the spiral stairs for the first time since childhood. The lens at the top was intact, coated in dust but unbroken, and she wondered how much of the past could be relit with patience and a little courage.</p>
`

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="wrap">
    <header>
      <h1>CoNote Demo</h1>
      <p>AI Generation for Tiptap, streamed through a self-hosted proxy. Select text, then try the tools below.</p>
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

    <div class="editor" id="editor"></div>

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
  ],
  content: SAMPLE_CONTENT,
  autofocus: 'end',
})

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
