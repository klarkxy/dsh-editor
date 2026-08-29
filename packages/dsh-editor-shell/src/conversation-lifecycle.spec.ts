import { describe, expect, it } from 'vitest'
import { ConversationRenameQueue, conversationRows, conversationTitle, nextAutomaticConversationTitle, shouldConfirmConversationSwitch } from './conversation-lifecycle.ts'

describe('conversation lifecycle projection', () => {
  it('uses workspace membership, hides archived and non-current blank sessions', () => {
    expect(conversationRows({ workspaceSessionIds: ['a', 'b', 'c'], archivedIds: ['b'], reusableBlankIds: ['c'], currentId: 'c', titles: { a: '讨论', c: '' } })).toEqual([{ id: 'a', title: '讨论', current: false }, { id: 'c', title: '新对话', current: true }])
  })
  it('normalizes deterministic bounded first reply titles', () => {
    expect(conversationTitle('  第一段\n继续讨论。后文  ')).toBe('第一段 继续讨论')
    expect(conversationTitle('x'.repeat(40), 10)).toBe('xxxxxxxxx…')
    expect(shouldConfirmConversationSwitch('草稿', 'b', 'a')).toBe(true)
    expect(shouldConfirmConversationSwitch(' ', 'b', 'a')).toBe(false)
  })

  it('auto-titles only an untitled, unattempted conversation with a durable assistant reply', () => {
    expect(nextAutomaticConversationTitle({ assistantReplies: ['', '第一条回复。继续说明'], attempted: false })).toBe('第一条回复')
    expect(nextAutomaticConversationTitle({ durableTitle: '作者命名', assistantReplies: ['自动名称'], attempted: false })).toBe('')
    expect(nextAutomaticConversationTitle({ assistantReplies: ['自动名称'], attempted: true })).toBe('')
  })

  it('keeps renames ordered by session across component remounts', async () => {
    const queue = new ConversationRenameQueue()
    const applied: string[] = []
    let releaseAutomatic!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const automatic = queue.enqueue('session-a', async () => {
      markStarted()
      await new Promise<void>((resolve) => { releaseAutomatic = resolve })
      applied.push('自动名称')
    })
    const manual = queue.enqueue('session-a', async () => { applied.push('手工名称') })
    await started
    expect(applied).toEqual([])
    releaseAutomatic()
    await Promise.all([automatic, manual])
    expect(applied).toEqual(['自动名称', '手工名称'])
  })
})
