import { describe, expect, it } from 'vitest'
import { collectHumanMessages, foldTitle, userRenameNewerThan } from './messages.ts'

describe('human message selection', () => {
  it('keeps real human prompts and drops plugin auxiliary messages', () => {
    const selected = collectHumanMessages([
      { type: 'user/message', seq: 0, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '旧任务已经完成' }] } },
      { type: 'user/message', seq: 1, data: { source: { kind: 'plugin:dsh-recap', plugin: 'dsh-recap' }, content: [{ type: 'text', text: '辅助摘要不应进标题' }] } },
      { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '现在修复登录回调失败' }] } },
    ])
    expect(selected.map(message => message.text)).toEqual(['旧任务已经完成', '现在修复登录回调失败'])
  })

  it('treats a later user rename as newer than the generation watermark', () => {
    const events = [
      { type: 'user/message', seq: 0, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '写标题' }] } },
      { type: 'session/title', seq: 2, time: 3, data: { title: '手动名', messageSeqs: [], source: { kind: 'user' as const } } },
    ]
    expect(userRenameNewerThan(events, 1)).toBe(true)
    expect(foldTitle(events)?.title).toBe('手动名')
  })
})
