import { describe, expect, it } from 'vitest'
import { discardFrozenPrompt, freezePrompt, frozenPromptFor, promptFingerprint } from './freeze.ts'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

const assemblyA = { sections: [{ name: 'a', text: '第一版' }], variables: {} } as unknown as PromptAssembly
const assemblyB = { sections: [{ name: 'a', text: '第二版' }], variables: {} } as unknown as PromptAssembly

describe('prompt freeze', () => {
  it('returns the frozen assembly after the first store and clears on discard', () => {
    freezePrompt('s1', assemblyA, 'fp1')
    expect(frozenPromptFor('s1')?.assembly).toBe(assemblyA)
    // 第二次即便给出新值也不覆盖
    freezePrompt('s1', assemblyB, 'fp2')
    // freezePrompt 只做存储；调用方按 frozenPromptFor 决定是否走冻结路径
    discardFrozenPrompt('s1')
    expect(frozenPromptFor('s1')).toBeUndefined()
  })

  it('fingerprint changes with preferences or limit-break only', () => {
    const a = promptFingerprint('偏好A', false)
    expect(promptFingerprint('偏好A', false)).toBe(a)
    expect(promptFingerprint('偏好B', false)).not.toBe(a)
    expect(promptFingerprint('偏好A', true)).not.toBe(a)
  })
})

describe('frozen map eviction', () => {
  it('caps at 100 entries, evicting the oldest', () => {
    for (let index = 0; index < 110; index++) freezePrompt(`s${index}`, assemblyA, 'fp')
    expect(frozenPromptFor('s0')).toBeUndefined()
    expect(frozenPromptFor('s109')?.assembly).toBe(assemblyA)
    for (let index = 0; index < 110; index++) discardFrozenPrompt(`s${index}`)
  })
})
