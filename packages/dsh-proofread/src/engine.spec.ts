import { describe, expect, it } from 'vitest'
import { HABIT_MAX_OCCURRENCES, PROOFREAD_MAX_FINDINGS, proofreadText } from './engine.ts'

function kindsOf(text: string, kinds: Array<'punctuation' | 'sensitive' | 'repeat' | 'typo' | 'habit'>, extra?: Parameters<typeof proofreadText>[1]) {
  return proofreadText(text, { path: '正文/测.md', version: 'v1', kinds, ...extra })
}

describe('punctuation', () => {
  it('flags half-width punctuation between CJK and offers a full-width suggestion', () => {
    const result = kindsOf('他说,然后走了。', ['punctuation'])
    expect(result.findings).toMatchObject([{ kind: 'punctuation', start: 2, end: 3, suggestion: '，', message: '半角「,」应使用全角' }])
    expect(kindsOf('hello, world', ['punctuation']).findings).toEqual([])
    expect(kindsOf('他说，然后走了。', ['punctuation']).findings).toEqual([])
  })

  it('flags spaces between CJK but not CJK-latin spacing', () => {
    const result = kindsOf('你好 世界', ['punctuation'])
    expect(result.findings).toMatchObject([{ start: 2, end: 3, suggestion: '', message: '汉字之间存在空格' }])
    expect(kindsOf('中文 English', ['punctuation']).findings).toEqual([])
  })

  it('flags duplicate punctuation but exempts ellipsis and dash', () => {
    expect(kindsOf('他说。。然后', ['punctuation']).findings).toMatchObject([{ suggestion: '。', message: '连续重复标点' }])
    expect(kindsOf('很好，，好', ['punctuation']).findings).toMatchObject([{ suggestion: '，' }])
    expect(kindsOf('他说……然后——走了。', ['punctuation']).findings).toEqual([])
  })

  it('flags mixed half/full ?! but allows ？！ / ！？', () => {
    expect(kindsOf('什么?！', ['punctuation']).findings.some((item) => item.message.includes('半全角'))).toBe(true)
    expect(kindsOf('什么？！真的！？', ['punctuation']).findings).toEqual([])
  })

  it('flags unbalanced and mixed quote pairs', () => {
    expect(kindsOf('“你好”他说。', ['punctuation']).findings).toEqual([])
    expect(kindsOf('“你好。', ['punctuation']).findings).toMatchObject([{ message: '引号未配对', start: 0 }])
    expect(kindsOf('“你好」。', ['punctuation']).findings.some((item) => item.message === '引号未配对')).toBe(true)
    expect(kindsOf('「内“嵌套”」', ['punctuation']).findings).toEqual([])
  })
})

describe('typo', () => {
  it('replaces high-confidence confusions and skips safe lookalikes', () => {
    const hits = kindsOf('的时后既使以经走了做为按装一但必需要', ['typo']).findings
    expect(hits.map((item) => [item.start, item.suggestion])).toEqual(expect.arrayContaining([
      [0, '的时候'],
      expect.arrayContaining([expect.any(Number), '即使']),
      expect.arrayContaining([expect.any(Number), '已经']),
      expect.arrayContaining([expect.any(Number), '作为']),
      expect.arrayContaining([expect.any(Number), '安装']),
      expect.arrayContaining([expect.any(Number), '一旦']),
      expect.arrayContaining([expect.any(Number), '必须要']),
    ]))
    expect(kindsOf('的时候即使已经作为安装一旦必须要必需品', ['typo']).findings).toEqual([])
    expect(kindsOf('现在见面以经验一但是', ['typo']).findings).toEqual([])
    expect(kindsOf('跑得快慢慢地红的花', ['typo']).findings).toEqual([])
  })
})

describe('sensitive', () => {
  it('matches bundled terms and honors an allowlist', () => {
    const flagged = kindsOf('桌上放着冰毒。', ['sensitive'])
    expect(flagged.findings).toMatchObject([{ kind: 'sensitive', severity: 'warning', message: '敏感词「冰毒」' }])
    expect(kindsOf('桌上放着冰毒。', ['sensitive'], { sensitiveAllowlist: ['冰毒'] }).findings).toEqual([])
    expect(kindsOf('普通的一句话。', ['sensitive']).findings).toEqual([])
  })
})

