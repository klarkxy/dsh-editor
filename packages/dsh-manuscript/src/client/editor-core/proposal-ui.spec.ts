import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const editor = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'editor.tsx'), 'utf8')

describe('rewrite proposal chrome', () => {
  it('renders apply/dismiss as real actions and does not scroll the paper on each keystroke', () => {
    expect(editor).toContain('className: \'proposal-actions\'')
    expect(editor).toContain('className: \'primary-action\'')
    expect(editor).toContain('className: \'proposal-dismiss\'')
    expect(editor).toContain('selection-diff')
    expect(editor).toContain('scrollIntoView')
    expect(editor).toContain('getPaperOffset')
    expect(editor).toContain('[proposal]')
  })
})

describe('generic editor wording', () => {
  it('uses document chrome for generic aria/notice and keeps novel-only chapter paths', () => {
    expect(editor).toContain("'aria-label': '文稿编辑区'")
    expect(editor).toContain("'aria-label': '文档编辑器'")
    expect(editor).toContain("report('文稿已变化，已停止此前的建议。')")
    expect(editor).not.toContain("'aria-label': '正文编辑区'")
    expect(editor).not.toContain("'aria-label': '正文编辑器'")
    expect(editor).not.toContain("report('正文已变化")
    expect(editor).toContain("'aria-label': '章节导航'")
    expect(editor).toContain("siblingsBlocked ? '请先保存' : '上一章'")
    expect(editor).toContain("siblingsBlocked ? '请先保存' : '下一章'")
    expect(editor).toContain('/^正文\\/.+\\.(?:md|txt)$/i')
    expect(editor).toContain("report('章节内容已变化，请关闭本窗口后重新打开再写入。')")
    expect(editor).toContain("report('只能写入章节文件头，正文改动请直接在稿纸上进行。')")
  })
})
