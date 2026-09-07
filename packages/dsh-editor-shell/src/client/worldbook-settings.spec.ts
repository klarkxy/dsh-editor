import { describe, expect, it } from 'vitest'
import { applyWorldbookSettings, isWorldbookPath } from './worldbook-settings.ts'

describe('worldbook frontmatter serialization', () => {
  it('recognizes worldbook markdown paths', () => {
    expect(isWorldbookPath('世界书/港口规则.md')).toBe(true)
    expect(isWorldbookPath('世界书/子目录/海关.md')).toBe(true)
    expect(isWorldbookPath('正文/001.md')).toBe(false)
    expect(isWorldbookPath('世界书/港口.txt')).toBe(false)
  })

  it('writes triggers, enabled and priority into a new header and keeps the body', () => {
    const source = '# 港口规则\n\n正文'
    const result = applyWorldbookSettings('世界书/港口规则.md', source, {
      triggers: '港口\n海关',
      enabled: true,
      priority: '8',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toMatch(/^triggers: \["?港口"?, "?海关"?\]$/m)
    expect(result.text).toContain('enabled: true')
    expect(result.text).toContain('priority: 8')
    expect(result.text.endsWith('# 港口规则\n\n正文')).toBe(true)
    expect(result.note).toContain('已加入草稿')
  })

  it('rewrites an existing valid header without touching the body bytes', () => {
    const source = '---\r\ntriggers: ["旧"]\r\nenabled: true\r\npriority: 1\r\n---\r\n# 港口规则\r\n\r\n正文'
    const result = applyWorldbookSettings('世界书/港口规则.md', source, {
      triggers: '港口',
      enabled: false,
      priority: '3',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toMatch(/^triggers: \["?港口"?\]\r?$/m)
    expect(result.text).toContain('enabled: false')
    expect(result.text).toContain('priority: 3')
    expect(result.text).toContain('# 港口规则\r\n\r\n正文')
  })

  it('refuses invalid trigger lines, priority, and broken headers', () => {
    expect(applyWorldbookSettings('世界书/港口.md', '# 正文', { triggers: '', enabled: true, priority: '0' }).note).toContain('至少填写')
    expect(applyWorldbookSettings('世界书/港口.md', '# 正文', { triggers: '港口', enabled: true, priority: '101' }).note).toContain('优先级')
    expect(applyWorldbookSettings('世界书/损坏.md', '---\ntriggers: ???\n---\n# 需要修复', {
      triggers: '港口',
      enabled: true,
      priority: '0',
    }).note).toContain('格式无效')
  })
})
