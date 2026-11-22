import { describe, expect, it } from 'vitest'
import { desktopRewritePrompt } from './rewrite-request.ts'

describe('desktopRewritePrompt', () => {
  it('authorizes a unique writing_change of the selection and does not forbid writing', () => {
    const text = desktopRewritePrompt('正文/001.md', '他住在北门。', '缩短这句')
    expect(text).toContain('文件：正文/001.md')
    expect(text).toContain('改写要求：缩短这句')
    expect(text).toContain('【待改写】')
    expect(text).toContain('他住在北门。')
    expect(text).toContain('writing_change')
    expect(text).toContain('只改这一处选段')
    expect(text).not.toMatch(/不要直接写入/)
    expect(text).not.toMatch(/不要写文件/)
    expect(text).not.toMatch(/请在回复中给出修改稿/)
  })
})
