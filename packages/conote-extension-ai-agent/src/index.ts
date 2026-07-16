import { AiAgent } from './aiAgent.js'

export { AiAgent } from './aiAgent.js'
export {
  AGENT_TOOLS,
  DEFAULT_SYSTEM_PROMPT,
  INSERT_TEXT,
  READ_DOCUMENT,
  REPLACE_TEXT,
} from './tools.js'
export {
  anchorRange,
  buildDocTextIndex,
  docPlainText,
  positionAtOffset,
} from './locate.js'
export type { DocTextIndex } from './locate.js'
export { createEditSession } from './session.js'
export type { EditSession, StagedChange } from './session.js'
export type {
  AiAgentApplyMode,
  AiAgentOptions,
  AiAgentState,
  AiAgentStorage,
  AiAgentTurn,
} from './types.js'

export default AiAgent
