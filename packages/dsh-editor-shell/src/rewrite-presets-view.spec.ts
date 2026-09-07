import { describe, expect, it } from 'vitest'
import { REWRITE_PRESETS } from 'dsh-manuscript/client/editor-core'
import { en, zh } from './i18n/index.ts'
import {
  CUSTOM_INSTRUCTION_MAX,
  canRewritePath,
  normalizeCustomInstruction,
  presetLabelKey,
} from './rewrite-presets-view.ts'

describe('rewrite-presets-view', () => {
  it('maps each preset id to an i18n key present in both dictionaries', () => {
    expect(presetLabelKey('sensory')).toBe('rewrite.preset.sensory')
    expect(presetLabelKey('tighten')).toBe('rewrite.preset.tighten')
    expect(presetLabelKey('show')).toBe('rewrite.preset.show')
    expect(presetLabelKey('dialogue')).toBe('rewrite.preset.dialogue')
    expect(REWRITE_PRESETS.map((preset) => preset.id)).toEqual(['sensory', 'tighten', 'show', 'dialogue'])
    for (const preset of REWRITE_PRESETS) {
      const key = presetLabelKey(preset.id)
      expect(zh[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
    }
    expect(zh['rewrite.preset.sensory']).toBe('感官展开')
    expect(en['rewrite.preset.sensory']).toBe('Add sensory detail')
    expect(zh['rewrite.custom']).toBe('自定义…')
    expect(en['rewrite.custom']).toBe('Custom…')
  })

  it('normalizes custom instructions: trim, collapse whitespace, cap length, reject empty', () => {
    expect(normalizeCustomInstruction('')).toBeNull()
    expect(normalizeCustomInstruction('   \n\t  ')).toBeNull()
    expect(normalizeCustomInstruction('  tighten   the  dialogue \n')).toBe('tighten the dialogue')
    expect(normalizeCustomInstruction(`${'a'.repeat(CUSTOM_INSTRUCTION_MAX + 20)}`)).toBe('a'.repeat(CUSTOM_INSTRUCTION_MAX))
  })

  it('allows rewrite presets only on chapter manuscript paths', () => {
    expect(canRewritePath('正文/001.md')).toBe(true)
    expect(canRewritePath('正文/第一卷/003.txt')).toBe(true)
    expect(canRewritePath('世界书/港口.md')).toBe(false)
    expect(canRewritePath('大纲/总纲.md')).toBe(false)
    expect(canRewritePath('正文/001.docx')).toBe(false)
    expect(canRewritePath('人物卡/主角.md')).toBe(false)
  })
})
