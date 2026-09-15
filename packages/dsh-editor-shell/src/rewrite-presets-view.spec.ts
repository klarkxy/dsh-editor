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
    expect(normalizeCustomInstruction('更冷一点。\n不要改情节。')).toBe('更冷一点。\n不要改情节。')
    expect(normalizeCustomInstruction(`${'a'.repeat(CUSTOM_INSTRUCTION_MAX + 20)}`)).toBe('a'.repeat(CUSTOM_INSTRUCTION_MAX))
  })

  it('allows rewrite on visible author-owned markdown and text, including root and nested folders', () => {
    expect(canRewritePath('正文/001.md')).toBe(true)
    expect(canRewritePath('正文/第一卷/003.txt')).toBe(true)
    expect(canRewritePath('世界书/港口.md')).toBe(true)
    expect(canRewritePath('大纲/总纲.md')).toBe(true)
    expect(canRewritePath('人物卡/主角.md')).toBe(true)
    expect(canRewritePath('draft.md')).toBe(true)
    expect(canRewritePath('主稿/article.md')).toBe(true)
    expect(canRewritePath('文档/guide.txt')).toBe(true)
    expect(canRewritePath('资料/nested/notes.md')).toBe(true)
  })

  it('rejects hidden, generated, auxiliary, non-text, empty, and unsafe rewrite paths', () => {
    expect(canRewritePath('')).toBe(false)
    expect(canRewritePath('notes')).toBe(false)
    expect(canRewritePath('正文/001.docx')).toBe(false)
    expect(canRewritePath('cover.jpg')).toBe(false)
    expect(canRewritePath('.dsh-editor/作品索引.md')).toBe(false)
    expect(canRewritePath('文档/.hidden.md')).toBe(false)
    expect(canRewritePath('dist/out.md')).toBe(false)
    expect(canRewritePath('node_modules/pkg.md')).toBe(false)
    expect(canRewritePath('build/a.md')).toBe(false)
    expect(canRewritePath('coverage/x.md')).toBe(false)
    expect(canRewritePath('out/y.txt')).toBe(false)
    expect(canRewritePath('target/z.md')).toBe(false)
    expect(canRewritePath('AGENTS.md')).toBe(false)
    expect(canRewritePath('CLAUDE.md')).toBe(false)
    expect(canRewritePath('文档/GEMINI.md')).toBe(false)
    expect(canRewritePath('COPILOT.md')).toBe(false)
    expect(canRewritePath('../secret.md')).toBe(false)
    expect(canRewritePath('foo/../bar.md')).toBe(false)
  })

  it('rejects POSIX absolute, Windows drive, UNC, and drive-relative rewrite paths', () => {
    expect(canRewritePath('/tmp/a.md')).toBe(false)
    expect(canRewritePath('C:\\tmp\\a.md')).toBe(false)
    expect(canRewritePath('C:/tmp/a.md')).toBe(false)
    expect(canRewritePath('\\\\server\\share\\a.md')).toBe(false)
    expect(canRewritePath('\\tmp\\a.md')).toBe(false)
    expect(canRewritePath('C:tmp/a.md')).toBe(false)
    expect(canRewritePath('draft.md')).toBe(true)
    expect(canRewritePath('主稿/article.md')).toBe(true)
  })
})
