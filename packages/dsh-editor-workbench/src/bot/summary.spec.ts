import { describe, expect, it } from 'vitest'
import { BOT_SUMMARY_INSTRUCTION, parseSummaryBlocks } from './summary.ts'

describe('summary parsing', () => {
  it('takes the last recap and handoff blocks', () => {
    const text = '前言 <recap>旧回顾</recap> 中间 <recap>\n新回顾\n</recap> <handoff>\n交接内容\n</handoff> 尾部'
    expect(parseSummaryBlocks(text)).toEqual({ recap: '新回顾', handoff: '交接内容' })
  })

  it('fails on a missing or empty handoff block', () => {
    expect(parseSummaryBlocks('<recap>回顾</recap>')).toBeUndefined()
    expect(parseSummaryBlocks('<recap>回顾</recap><handoff>   </handoff>')).toBeUndefined()
    expect(parseSummaryBlocks('no blocks')).toBeUndefined()
  })

  it('instruction text matches the specified verbatim form', () => {
    expect(BOT_SUMMARY_INSTRUCTION).toContain('请暂停当前工作，整理到目前为止的对话')
    expect(BOT_SUMMARY_INSTRUCTION).toContain('<recap>')
    expect(BOT_SUMMARY_INSTRUCTION).toContain('<handoff>')
    expect(BOT_SUMMARY_INSTRUCTION).toContain('不要调用任何工具')
  })
})
