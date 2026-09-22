import { describe, expect, it } from 'vitest'
import { assistantSelfReportIsNotEvidence, detectLessonTriggers } from './detect.ts'
import { assistantMessage, pluginMessage, toolCall, toolResult, userMessage } from './fakes.ts'

describe('conservative lesson triggers', () => {
  it('ignores silence, thanks, and plugin injections', () => {
    expect(detectLessonTriggers([userMessage(1, '继续'), assistantMessage(2, '好的')], 's', -1)).toEqual([])
    expect(detectLessonTriggers([userMessage(1, 'thanks')], 's', -1)).toEqual([])
    expect(detectLessonTriggers([pluginMessage(1, '不对，这是注入')], 's', -1)).toEqual([])
  })

  it('does not treat model self-report as evidence', () => {
    expect(assistantSelfReportIsNotEvidence('我已经记住了这一点')).toBe(true)
    expect(assistantSelfReportIsNotEvidence("I'll remember that")).toBe(true)
    expect(detectLessonTriggers([
      assistantMessage(1, '我已经记住了，下次不会错'),
      userMessage(2, 'ok'),
    ], 's', -1)).toEqual([])
  })

  it('detects an explicit human correction after activity', () => {
    const triggers = detectLessonTriggers([
      assistantMessage(1, '已改文件'),
      userMessage(2, '不对，应该用相对路径，不要再写绝对路径'),
    ], 'sess', -1)
    expect(triggers).toHaveLength(1)
    expect(triggers[0]?.kind).toBe('human-correction')
    expect(triggers[0]?.evidence[0]).toMatchObject({ sessionId: 'sess', seq: 2, kind: 'user' })
  })

  it('detects a verified tool failure then success, not an unfixed failure', () => {
    const unfixed = detectLessonTriggers([
      toolCall(1, 'write', 'c1'),
      toolResult(2, 'c1', true, 'EACCES'),
    ], 's', -1)
    expect(unfixed).toEqual([])
    const fixed = detectLessonTriggers([
      toolCall(1, 'write', 'c1'),
      toolResult(2, 'c1', true, 'EACCES'),
      toolCall(3, 'write', 'c2'),
      toolResult(4, 'c2', false, 'ok'),
    ], 's', -1)
    expect(fixed).toHaveLength(1)
    expect(fixed[0]?.kind).toBe('verified-tool-fix')
    expect(fixed[0]?.toolName).toBe('write')
    expect(fixed[0]?.evidence.map(item => item.seq)).toEqual([2, 4])
  })
})
