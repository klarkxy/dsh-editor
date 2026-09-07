import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import type { OverviewAccess } from './overview.ts'
import { BUNDLED_SENSITIVE_TEXT, BUNDLED_TYPOS } from './proofread-defaults.ts'
import {
  HABIT_MAX_OCCURRENCES,
  PROOFREAD_MAX_FINDINGS,
  ProofreadError,
  SENSITIVE_ALLOW_PATH,
  SENSITIVE_LIST_PATH,
  authorDocumentPath,
  parseTermList,
  proofreadText,
  scanProofread,
} from './proofread.ts'

const resources = fileURLToPath(new URL('../resources/proofread', import.meta.url))

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-proofread-'))
  await fs.mkdir(path.join(root, '正文'), { recursive: true })
  await fs.mkdir(path.join(root, '大纲'), { recursive: true })
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

function kindsOf(text: string, kinds: Array<'punctuation' | 'sensitive' | 'repeat' | 'typo' | 'habit' | 'card'>, extra?: Parameters<typeof proofreadText>[1]) {
  return proofreadText(text, { path: '正文/测.md', version: 'v1', kinds, ...extra })
}

describe('bundled proofread resources', () => {
  it('keeps typos.json and sensitive-default.txt aligned with the runtime defaults', () => {
    expect(JSON.parse(readFileSync(path.join(resources, 'typos.json'), 'utf8'))).toEqual(BUNDLED_TYPOS)
    expect(readFileSync(path.join(resources, 'sensitive-default.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(BUNDLED_SENSITIVE_TEXT.replace(/\r\n/g, '\n'))
    expect(BUNDLED_TYPOS.length).toBeGreaterThanOrEqual(60)
    expect(parseTermList(BUNDLED_SENSITIVE_TEXT).length).toBeGreaterThanOrEqual(80)
  })
})

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
    expect(kindsOf('然后然后离开。', ['repeat']).findings).toMatchObject([{ message: '词语重复「然后」' }])
    expect(kindsOf('他慢慢走，常常想想，谢谢妈妈爸爸。', ['repeat']).findings).toEqual([])
    expect(kindsOf('渐渐天亮了。', ['repeat']).findings).toEqual([])
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

describe('scanProofread', () => {
  it('scans a single author document and walks manuscript chapters in natural order', async () => {
    await write('正文/10.md', '他说,然后走了。')
    await write('正文/2.md', '的时后到了。')
    await write('正文/.hidden.md', '的的')
    await write('大纲/总纲.md', '冰毒')
    const document = await scanProofread({ access: access(), scope: 'document', path: '正文/2.md', kinds: ['typo'] })
    expect(document.scannedFiles).toBe(1)
    expect(document.findings).toMatchObject([{ path: '正文/2.md', suggestion: '的时候', version: expect.any(String) }])
    const outline = await scanProofread({ access: access(), scope: 'document', path: '大纲/总纲.md', kinds: ['sensitive'] })
    expect(outline.findings).toMatchObject([{ path: '大纲/总纲.md', message: '敏感词「冰毒」' }])
    const manuscript = await scanProofread({ access: access(), scope: 'manuscript', kinds: ['punctuation', 'typo'] })
    expect(manuscript.scannedFiles).toBe(2)
    expect(manuscript.findings.map((item) => item.path)).toEqual(['正文/2.md', '正文/10.md'])
    expect(manuscript.findings.some((item) => item.path.includes('.hidden'))).toBe(false)
  })

  it('merges the user sensitive list with the bundled list and allowlist', async () => {
    await write('正文/001.md', '自定义词、忽略词、冰毒、普通。')
    await write(SENSITIVE_LIST_PATH, '# 用户\n自定义词\n忽略词\n')
    await write(SENSITIVE_ALLOW_PATH, '忽略词\n冰毒\n')
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['sensitive'] })
    expect(result.findings.map((item) => item.message)).toEqual(['敏感词「自定义词」'])
  })

  it('rejects invalid document scope paths with the workbench error style', async () => {
    await write('正文/001.md', '正文')
    await expect(scanProofread({ access: access(), scope: 'document' })).rejects.toMatchObject({ name: 'ProofreadError', code: 'INVALID_PATH' })
    await expect(scanProofread({ access: access(), scope: 'document', path: '正文/不存在.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(scanProofread({ access: access(), scope: 'document', path: '.dsh-editor/秘密.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(scanProofread({ access: access(), scope: 'document', path: '../escape.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(scanProofread({ access: access(), scope: 'document', path: '正文/001.png' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(scanProofread({ access: access(), scope: 'project', path: '正文/001.md' })).rejects.toMatchObject({ code: 'INVALID' })
    await expect(scanProofread({ access: access(), scope: 'manuscript', kinds: ['nope'] })).rejects.toMatchObject({ code: 'INVALID' })
    expect(() => authorDocumentPath('node_modules/x.md')).toThrow(ProofreadError)
  })

  it('allows a read-only workspace and comments in user lists', async () => {
    await write('正文/001.md', '自定义词')
    await write(SENSITIVE_LIST_PATH, '# comment\n自定义词 # inline\n\n')
    const result = await scanProofread({ access: access('read-only'), scope: 'manuscript', kinds: ['sensitive'] })
    expect(result.findings).toMatchObject([{ message: '敏感词「自定义词」' }])
  })
})

describe('card', () => {
  async function seedCards(): Promise<void> {
    await write('人物卡/林见.md', '---\nname: 林见\naliases: [见哥]\ngender: 男\n---\n\n# 林见\n')
    await write('人物卡/苏晚.md', '---\nname: 苏晚\ngender: female\n---\n\n# 苏晚\n')
    await write('世界书/青云门.md', '---\ntriggers: [青云门, 青云派]\n---\n\n# 青云门\n')
  }

  it('flags a pronoun/gender mismatch and offers the card pronoun', async () => {
    await seedCards()
    const text = '林见走了，她没有回头。'
    await write('正文/001.md', text)
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings.filter((item) => item.code === 'card-gender')).toMatchObject([{
      kind: 'card',
      code: 'card-gender',
      severity: 'warning',
      suggestion: '他',
      start: text.indexOf('她'),
      end: text.indexOf('她') + 1,
      message: '“林见”在人物卡中为男，此处用了“她”',
    }])
    expect(result.findings.filter((item) => item.code === 'card-nearmiss')).toEqual([])
  })

  it('does not flag when another opposite-gender character is in the sentence', async () => {
    await seedCards()
    await write('正文/001.md', '林见看着苏晚，她没有回头。')
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings.filter((item) => item.code === 'card-gender')).toEqual([])
  })

  it('ignores plural 她们', async () => {
    await seedCards()
    await write('正文/001.md', '林见走了，她们没有回头。')
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings.filter((item) => item.code === 'card-gender')).toEqual([])
  })

  it('flags a near-miss proper noun with the canonical term as suggestion', async () => {
    await seedCards()
    const text = '他加入了青峰门。'
    await write('正文/001.md', text)
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings).toMatchObject([{
      kind: 'card',
      code: 'card-nearmiss',
      severity: 'info',
      suggestion: '青云门',
      term: '青云门',
      start: text.indexOf('青峰门'),
      end: text.indexOf('青峰门') + 3,
      message: '“青峰门”疑似与设定“青云门”写法不一致',
    }])
  })

  it('does not report a known alias as a near-miss', async () => {
    await seedCards()
    await write('正文/001.md', '见哥走进青云派。')
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings.filter((item) => item.code === 'card-nearmiss')).toEqual([])
  })

  it('does not report a frequent variant that appears more than three times', async () => {
    await seedCards()
    await write('正文/001.md', '青峰门。青峰门。青峰门。青峰门。')
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings.filter((item) => item.code === 'card-nearmiss')).toEqual([])
  })

  it('excludes card findings when kinds is only punctuation', async () => {
    await seedCards()
    await write('正文/001.md', '林见走了，她没有回头。他加入了青峰门。')
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['punctuation'] })
    expect(result.findings.filter((item) => item.kind === 'card')).toEqual([])
  })

  it('returns no card findings and does not throw when card directories are missing', async () => {
    await write('正文/001.md', '林见走了，她没有回头。他加入了青峰门。')
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings).toEqual([])
    expect(result.skipped).toBe(0)
  })

  it('masks frontmatter and heading markers the same way as other analyzers', async () => {
    await seedCards()
    const text = '---\ntitle: 林见她青峰门\n---\n# 标题\n林见走了，她没有回头。\n'
    await write('正文/001.md', text)
    const result = await scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] })
    expect(result.findings.filter((item) => item.code === 'card-nearmiss')).toEqual([])
    expect(result.findings.filter((item) => item.code === 'card-gender')).toMatchObject([{
      start: text.lastIndexOf('她'),
      suggestion: '他',
    }])
  })

  it('includes card when kinds is omitted and supports manuscript scope', async () => {
    await seedCards()
    await write('正文/2.md', '林见走了，她没有回头。')
    await write('正文/10.md', '他加入了青峰门。')
    const result = await scanProofread({ access: access(), scope: 'manuscript' })
    expect(result.findings.some((item) => item.code === 'card-gender' && item.path === '正文/2.md')).toBe(true)
    expect(result.findings.some((item) => item.code === 'card-nearmiss' && item.path === '正文/10.md')).toBe(true)
    expect(result.habitStats).toEqual([])
  })
})
