import type { ChatMessage } from '@conote/ai-core'

import type { AiSuggestionRule } from './types.js'

/** Base instruction describing the strict-JSON contract the model must follow. */
export const SUGGESTION_SYSTEM_PROMPT =
  'You are a proofreading assistant. Review the document against the rules below and ' +
  'propose precise, minimal edits. Respond with ONLY a JSON object of the form ' +
  '{"suggestions": [{"ruleId", "deleteText", "beforeText", "replacementText", "note"}]}. ' +
  'Rules for each suggestion: "ruleId" must be one of the listed rule ids; "deleteText" must ' +
  'be an exact substring copied verbatim from the document (do not span line breaks); ' +
  '"beforeText" is a short exact snippet of the text immediately preceding "deleteText" to ' +
  'disambiguate repeated matches; "replacementText" is the corrected text; "note" is a brief ' +
  'explanation. Do not include markdown, code fences, or any prose outside the JSON. If there ' +
  'is nothing to suggest, return {"suggestions": []}.'

/** The shape the model is instructed to emit for each suggestion. */
export interface RawSuggestion {
  ruleId: string
  deleteText: string
  replacementText: string
  beforeText?: string
  note?: string
}

/** Assembles the message list sent to the provider for a proofreading pass. */
export function buildSuggestionMessages(docText: string, rules: AiSuggestionRule[]): ChatMessage[] {
  const ruleLines = rules
    .map(rule => `- id "${rule.id}" (${rule.title}): ${rule.prompt}`)
    .join('\n')
  const system = `${SUGGESTION_SYSTEM_PROMPT}\n\nRules:\n${ruleLines}`
  const user = `Proofread the following document text and return suggestions as strict JSON.\n\nDocument:\n"""\n${docText}\n"""`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Removes an optional surrounding markdown code fence from a model response. */
function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  return (match ? match[1] : trimmed).trim()
}

/**
 * Parses a provider response into raw suggestions. Tolerates markdown fences.
 * Throws when the payload is not valid JSON or lacks a `suggestions` array;
 * individual malformed entries are skipped.
 */
export function parseSuggestionResponse(raw: string): RawSuggestion[] {
  const stripped = stripFences(raw)
  let data: unknown
  try {
    data = JSON.parse(stripped)
  } catch (error) {
    throw new Error(`Invalid JSON in AI suggestion response: ${(error as Error).message}`)
  }
  const list = (data as { suggestions?: unknown })?.suggestions
  if (!Array.isArray(list)) {
    throw new Error('AI suggestion response is missing a "suggestions" array')
  }
  const out: RawSuggestion[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const { ruleId, deleteText, replacementText, beforeText, note } = item as Record<
      string,
      unknown
    >
    if (
      typeof ruleId !== 'string' ||
      typeof deleteText !== 'string' ||
      typeof replacementText !== 'string'
    ) {
      continue
    }
    out.push({
      ruleId,
      deleteText,
      replacementText,
      beforeText: typeof beforeText === 'string' ? beforeText : undefined,
      note: typeof note === 'string' ? note : undefined,
    })
  }
  return out
}
