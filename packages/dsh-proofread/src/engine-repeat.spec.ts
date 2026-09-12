import { describe, expect, it } from 'vitest'
import { proofreadText } from './engine.ts'

describe('repeat findings', () => {
  it('marks ordinary 一段一段 stacking as a suggestion, not a definite error', () => {
    const result = proofreadText('他一段一段地往下走。', { kinds: ['repeat'] })
    const hit = result.findings.find((finding) => finding.message.includes('一段'))
    expect(hit).toMatchObject({ kind: 'repeat', severity: 'info' })
    expect(hit?.message).toMatch(/建议核对叠词/)
  })

  it('keeps a clear stutter such as 然后然后 as a warning', () => {
    const result = proofreadText('然后然后离开。', { kinds: ['repeat'] })
    expect(result.findings).toMatchObject([{ kind: 'repeat', severity: 'warning', message: '词语重复「然后」' }])
  })

  it('still reports a nearby repeated longer phrase as a warning', () => {
    const result = proofreadText('紫禁城守卫紫禁城。', { kinds: ['repeat'] })
    const hit = result.findings.find((finding) => finding.message.includes('紫禁城'))
    expect(hit).toMatchObject({ kind: 'repeat', severity: 'warning' })
  })

  it('keeps typo detection for real errors', () => {
    const result = proofreadText('我们以经做好准备。', { kinds: ['typo'] })
    expect(result.findings.some((finding) => finding.kind === 'typo' && finding.suggestion === '已经')).toBe(true)
  })
})
