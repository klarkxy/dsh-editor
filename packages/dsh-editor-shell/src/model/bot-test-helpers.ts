import type { BotStateView } from 'dsh-editor-workbench/contracts'

export function emptyBotState(): BotStateView {
  return { schema: 1, initialized: false, segments: [], recaps: [], projectEmpty: false }
}
