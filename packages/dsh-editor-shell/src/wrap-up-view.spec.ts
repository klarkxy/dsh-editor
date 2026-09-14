import { describe, expect, it } from 'vitest'
import { readableDocumentTitle, rewriteSelectionExcerpt, saveOpenEditor } from './wrap-up-view.ts'

describe('wrap-up view', () => {
  it('prefers the first heading as the readable title and keeps the path as fallback', () => {
    expect(readableDocumentTitle('正文/001.md', '---\nbeats: [码头]\n---\n# 雾港夜话\n正文')).toBe('雾港夜话')
    expect(readableDocumentTitle('正文/001.md', '林舟出生于雾港。')).toBe('001')
    expect(rewriteSelectionExcerpt('  林舟   站在  雾港。  ', 6)).toBe('林舟 站在…')
  })

  it('saveOpenEditor saves then continues, and stays put on composing/conflict/failure/typing/identity', async () => {
    const doc = { sessionId: 's1', path: '人物卡/林舟.md', version: 'v1', text: '原内容' }
    let draft = '原内容改动'
    let composing = false
    let conflict = false
    let typingDuringSave = false
    let saveResult = true
    const handle = {
      isComposing: () => composing,
      getCommandState: () => ({ loaded: true, conflict }),
      getDocument: () => doc,
      getText: () => draft,
      save: async () => {
        if (!saveResult) return false
        if (typingDuringSave) {
          /* 真实保存以调用瞬间的缓冲区落盘；飞行期间的新键入留在缓冲区。 */
          doc.text += '新字'
          draft += '新字之后继续输入'
        } else {
          doc.text = draft
        }
        return true
      },
    }
    /* 非章节路径也照常保存。 */
    await expect(saveOpenEditor(handle, { sessionId: 's1', path: '人物卡/林舟.md' })).resolves.toEqual({ ok: true })
    composing = true
    await expect(saveOpenEditor(handle, { sessionId: 's1', path: '人物卡/林舟.md' })).resolves.toEqual({ ok: false, reason: 'composing' })
    composing = false
    conflict = true
    await expect(saveOpenEditor(handle, { sessionId: 's1', path: '人物卡/林舟.md' })).resolves.toEqual({ ok: false, reason: 'conflict' })
    conflict = false
    saveResult = false
    draft = '原内容改动后再改'
    await expect(saveOpenEditor(handle, { sessionId: 's1', path: '人物卡/林舟.md' })).resolves.toEqual({ ok: false, reason: 'save' })
    saveResult = true
    typingDuringSave = true
    await expect(saveOpenEditor(handle, { sessionId: 's1', path: '人物卡/林舟.md' })).resolves.toEqual({ ok: false, reason: 'typing' })
    typingDuringSave = false
    handle.getDocument = () => null
    await expect(saveOpenEditor(handle, { sessionId: 's1', path: '人物卡/林舟.md' })).resolves.toEqual({ ok: false, reason: 'identity' })
    /* 干净缓冲区直接放行，不触发保存。 */
    const clean = {
      ...handle,
      getDocument: () => doc,
      getText: () => doc.text,
      save: async () => { throw new Error('must not save clean buffer') },
    }
    await expect(saveOpenEditor(clean, { sessionId: 's1', path: '人物卡/林舟.md' })).resolves.toEqual({ ok: true })
  })

  it('saveOpenEditor rechecks composition and conflict after the async save resolves', async () => {
    const doc = { sessionId: 's1', path: '正文/001.md', version: 'v1', text: '已存正文' }
    let text = '已存正文。新句'
    let composing = false
    let conflict = false
    let finish!: () => void
    const handle = {
      isComposing: () => composing,
      getCommandState: () => ({ loaded: true, conflict }),
      getDocument: () => doc,
      getText: () => text,
      save: () => new Promise<boolean>((resolve) => {
        const captured = text
        finish = () => { doc.text = captured; resolve(true) }
      }),
    }
    /* 保存飞行期间开始 IME 组字：await 后复核必须拦住。 */
    const duringSave = saveOpenEditor(handle, { sessionId: 's1', path: '正文/001.md' })
    composing = true
    finish()
    await expect(duringSave).resolves.toEqual({ ok: false, reason: 'composing' })
    composing = false
    /* 保存飞行期间出现冲突标记：同样拦住。 */
    text = '又改了'
    const second = saveOpenEditor(handle, { sessionId: 's1', path: '正文/001.md' })
    conflict = true
    finish()
    await expect(second).resolves.toEqual({ ok: false, reason: 'conflict' })
    conflict = false
    /* 组字与冲突都没有时正常放行。 */
    text = '最终稿'
    const third = saveOpenEditor(handle, { sessionId: 's1', path: '正文/001.md' })
    finish()
    await expect(third).resolves.toEqual({ ok: true })
  })
})