describe('repeat', () => {
  it('flags stuttered phrases and immediate duplicates, but not whitelist reduplication', () => {
    expect(kindsOf('他看着他看着远处。', ['repeat']).findings).toMatchObject([{ kind: 'repeat', message: '词语重复「他看着」' }])
    expect(kindsOf('的的走了。', ['repeat']).findings).toMatchObject([{ message: '词语重复「的的」' }])
    expect(kindsOf('然后然后离开。', ['repeat']).findings).toMatchObject([{ kind: 'repeat', severity: 'warning', message: '词语重复「然后」' }])
    expect(kindsOf('他慢慢走，常常想想，谢谢妈妈爸爸。', ['repeat']).findings).toEqual([])
    expect(kindsOf('渐渐天亮了。', ['repeat']).findings).toEqual([])
  })

  it('marks ordinary 一段一段 stacking as a suggestion, not a definite error', () => {
    const result = kindsOf('他一段一段地往下走。', ['repeat'])
    const hit = result.findings.find((finding) => finding.message.includes('一段'))
    expect(hit).toMatchObject({ kind: 'repeat', severity: 'info' })
    expect(hit?.message).toMatch(/建议核对叠词/)
  })

  it('still reports a nearby repeated longer phrase as a warning', () => {
    const result = kindsOf('紫禁城守卫紫禁城。', ['repeat'])
    const hit = result.findings.find((finding) => finding.message.includes('紫禁城'))
    expect(hit).toMatchObject({ kind: 'repeat', severity: 'warning' })
  })
})

describe('habit', () => {
  it('returns per-thousand stats and only emits findings above the threshold', () => {
    const heavy = `然后。`.repeat(8) + '甲'.repeat(50)
    const heavyResult = kindsOf(heavy, ['habit'])
    expect(heavyResult.habitStats[0]).toMatchObject({ term: '然后', count: 8 })
    expect(heavyResult.habitStats[0]!.perThousand).toBeGreaterThan(3)
    expect(heavyResult.findings).toHaveLength(8)
    expect(heavyResult.findings.every((item) => item.kind === 'habit' && item.severity === 'info')).toBe(true)

    const light = `然后${'甲'.repeat(2000)}`
    const lightResult = kindsOf(light, ['habit'])
    expect(lightResult.habitStats).toMatchObject([{ term: '然后', count: 1 }])
    expect(lightResult.habitStats[0]!.perThousand).toBeLessThanOrEqual(3)
    expect(lightResult.findings).toEqual([])
  })

  it('emits at most the first 20 occurrences of an overused term', () => {
    const text = `${'然后'.repeat(25)}${'甲'.repeat(10)}`
    const result = kindsOf(text, ['habit'])
    expect(result.findings).toHaveLength(HABIT_MAX_OCCURRENCES)
    expect(result.habitStats[0]).toMatchObject({ term: '然后', count: 25 })
  })
})

describe('frontmatter and heading offsets', () => {
  it('keeps raw offsets and ignores YAML / heading markers', () => {
    const text = '---\ntitle: x\n的的\n---\n的的\n'
    const result = kindsOf(text, ['repeat'])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ start: text.lastIndexOf('的的'), line: 5, column: 1 })

    const heading = '# 你好,世界\n正文'
    const punct = kindsOf(heading, ['punctuation'])
    expect(punct.findings).toMatchObject([{ start: heading.indexOf(','), suggestion: '，' }])
    expect(heading.slice(0, heading.indexOf(','))).toBe('# 你好')
  })
})

describe('truncation', () => {
  it('caps engine findings and reports truncated', () => {
    const text = `${'的的。'.repeat(6)}`
    const result = kindsOf(text, ['repeat'], { maxFindings: 3 })
    expect(result.findings).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('caps the default scan at 500 findings', () => {
    const text = `${'的的。'.repeat(PROOFREAD_MAX_FINDINGS + 1)}`
    const result = kindsOf(text, ['repeat'])
    expect(result.findings).toHaveLength(PROOFREAD_MAX_FINDINGS)
    expect(result.truncated).toBe(true)
  })
})
