import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compileContext, extractHeadingSection } from '../src/context.ts'
import { PathConfineError } from '../src/paths.ts'

let cwd = ''

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-grill-ctx-'))
  await fs.mkdir(path.join(cwd, '大纲'))
  await fs.mkdir(path.join(cwd, '人物卡'))
  await fs.mkdir(path.join(cwd, '世界书'))
  await fs.mkdir(path.join(cwd, '正文'))
  await fs.writeFile(path.join(cwd, '大纲', '总纲.md'), '# 总纲\n长期欲望：活下去。\n', 'utf8')
  await fs.writeFile(path.join(cwd, '人物卡', '人物索引.md'), '| 陈砺 | 出山 |\n', 'utf8')
  await fs.writeFile(path.join(cwd, '人物卡', '陈砺.md'), '陈砺，铁尺。\n不懂身份证。\n', 'utf8')
  await fs.writeFile(
    path.join(cwd, '世界书', '设定总汇.md'),
    '# 设定\n\n## 已确认\n城里有隐修。\n\n## 草稿\n不要写系统。\n',
    'utf8',
  )
  await fs.writeFile(path.join(cwd, '正文', '出山.md'), `${'雾。'.repeat(40)}\n铁尺。\n`, 'utf8')
  await fs.writeFile(path.join(cwd, '正文', '夜班.md'), `${'货架。'.repeat(40)}\n沈晚宁。\n`, 'utf8')
})

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true })
})

describe('compileContext', () => {
  it('packs outline, named card, confirmed worldbook, and previous chapter tail', async () => {
    const pack = await compileContext(cwd, { focus: '正文/夜班.md' })
    expect(pack.outline).toMatch(/活下去/)
    expect(pack.characters).toMatch(/陈砺/)
    expect(pack.world).toMatch(/隐修/)
    expect(pack.world).not.toMatch(/系统/)
    expect(pack.recent).toMatch(/出山/)
    expect(pack.missing).toEqual([])
  })

  it('lists missing files instead of inventing them', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-grill-ctx-empty-'))
    const pack = await compileContext(empty, { focus: '正文/没有.md' })
    expect(pack.missing.join('\n')).toMatch(/大纲/)
    expect(pack.missing.join('\n')).toMatch(/人物卡/)
    expect(pack.missing.join('\n')).toMatch(/世界书/)
    expect(pack.outline).toBe('')
    await fs.rm(empty, { recursive: true, force: true })
  })

  it('prefers a named character card and respects the char budget', async () => {
    const pack = await compileContext(cwd, { focus: '陈砺', chars: 1200 })
    expect(pack.characters).toMatch(/铁尺/)
    expect(pack.outline.length + pack.characters.length + pack.world.length + pack.recent.length).toBeLessThanOrEqual(1300)
  })

  it('fails closed on path escape', async () => {
    await expect(compileContext(cwd, { focus: '../secret.md' })).rejects.toBeInstanceOf(PathConfineError)
  })

  it('extracts a heading section', () => {
    expect(extractHeadingSection('## 已确认\nA\n\n## 草稿\nB\n', '已确认')).toBe('A')
  })
})
