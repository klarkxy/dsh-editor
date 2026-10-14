import { describe, expect, it } from 'vitest'
import { compareDocumentPaths } from './natural-order.ts'

const ORIGINAL = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/* shell-rewrite-spec §3 指定的排序用例（与 shell model/natural-order.spec.ts 同例）。 */
describe('compareDocumentPaths', () => {
  it('第二章 排在 第一章 之后', () => {
    expect(compareDocumentPaths('正文/第一章.md', '正文/第二章.md')).toBeLessThan(0)
    expect(compareDocumentPaths('正文/第二章.md', '正文/第一章.md')).toBeGreaterThan(0)
  })

  it('第十章 排在 第九章 之后', () => {
    expect(compareDocumentPaths('正文/第九章.md', '正文/第十章.md')).toBeLessThan(0)
  })

  it('第十一章 排在 第十章 之后', () => {
    expect(compareDocumentPaths('正文/第十章.md', '正文/第十一章.md')).toBeLessThan(0)
  })

  it('第2章 排在 第10章 之前', () => {
    expect(compareDocumentPaths('正文/第2章.md', '正文/第10章.md')).toBeLessThan(0)
  })

  it('中文数字与阿拉伯数字数值相同时按原排序器比较', () => {
    expect(compareDocumentPaths('正文/第二章.md', '正文/第2章.md'))
      .toBe(ORIGINAL.compare('正文/第二章.md', '正文/第2章.md'))
    expect(compareDocumentPaths('正文/第2章.md', '正文/第二章.md'))
      .toBe(ORIGINAL.compare('正文/第2章.md', '正文/第二章.md'))
  })

  it('非数字部分退回 zh-CN 排序器', () => {
    expect(compareDocumentPaths('人物卡/林舟.md', '人物卡/沈青.md'))
      .toBe(ORIGINAL.compare('人物卡/林舟.md', '人物卡/沈青.md'))
  })

  it('跨目录先比父段', () => {
    expect(compareDocumentPaths('世界书/第十章.md', '正文/第一章.md'))
      .toBe(ORIGINAL.compare('世界书', '正文') < 0 ? -1 : 1)
  })
})
