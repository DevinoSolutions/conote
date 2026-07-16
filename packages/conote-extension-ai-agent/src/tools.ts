import type { ToolDefinition } from '@conote/ai-core'

/** Names of the tools the agent exposes to the model. */
export const READ_DOCUMENT = 'read_document'
export const REPLACE_TEXT = 'replace_text'
export const INSERT_TEXT = 'insert_text'

/**
 * The tools handed to the model each turn. All editing is text-anchored (never
 * character offsets) for the same robustness reason as the AiChanges and
 * AiSuggestion extensions: offsets drift, quoted text does not.
 */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: READ_DOCUMENT,
    description:
      'Return the current document as plain text, with paragraphs separated by newlines. Call this first to see what you are editing.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: REPLACE_TEXT,
    description:
      'Replace the first occurrence of `find` with `replace`. Pass `before_context` (text that immediately precedes the target) to disambiguate when `find` appears more than once. Delete text by passing an empty `replace`. Returns whether the target was found.',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'Exact text to find in the document.' },
        replace: { type: 'string', description: 'Text to replace it with (empty string to delete).' },
        before_context: {
          type: 'string',
          description: 'Optional text immediately preceding the target, used to pick the right occurrence.',
        },
      },
      required: ['find', 'replace'],
      additionalProperties: false,
    },
  },
  {
    name: INSERT_TEXT,
    description: 'Insert text at the start or end of the document.',
    parameters: {
      type: 'object',
      properties: {
        position: { type: 'string', enum: ['start', 'end'], description: 'Where to insert.' },
        text: { type: 'string', description: 'Text to insert.' },
      },
      required: ['position', 'text'],
      additionalProperties: false,
    },
  },
]

/** Default system prompt describing the agent's role and its tools. */
export const DEFAULT_SYSTEM_PROMPT = [
  'You are a writing assistant embedded in a rich-text editor.',
  'You help the user edit the current document by calling the provided tools.',
  '',
  'Guidelines:',
  '- Call read_document to inspect the current text before editing.',
  '- Make edits with replace_text and insert_text. Anchor edits on exact quoted text, not positions.',
  '- To delete text, call replace_text with an empty replace.',
  '- When replace_text reports "not found", re-read the document and adjust your quote.',
  '- When you are done editing, reply to the user in plain language summarizing what you changed.',
  'Edits may be staged for the user to review and accept, so describe them as proposed changes.',
].join('\n')
