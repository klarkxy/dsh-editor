import { describe, expect, it } from 'vitest'
import { isWritingAgentPreset, WRITING_AGENT_PRESETS } from './host-guard.ts'

describe('writing agent preset ids', () => {
  it('names the four writing modes plus legacy', () => {
    expect(WRITING_AGENT_PRESETS).toEqual([
      'dsh-editor-writing',
      'dsh-editor-novel',
      'dsh-editor-article',
      'dsh-editor-technical',
      'dsh-editor',
    ])
    for (const preset of WRITING_AGENT_PRESETS) expect(isWritingAgentPreset(preset)).toBe(true)
  })

  it('does not treat official or community presets as writing modes', () => {
    expect(isWritingAgentPreset('standard')).toBe(false)
    expect(isWritingAgentPreset('plugin-preset')).toBe(false)
    expect(isWritingAgentPreset(null)).toBe(false)
    expect(isWritingAgentPreset(undefined)).toBe(false)
  })
})
