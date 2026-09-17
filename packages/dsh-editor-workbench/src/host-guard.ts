/**
 * App-owned writing agent ids. Terminal and extra host tools are disabled in
 * each preset's agent.cordis.yml, not by a global execution guard.
 */
export const WRITING_AGENT_PRESETS = [
  'dsh-editor-writing',
  'dsh-editor-novel',
  'dsh-editor-article',
  'dsh-editor-technical',
  'dsh-editor',
] as const

export type WritingAgentPreset = typeof WRITING_AGENT_PRESETS[number]

export function isWritingAgentPreset(preset: string | null | undefined): preset is WritingAgentPreset {
  return typeof preset === 'string' && (WRITING_AGENT_PRESETS as readonly string[]).includes(preset)
}
