import { describe, expect, it } from 'vitest'
import { scanScene } from '../src/scan.ts'

describe('scanScene', () => {
  it('flags a run of pure dialogue, crowd filler, and a vanished name', () => {
    const text = [
      '巷口风停了。',
      '「你来了。」',
      '「我来了。」',
      '「那就走。」',
      '「别回头。」',
      '众人一阵哗然。',
      '陈砺把铁尺收回袖里。',
    ].join('\n')
    const issues = scanScene(text, ['陈砺', '沈晚宁'])
    expect(issues.some((item) => item.kind === 'dialogue-run')).toBe(true)
    expect(issues.some((item) => item.kind === 'crowd')).toBe(true)
    expect(issues.some((item) => item.kind === 'missing-character' && item.evidence.includes('沈晚宁'))).toBe(true)
  })

  it('does not flag short back-and-forth', () => {
    const issues = scanScene('「早。」\n她点头。\n「走。」\n', ['沈晚宁'])
    expect(issues.filter((item) => item.kind === 'dialogue-run')).toEqual([])
  })
})
