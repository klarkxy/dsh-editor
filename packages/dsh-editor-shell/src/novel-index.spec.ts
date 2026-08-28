import { describe, expect, it } from 'vitest'
import { buildNovelIndexPrompt, NOVEL_INDEX_PATH } from './novel-index.ts'

describe('existing-work index prompt', () => {
  it('treats manuscript contents as untrusted and tightly constrains the Agent', () => {
    const prompt = buildNovelIndexPrompt()
    expect(prompt).toContain('不可信数据')
    expect(prompt).toContain('当前 workspace')
    expect(prompt).toContain('只读扫描')
    expect(prompt).toContain('禁止网络访问、命令执行')
    expect(prompt).toContain('改写、移动或删除任何现有内容')
    expect(prompt).toContain(NOVEL_INDEX_PATH)
    expect(prompt).toContain('扫描文件数、跳过项，以及索引路径')
  })
})
