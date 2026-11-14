import { describe, expect, it } from 'vitest'
import { defaultFimPayload } from './editor.tsx'
import { REWRITE_PRESETS } from './rewrite-presets.ts'

describe('default FIM/patch payloads', () => {
  it('omits empty optional fields and keeps non-empty chapterContext and instruction', () => {
    expect(defaultFimPayload({
      sessionId: 's',
      path: '正文/01.md',
      prefix: '前',
      suffix: '后',
      authorPreferences: '',
      chapterContext: '',
    })).toEqual({ sessionId: 's', path: '正文/01.md', prefix: '前', suffix: '后' })

    expect(defaultFimPayload({
      sessionId: 's',
      path: '正文/01.md',
      prefix: '前',
      suffix: '后',
      authorPreferences: '少用感叹号',
      chapterContext: '节拍：雨夜',
    })).toEqual({
      sessionId: 's',
      path: '正文/01.md',
      prefix: '前',
      suffix: '后',
      authorPreferences: '少用感叹号',
      chapterContext: '节拍：雨夜',
    })

  })
})

describe('REWRITE_PRESETS', () => {
  it('exposes the four built-in rewrite instructions', () => {
    expect(REWRITE_PRESETS.map((preset) => preset.id)).toEqual(['sensory', 'tighten', 'show', 'dialogue'])
    for (const preset of REWRITE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.instruction.length).toBeGreaterThan(0)
    }
  })
})
