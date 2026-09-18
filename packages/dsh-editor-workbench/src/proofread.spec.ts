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
  ProofreadError,
  SENSITIVE_ALLOW_PATH,
  SENSITIVE_LIST_PATH,
  authorDocumentPath,
  parseTermList,
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

describe('bundled proofread resources', () => {
  it('keeps typos.json and sensitive-default.txt aligned with the runtime defaults', () => {
    expect(JSON.parse(readFileSync(path.join(resources, 'typos.json'), 'utf8'))).toEqual(BUNDLED_TYPOS)
    expect(readFileSync(path.join(resources, 'sensitive-default.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(BUNDLED_SENSITIVE_TEXT.replace(/\r\n/g, '\n'))
    expect(BUNDLED_TYPOS.length).toBeGreaterThanOrEqual(60)
    expect(parseTermList(BUNDLED_SENSITIVE_TEXT).length).toBeGreaterThanOrEqual(80)
  })
})

describe('scanProofread', () => {
  it('scans a single author document and walks every visible md/txt for the manuscript token', async () => {
    await write('正文/10.md', '他说,然后走了。')
    await write('正文/2.md', '的时后到了。')
    await write('正文/.hidden.md', '的的')
    await write('大纲/总纲.md', '冰毒')
    await write('README.md', '的时后。')
    await write('资料/说明.txt', '他说,好。')
    await write('.dsh-editor/秘密.md', '的的')
    await write('dist/out.md', '他说,生成。')
    const document = await scanProofread({ access: access(), scope: 'document', path: '正文/2.md', kinds: ['typo'] })
    expect(document.scannedFiles).toBe(1)
    expect(document.findings).toMatchObject([{ path: '正文/2.md', suggestion: '的时候', version: expect.any(String) }])
    const outline = await scanProofread({ access: access(), scope: 'document', path: '大纲/总纲.md', kinds: ['sensitive'] })
    expect(outline.findings).toMatchObject([{ path: '大纲/总纲.md', message: '敏感词「冰毒」' }])
    const manuscript = await scanProofread({ access: access(), scope: 'manuscript', kinds: ['punctuation', 'typo'] })
    expect(manuscript.scannedFiles).toBe(5)
    expect(manuscript.findings.map((item) => item.path)).toEqual(['正文/2.md', '正文/10.md', '资料/说明.txt', 'README.md'])
    expect(manuscript.findings.some((item) => item.path.includes('.hidden') || item.path.includes('.dsh-editor') || item.path.startsWith('dist/'))).toBe(false)
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

  it('aggregates manuscript habit across files instead of summing per-file findings', async () => {
    await write('正文/dense.md', `${'然后。'.repeat(8)}${'甲'.repeat(50)}`)
    await write('正文/padding.md', `${'乙'.repeat(10_000)}`)
    const alone = await scanProofread({ access: access(), scope: 'document', path: '正文/dense.md', kinds: ['habit'] })
    expect(alone.findings).toHaveLength(8)
    expect(alone.habitStats[0]).toMatchObject({ term: '然后', count: 8 })
    expect(alone.habitStats[0]!.perThousand).toBeGreaterThan(3)

    const manuscript = await scanProofread({ access: access(), scope: 'manuscript', kinds: ['habit'] })
    expect(manuscript.scannedFiles).toBe(2)
    expect(manuscript.habitStats[0]).toMatchObject({ term: '然后', count: 8 })
    expect(manuscript.habitStats[0]!.perThousand).toBeLessThanOrEqual(3)
    expect(manuscript.findings.filter((item) => item.kind === 'habit')).toEqual([])
  })
})

describe('card', () => {
  it('fails closed when card is requested and never runs it by default', async () => {
    await write('正文/001.md', '林见走了，她没有回头。他加入了青峰门。')
    await write('人物卡/林见.md', '---\nname: 林见\ngender: 男\n---\n\n# 林见\n')
    await expect(scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['card'] }))
      .rejects.toMatchObject({ name: 'ProofreadError', code: 'INVALID' })
    await expect(scanProofread({ access: access(), scope: 'document', path: '正文/001.md', kinds: ['punctuation', 'card'] }))
      .rejects.toMatchObject({ name: 'ProofreadError', code: 'INVALID' })
    const omitted = await scanProofread({ access: access(), scope: 'manuscript' })
    expect(omitted.findings.some((item) => item.kind === 'card')).toBe(false)
    expect(omitted.habitStats).toEqual([])
  })
})
