import { describe, expect, it } from 'vitest'
import { installSpecOf } from './plugins-page.ts'

describe('installSpecOf', () => {
  it('returns the target only for a not-installed, not-enabled row with a spec', () => {
    expect(installSpecOf({ installed: false, enabled: false, installTarget: { spec: 'pkg@1.0' } })).toBe('pkg@1.0')
    expect(installSpecOf({ installed: false, enabled: false })).toBeNull()
    expect(installSpecOf({ installed: false, enabled: true, installTarget: { spec: 'pkg@1.0' } })).toBeNull()
    expect(installSpecOf({ installed: false, enabled: true })).toBeNull()
    expect(installSpecOf({ installed: true, enabled: false, installTarget: { spec: 'pkg@1.0' } })).toBeNull()
    expect(installSpecOf({ enabled: false, installTarget: { spec: 'pkg@1.0' } })).toBeNull()
    expect(installSpecOf({ installed: false, installTarget: { spec: '  ' } })).toBeNull()
  })
})
