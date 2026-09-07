import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import type { OverviewAccess } from './overview.ts'
import {
  CardsError,
  cardReferenceTerms,
  createCard,
  findLiteralHits,
  listCardReferences,
  listCards,
  setCardMeta,
} from './cards.ts'
import {
  extractCardSummary,
  parseCharacterCardFrontmatter,
  parseSerializedCardFields,
  parseWorldbookCardFrontmatter,
  serializeCardFrontmatter,
} from './frontmatter.ts'

let root = ''

class NodeFileSystem implements FileSystemLike {
  constructor(private readonly root: string) {}

  async resolve(value: string, opts?: { cwd?: string }): Promise<FsTargetLike> {
    const base = opts?.cwd ?? this.root
    return { targetKey: path.resolve(base, value), displayPath: path.resolve(base, value) }
  }

  contains(parent: FsTargetLike, child: FsTargetLike): boolean {
    const relative = path.relative(parent.targetKey, child.targetKey)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  async stat(target: FsTargetLike): Promise<FsInfoLike | undefined> {
    try {
      const value = await fs.stat(target.targetKey)
      return { type: value.isDirectory() ? 'directory' : value.isFile() ? 'file' : 'other', version: `${value.mtimeMs}:${value.size}`, size: value.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async lstat(value: string, opts?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    try {
      const target = path.resolve(opts?.cwd ?? this.root, value)
      const state = await fs.lstat(target)
      return { type: state.isSymbolicLink() ? 'symlink' : state.isDirectory() ? 'directory' : state.isFile() ? 'file' : 'other', version: `${state.mtimeMs}:${state.size}`, size: state.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async readText(target: FsTargetLike): Promise<string> { return await fs.readFile(target.targetKey, 'utf8') }

  async listDir(target: FsTargetLike): Promise<FsDirEntryLike[]> {
    const entries = await fs.readdir(target.targetKey, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
    }))
  }

  async writeText(target: FsTargetLike, content: string, expected?: FsWriteIntentLike, _signal?: AbortSignal, _policy?: SandboxExecutionPolicyLike): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const before = await this.readText(target).catch(() => null)
    const current = await this.stat(target)
    if (expected?.kind === 'createIfAbsent' && current) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (expected?.kind === 'replaceIfVersion' && current?.version !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    await fs.writeFile(target.targetKey, content, 'utf8')
    return { operation: before === null ? 'create' : 'update', version: (await this.stat(target))!.version, before, after: content }
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-cards-'))
  await fs.mkdir(path.join(root, '正文'), { recursive: true })
  await fs.mkdir(path.join(root, '人物卡'), { recursive: true })
  await fs.mkdir(path.join(root, '世界书'), { recursive: true })
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function access(mode = 'workspace-write'): OverviewAccess {
  const fileSystem = new NodeFileSystem(root)
  const files: WorkspaceFileContext = {
    fs: fileSystem,
    cwd: root,
    root: { targetKey: root, displayPath: root },
    policy: { mode: mode as 'workspace-write' | 'read-only', workspaceRoot: root },
  }
  return { path: root, rootKey: root, mode, files }
}

async function write(relative: string, text: string): Promise<void> {
  const target = path.join(root, ...relative.split('/'))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, text, 'utf8')
}

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

describe('cards.list', () => {
  it('lists cards in natural order and prefers frontmatter summary', async () => {
    await write('人物卡/10.md', '---\nname: 第十人\n---\n# 第十人\n\n正文十')
    await write('人物卡/2.md', FULL_CHARACTER)
    await write('人物卡/.hidden.md', '---\nname: 隐藏\n---\n')
    await write('世界书/港口.md', FULL_WORLDBOOK)
    await write('世界书/2-关卡.md', '---\ntriggers: [关卡]\n---\n# 关卡\n\n第一段摘要。')
    const listed = await listCards({ access: access(), kind: 'all' })
    expect(listed.characters.map((card) => card.path)).toEqual(['人物卡/2.md', '人物卡/10.md'])
    expect(listed.characters[0]).toMatchObject({
      title: '林冲',
      summary: '八十万禁军教头',
      frontmatter: expect.objectContaining({ name: '林冲', aliases: ['豹子头', '林教头'] }),
    })
    expect(listed.worldbook.map((card) => [card.path, card.title, card.summary])).toEqual([
      ['世界书/2-关卡.md', '2-关卡', '第一段摘要。'],
      ['世界书/港口.md', '港口', '北宋都城'],
    ])
    expect(listed.scannedFiles).toBe(4)
    expect(listed.truncated).toBe(false)
    expect(listed.characters.every((card) => typeof card.version === 'string' && typeof card.modifiedAt === 'string')).toBe(true)
  })

  it('can list a single kind', async () => {
    await write('人物卡/甲.md', '# 甲\n')
    await write('世界书/乙.md', '# 乙\n')
    const characters = await listCards({ access: access(), kind: 'character' })
    expect(characters.characters).toHaveLength(1)
    expect(characters.worldbook).toHaveLength(0)
    const worldbook = await listCards({ access: access(), kind: 'worldbook' })
    expect(worldbook.characters).toHaveLength(0)
    expect(worldbook.worldbook).toHaveLength(1)
    await expect(listCards({ access: access(), kind: 'nope' })).rejects.toMatchObject({ name: 'CardsError', code: 'INVALID' })
  })
})

describe('cards.metaSet', () => {
  it('rewrites only frontmatter, keeps the body and unknown keys, and rejects stale versions', async () => {
    await write('人物卡/林冲.md', FULL_CHARACTER)
    const listed = await listCards({ access: access(), kind: 'character' })
    const current = listed.characters[0]!
    const updated = await setCardMeta({
      access: access(),
      path: '人物卡/林冲.md',
      version: current.version,
      fields: { role: '主角', status: 'dead' },
    })
    const text = await fs.readFile(path.join(root, '人物卡', '林冲.md'), 'utf8')
    expect(text).toContain('custom: keep-me')
    expect(text).toContain('他是东京八十万禁军枪棒教头。')
    expect(text).toContain('role: 主角')
    expect(text).toContain('status: dead')
    expect(updated.path).toBe('人物卡/林冲.md')
    expect(updated.version).not.toBe(current.version)
    await expect(setCardMeta({
      access: access(),
      path: '人物卡/林冲.md',
      version: current.version,
      fields: { role: '配角' },
    })).rejects.toMatchObject({ name: 'CardsError', code: 'STALE' })
  })

  it('creates a frontmatter block when the file has none', async () => {
    await write('世界书/码头.md', '# 码头\n\n原文不动。')
    const listed = await listCards({ access: access(), kind: 'worldbook' })
    const written = await setCardMeta({
      access: access(),
      path: '世界书/码头.md',
      version: listed.worldbook[0]!.version,
      fields: { category: '地点', tags: ['水系'] },
    })
    const text = await fs.readFile(path.join(root, '世界书', '码头.md'), 'utf8')
    expect(text.startsWith('---\n')).toBe(true)
    expect(text.endsWith('# 码头\n\n原文不动。')).toBe(true)
    expect(text).toContain('category: 地点')
    expect(written.version).toBeTruthy()
  })
})

describe('cards.references', () => {
  it('selects terms from name/aliases or triggers and reports hit offsets', async () => {
    await write('人物卡/林冲.md', FULL_CHARACTER)
    await write('世界书/汴京.md', FULL_WORLDBOOK)
    await write('正文/2.md', '林冲走进汴京，豹子头尚未拔刀。')
    await write('正文/10.md', '东京雨很大。')
    expect(cardReferenceTerms('character', '人物卡/林冲.md', FULL_CHARACTER)).toEqual(expect.arrayContaining(['林冲', '豹子头', '林教头']))
    expect(cardReferenceTerms('worldbook', '世界书/汴京.md', FULL_WORLDBOOK)).toEqual(expect.arrayContaining(['汴京', '东京']))
    const hits = findLiteralHits('林冲走进汴京', ['林冲', '汴京'], '正文/2.md', 10)
    expect(hits).toEqual([
      { path: '正文/2.md', line: 1, column: 1, start: 0, end: 2, excerpt: '林冲走进汴京' },
      { path: '正文/2.md', line: 1, column: 5, start: 4, end: 6, excerpt: '林冲走进汴京' },
    ])
    const character = await listCardReferences({ access: access(), path: '人物卡/林冲.md' })
    expect(character.terms).toEqual(expect.arrayContaining(['林冲', '豹子头', '林教头']))
    expect(character.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '正文/2.md', start: 0, end: 2 }),
      expect.objectContaining({ path: '正文/2.md', excerpt: expect.stringContaining('豹子头') }),
    ]))
    const worldbook = await listCardReferences({ access: access(), path: '世界书/汴京.md' })
    expect(worldbook.hits.map((hit) => [hit.path, hit.start, hit.end])).toEqual(expect.arrayContaining([
      ['正文/2.md', 4, 6],
      ['正文/10.md', 0, 2],
    ]))
    expect(worldbook.scannedFiles).toBe(2)
  })
})

describe('cards.create', () => {
  it('creates a card with heading and rejects invalid names or duplicates', async () => {
    const created = await createCard({ access: access(), kind: 'character', title: '鲁智深', fields: { role: '配角' } })
    expect(created.path).toBe('人物卡/鲁智深.md')
    const text = await fs.readFile(path.join(root, '人物卡', '鲁智深.md'), 'utf8')
    expect(text).toContain('name: 鲁智深')
    expect(text).toContain('role: 配角')
    expect(text).toContain('# 鲁智深\n')
    await expect(createCard({ access: access(), kind: 'character', title: '鲁智深' })).rejects.toMatchObject({ name: 'CardsError', code: 'EXISTS' })
    await expect(createCard({ access: access(), kind: 'character', title: '../escape' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(createCard({ access: access(), kind: 'character', title: '.hidden' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(createCard({ access: access(), kind: 'worldbook', title: 'con' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    const world = await createCard({ access: access(), kind: 'worldbook', title: '港口.md', fields: { category: '地点' } })
    expect(world.path).toBe('世界书/港口.md')
    expect(await fs.readFile(path.join(root, '世界书', '港口.md'), 'utf8')).toContain('triggers: [港口]')
  })

  it('refuses writes on a read-only workspace', async () => {
    await write('人物卡/甲.md', '# 甲\n')
    const listed = await listCards({ access: access(), kind: 'character' })
    await expect(createCard({ access: access('read-only'), kind: 'character', title: '乙' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(setCardMeta({
      access: access('read-only'),
      path: '人物卡/甲.md',
      version: listed.characters[0]!.version,
      fields: { role: '主角' },
    })).rejects.toMatchObject({ code: 'READ_ONLY' })
  })
})
