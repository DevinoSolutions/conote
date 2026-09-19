import { Ai } from './ai.js'

export { Ai } from './ai.js'
export { aiPluginKey, createAiPlugin } from './plugin.js'
export type { AiPluginState } from './plugin.js'
export {
  buildMessages,
  customInstruction,
  DEFAULT_SYSTEM_PROMPT,
  INSTRUCTIONS,
  toneInstruction,
  translateInstruction,
} from './prompts.js'
export type { AiCommandOptions, AiInsertMode, AiOptions, AiState, AiStorage } from './types.js'

export default Ai
