import { describe, expect, it } from 'vitest'
import { selectedSessionId } from './client-utils.ts'
const subscribe = () => () => {}
describe('selected auxiliary session', () => {
  const native = { adapter: { current: { getSnapshot: () => ({ key: 'native-session' }), subscribe } } }
  it('uses the selected editor chat, including an explicitly cleared selection', () => {
    expect(selectedSessionId({ uiWorkspace: { current: { getSnapshot: () => ({ sessionId: 'editor-chat' }), subscribe } }, uiSession: native })).toBe('editor-chat')
    expect(selectedSessionId({ uiWorkspace: { current: { getSnapshot: () => undefined, subscribe } }, uiSession: native })).toBe('')
  })
  it('uses the native main-view binding outside the editor', () => {
    expect(selectedSessionId({ uiWorkspace: {}, uiSession: native })).toBe('native-session')
    expect(selectedSessionId({ uiWorkspace: {}, uiSession: { adapter: { current: { getSnapshot: () => ({}), subscribe } } } })).toBe('')
  })
})
