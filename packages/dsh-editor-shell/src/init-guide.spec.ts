import { describe, expect, it } from 'vitest'
import { buildInterviewPrompt, decodeInitSettings, initGuideState, shouldAutoIndexAfterInterview, shouldShowInitGuide } from './init-guide.ts'

describe('init guide', () => {
  it('picks interview for empty projects, explore for content without an index, done otherwise', () => {
    expect(initGuideState({ textFiles: [], indexReady: false })).toBe('interview')
    expect(initGuideState({ textFiles: [], indexReady: true })).toBe('interview')
    expect(initGuideState({ textFiles: ['正文/001.md'], indexReady: false })).toBe('explore')
    expect(initGuideState({ textFiles: ['正文/001.md'], indexReady: true })).toBe('done')
  })
  it('interview prompt asks one question at a time and lands conclusions through novel_propose', () => {
    const prompt = buildInterviewPrompt()
    expect(prompt).toContain('一次只问一个问题')
    expect(prompt).toContain('novel_propose')
    expect(prompt).toContain('项目总览.md')
    expect(prompt).toContain('人物卡/姓名.md')
    expect(prompt).toContain('世界书/词条名.md')
    expect(prompt).toContain('不要把多人写进同一张人物卡')
    expect(prompt).not.toContain('人物卡/人物索引.md')
    expect(prompt).not.toContain('世界书/设定总汇.md')
  })
  it('decodes dismissed workspace ids tolerantly', () => {
    expect(decodeInitSettings(undefined)).toEqual({ dismissedWorkspaceIds: [] })
    expect(decodeInitSettings(null)).toEqual({ dismissedWorkspaceIds: [] })
    expect(decodeInitSettings(['ws-1'])).toEqual({ dismissedWorkspaceIds: [] })
    expect(decodeInitSettings({ dismissedWorkspaceIds: 'ws-1' })).toEqual({ dismissedWorkspaceIds: [] })
    expect(decodeInitSettings({ dismissedWorkspaceIds: ['ws-1', 42, 'ws-2'] })).toEqual({ dismissedWorkspaceIds: ['ws-1', 'ws-2'] })
  })
  it('fires the auto-index only when interview started, a proposal landed, and the session is now idle', () => {
    const base = { initState: 'interview' as const, initCompleted: true, appliedDuringInterview: true, running: false, alreadyTriggered: false }
    expect(shouldAutoIndexAfterInterview(base)).toBe(true)
    expect(shouldAutoIndexAfterInterview({ ...base, alreadyTriggered: true })).toBe(false)
    expect(shouldAutoIndexAfterInterview({ ...base, initState: 'explore' })).toBe(false)
    expect(shouldAutoIndexAfterInterview({ ...base, initState: 'done' })).toBe(false)
    expect(shouldAutoIndexAfterInterview({ ...base, initCompleted: false })).toBe(false)
    expect(shouldAutoIndexAfterInterview({ ...base, appliedDuringInterview: false })).toBe(false)
    expect(shouldAutoIndexAfterInterview({ ...base, running: true })).toBe(false)
  })
  it('keeps empty works free of the interview card until the author starts it', () => {
    const empty = {
      hasWorkspace: true,
      inspected: true,
      initState: 'interview' as const,
      dismissed: false,
      interviewCompleted: false,
      engaged: false,
      workspaceHasConversation: false,
    }
    expect(shouldShowInitGuide(empty)).toBe(false)
    expect(shouldShowInitGuide({ ...empty, engaged: true })).toBe(true)
    expect(shouldShowInitGuide({ ...empty, initState: 'explore' })).toBe(true)
    expect(shouldShowInitGuide({ ...empty, initState: 'explore', workspaceHasConversation: true })).toBe(false)
    expect(shouldShowInitGuide({ ...empty, initState: 'explore', workspaceHasConversation: true, engaged: true })).toBe(true)
    expect(shouldShowInitGuide({ ...empty, dismissed: true, engaged: true })).toBe(false)
    expect(shouldShowInitGuide({ ...empty, inspected: false, engaged: true })).toBe(false)
  })
})
