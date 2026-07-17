import StarterKit from '@tiptap/starter-kit'
import { OpenRouterProvider } from '@conote/ai-core'
import { Ai } from '@conote/extension-ai'
import { AiSuggestion } from '@conote/extension-ai-suggestion'
import type { AiSuggestionRule } from '@conote/extension-ai-suggestion'
import { AiChanges } from '@conote/extension-ai-changes'
import { AiAgent } from '@conote/extension-ai-agent'

const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'

// Proxy mode: no apiKey in the browser. The provider posts to the local proxy,
// which injects the OpenRouter key server-side. baseUrl + '/chat/completions'
// resolves to http://localhost:8787/api/chat/completions.
export const provider = new OpenRouterProvider({
  baseUrl: 'http://localhost:8787/api',
  defaultModel: DEFAULT_MODEL,
})

export const SAMPLE_CONTENT = `
  <p>Last week our team recieved the final report, and we where definately impressed by the results. If we could of started sooner, the outcome might have been even better.</p>
  <p>The committee shared there feedback with the group. Due to the fact that we had a large amount of time at our disposal, we were able to carefully and thoroughly review each and every single section of the document in great detail.</p>
`

// Two proofreading rules exercised by the "Proofread" panel. Colors match the
// decoration styling in style.css (via the --conote-ai-suggestion-color var).
export const SUGGESTION_RULES: AiSuggestionRule[] = [
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

export const RULE_TITLES = new Map(SUGGESTION_RULES.map(rule => [rule.id, rule.title]))
export const RULE_COLORS = new Map(SUGGESTION_RULES.map(rule => [rule.id, rule.color ?? '']))

/** The full extension set the demo editor mounts — identical to the vanilla build. */
export function buildExtensions() {
  return [
    StarterKit,
    Ai.configure({ provider, defaultModel: DEFAULT_MODEL }),
    AiSuggestion.configure({ provider, defaultModel: DEFAULT_MODEL, rules: SUGGESTION_RULES }),
    AiChanges.configure({ provider, defaultModel: DEFAULT_MODEL }),
    AiAgent.configure({ provider, defaultModel: DEFAULT_MODEL, applyMode: 'review' }),
  ]
}
