import { describe, expect, it } from 'vitest'
import { saveOpenEditor } from '../packages/dsh-editor-shell/src/wrap-up-view.ts'

function savingEditor() {
  let doc = { sessionId: 's1', path: '正文/001.md', version: 'v1', text: '已存正文' }
  let text = '已存正文。新句'
  let composing = false
  let conflict = false
  let finish!: () => void
  const handle = {
    isComposing: () => composing,
    getCommandState: () => ({ loaded: true, conflict }),
    getDocument: () => doc,
    getText: () => text,
    save: () => new Promise<boolean>(resolve => {
      const captured = text
      finish = () => { doc = { ...doc, version: 'v2', text: captured }; resolve(true) }
    }),
  }
  return { handle, finish: () => finish(), type: (value: string) => { text = value }, compose: () => { composing = true }, conflict: () => { conflict = true }, switch: () => { doc = { ...doc, sessionId: 's2', path: '正文/002.md' } } }
}

describe('independent author navigation gates', () => {
  it('allows navigation only after the newest buffer is on disk', async () => {
    const f = savingEditor(); const result = saveOpenEditor(f.handle, { sessionId:'s1',path:'正文/001.md' });
    f.finish(); expect(await result).toEqual({ok:true})
  })
  it('stays on the chapter when typing continues during save', async () => {
    const f = savingEditor(); const result = saveOpenEditor(f.handle, { sessionId:'s1',path:'正文/001.md' });
    f.type('继续写的新字'); f.finish(); expect(await result).toEqual({ok:false,reason:'typing'})
    expect(f.handle.getText()).toBe('继续写的新字')
  })
  it('does not leave while a new IME composition starts during save', async () => {
    const f = savingEditor(); const result = saveOpenEditor(f.handle, { sessionId:'s1',path:'正文/001.md' });
    f.compose(); f.finish(); expect(await result).toEqual({ok:false,reason:'composing'})
  })
  it('does not navigate after the loaded document identity changes', async () => {
    const f = savingEditor(); const result = saveOpenEditor(f.handle, { sessionId:'s1',path:'正文/001.md' });
    f.switch(); f.finish(); expect(await result).toEqual({ok:false,reason:'identity'})
  })
})
