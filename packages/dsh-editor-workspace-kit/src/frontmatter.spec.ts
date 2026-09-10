import { describe, expect, it } from 'vitest'
import {
  extractCardSummary,
  parseCharacterCardFrontmatter,
  parseSerializedCardFields,
  parseWorldbookCardFrontmatter,
  serializeCardFrontmatter,
} from './frontmatter.ts'

const FULL_CHARACTER = `---
name: 林冲
aliases: [豹子头, 林教头]
role: 配角
gender: 男
age: "28"
faction: 梁山
tags: [禁军, 枪棒]
status: alive
relations:
  - to: 鲁智深
    kind: 兄弟
  - to: 高俅
    kind: 仇敌
summary: 八十万禁军教头
custom: keep-me
---

# 林冲

他是东京八十万禁军枪棒教头。
`

const FULL_WORLDBOOK = `---
triggers: [汴京, 东京]
enabled: true
priority: 8
category: 地点
tags: [都城]
summary: 北宋都城
note: keep-world
---

# 汴京

御街很长。
`

describe('card frontmatter parse', () => {
  it('parses all character and worldbook fields', () => {
    expect(parseCharacterCardFrontmatter('人物卡/林冲.md', FULL_CHARACTER)).toEqual({
      name: '林冲',
      aliases: ['豹子头', '林教头'],
      role: '配角',
      gender: '男',
      age: '28',
      faction: '梁山',
      tags: ['禁军', '枪棒'],
      status: 'alive',
      relations: [
        { to: '鲁智深', kind: '兄弟' },
        { to: '高俅', kind: '仇敌' },
      ],
      summary: '八十万禁军教头',
    })
    expect(parseWorldbookCardFrontmatter('世界书/汴京.md', FULL_WORLDBOOK)).toEqual({
      triggers: ['汴京', '东京'],
      enabled: true,
      priority: 8,
      category: '地点',
      tags: ['都城'],
      summary: '北宋都城',
    })
  })

  it('defaults missing fields and fail-opens malformed frontmatter', () => {
    expect(parseCharacterCardFrontmatter('人物卡/鲁智深.md', '# 鲁智深\n\n花和尚。')).toEqual({ name: '鲁智深' })
    expect(parseWorldbookCardFrontmatter('世界书/旧设定.md', '# 旧设定')).toEqual({
      triggers: ['旧设定'],
      enabled: true,
      priority: 0,
    })
    expect(parseCharacterCardFrontmatter('人物卡/坏.md', '---\n: not a field\n---\n正文')).toEqual({ name: '坏' })
    expect(parseCharacterCardFrontmatter('人物卡/坏.md', '---\naliases: not-a-list\n---\n')).toMatchObject({ name: '坏' })
    expect(parseWorldbookCardFrontmatter('世界书/坏.md', '---\nnot yaml\n---\n')).toEqual({
      triggers: ['坏'],
      enabled: true,
      priority: 0,
    })
  })

  it('extracts summary from frontmatter or the first non-heading paragraph', () => {
    expect(extractCardSummary(FULL_CHARACTER, '八十万禁军教头')).toBe('八十万禁军教头')
    expect(extractCardSummary('# 标题\n\n第一段超过一百二十字的内容会被截断' + '甲'.repeat(200), undefined).length).toBe(120)
    expect(extractCardSummary('---\nname: 甲\n---\n# 甲\n\n正文摘要。\n', undefined)).toBe('正文摘要。')
  })

  it('roundtrips YAML parse(serialize(x)) for typed fields', () => {
    const fields = {
      name: '林冲',
      aliases: ['豹子头'],
      role: '配角',
      gender: '男',
      age: '28',
      faction: '梁山',
      tags: ['禁军'],
      status: 'alive',
      relations: [{ to: '鲁智深', kind: '兄弟' }],
      summary: '教头',
      triggers: ['汴京'],
      enabled: false,
      priority: 3,
      category: '地点',
    }
    const serialized = serializeCardFrontmatter(fields)
    expect(parseSerializedCardFields(serialized)).toEqual(fields)
  })
})
