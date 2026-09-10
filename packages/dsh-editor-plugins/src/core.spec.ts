import { describe, expect, it } from 'vitest'
import {
  catalogFor, classifyEntry, isProtectedEntry, isProtectedPackage, isSafeEntryId, isSafePackageName, packageNameOf,
} from './core.ts'

describe('plugin core protection', () => {
  it('locks the writing minimum and every DeepSeek Harness package', () => {
    expect(isProtectedPackage('dsh-editor-shell')).toBe(true)
    expect(isProtectedPackage('dsh-editor-plugins')).toBe(true)
    expect(isProtectedPackage('@deepseek-ai/dsh-base')).toBe(true)
    expect(isProtectedPackage('@deepseek-ai/dsh-client-ui-sidebar')).toBe(true)
    expect(isProtectedPackage('community-theme')).toBe(false)
    expect(isProtectedEntry('editor-shell', 'dsh-editor-shell')).toBe(true)
    expect(isProtectedEntry('editor-plugins', 'dsh-editor-plugins')).toBe(true)
    expect(isProtectedEntry('manuscript', 'dsh-manuscript')).toBe(true)
    expect(isProtectedEntry('zhihu', 'dsh-zhihu')).toBe(false)
    expect(isProtectedEntry('proofread', 'dsh-proofread')).toBe(false)
    expect(isProtectedEntry('ui-sidebar', '@deepseek-ai/dsh-client-ui-sidebar')).toBe(true)
  })

  it('classifies catalog entries and hides harness internals', () => {
    expect(classifyEntry('manuscript', 'dsh-manuscript')).toBe('core')
    expect(classifyEntry('zhihu', 'dsh-zhihu')).toBe('optional')
    expect(classifyEntry('ui-sidebar', '@deepseek-ai/dsh-client-ui-sidebar')).toBe('hidden')
    expect(classifyEntry('theme-paper', 'dsh-theme-paper')).toBe('community')
    expect(catalogFor('zhihu', 'dsh-zhihu').title).toBe('知乎资料')
    expect(packageNameOf('dsh-zhihu/tools')).toBe('dsh-zhihu')
    expect(packageNameOf('@scope/pkg/tools')).toBe('@scope/pkg')
  })

  it('rejects unsafe identifiers', () => {
    expect(isSafeEntryId('zhihu')).toBe(true)
    expect(isSafeEntryId('../etc')).toBe(false)
    expect(isSafePackageName('dsh-theme')).toBe(true)
    expect(isSafePackageName('@acme/dsh-plugin')).toBe(true)
    expect(isSafePackageName('../evil')).toBe(false)
  })
})
