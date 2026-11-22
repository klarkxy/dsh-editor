import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_TEXT_BYTES, readTextFile, type FileSystemLike, type FsDirEntryLike, type FsInfoLike, type FsPathInfoLike, type FsTargetLike, type FsWriteIntentLike, type SandboxExecutionPolicyLike } from 'dsh-manuscript/host-api'
import {
  applyEditsToText,
  applyEditsWithRanges,
  applyWritingChange,
  getWritingChange,
  parseWritingChange,
  undoWritingChange,
  WritingChangeError,
  type WritingChangeAccess,
} from './writing-change.ts'
import { createWritingChangeTool } from './change-tool.ts'

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-writing-'))
  await fs.mkdir(path.join(root, '正文'))
  await fs.mkdir(path.join(root, 'notes'))
})
afterEach(async () => {
  if (!path.basename(root).startsWith('dsh-writing-') || path.dirname(root) !== os.tmpdir()) throw new Error('unsafe fixture cleanup')
  await fs.rm(root, { recursive: true, force: true })
})

function access(options: { dirty?: string[]; readonly?: boolean } = {}): WritingChangeAccess {
  const dirty = new Set(options.dirty ?? [])
  return {
    path: root, rootKey: root, mode: options.readonly ? 'read-only' : 'workspace-write', sessionId: 'author-session',
    files: { fs: new NodeFileSystem(root), cwd: root, root: { targetKey: root, displayPath: root }, policy: { mode: options.readonly ? 'read-only' : 'workspace-write', workspaceRoot: root } },
    hasDraft: (relative) => dirty.has(relative),
  }
}

const fastWait = { wait: () => Promise.resolve(), draftPollMs: 1, draftTimeoutMs: 4 }

async function journalIds(): Promise<string[]> {
  const dir = path.join(root, '.dsh-editor', 'history', 'writing')
  try { return (await fs.readdir(dir)).filter((name) => name.endsWith('.json')) } catch { return [] }
}

async function text(relative: string): Promise<string | null> {
  return await fs.readFile(path.join(root, ...relative.split('/')), 'utf8').catch(() => null)
}

describe('writing_change direct writes', () => {
  it('applies two edits in one call, journals the change, and returns a receipt', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '甲先到了码头。\n\n乙在茶馆等他。')
    const { receipt } = await applyWritingChange(access(), parseWritingChange({
      kind: 'edit', path: '正文/001.md', summary: '改成夜晚',
      edits: [{ oldText: '甲先到了码头', newText: '甲深夜到了码头' }, { oldText: '乙在茶馆等他', newText: '乙在渡口等他' }],
    }))
    expect(await text('正文/001.md')).toBe('甲深夜到了码头。\n\n乙在渡口等他。')
    expect(receipt).toMatchObject({ marker: 'dsh-editor.writing-change', kind: 'edit', status: 'applied', count: 2, paths: ['正文/001.md'] })
    expect(await journalIds()).toHaveLength(1)
    const record = await getWritingChange(access(), receipt.id)
    expect(record.files[0]).toMatchObject({ path: '正文/001.md', after: '甲深夜到了码头。\n\n乙在渡口等他。' })
  })

  it('fails without writing or journaling on missing, ambiguous, or overlapping oldText', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '哈哈 哈哈')
    const apply = (edits: { oldText: string; newText: string }[]) => applyWritingChange(access(), {
      kind: 'edit', path: '正文/001.md', summary: 's', edits,
    })
    await expect(apply([{ oldText: '不存在', newText: 'x' }])).rejects.toMatchObject({ code: 'STALE' })
    await expect(apply([{ oldText: '哈哈', newText: 'x' }])).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    await expect(apply([{ oldText: '哈哈 哈', newText: 'a' }, { oldText: '哈 哈哈', newText: 'b' }])).rejects.toMatchObject({ code: 'INVALID' })
    expect(await text('正文/001.md')).toBe('哈哈 哈哈')
    expect(await journalIds()).toHaveLength(0)
  })

  it('fills a currently blank file with a single empty oldText and rejects it otherwise', async () => {
    await fs.writeFile(path.join(root, '正文', 'blank.md'), '   \n')
    const { receipt } = await applyWritingChange(access(), {
      kind: 'edit', path: '正文/blank.md', summary: 'fill', edits: [{ oldText: '', newText: '# 新章\n' }],
    })
    expect(await text('正文/blank.md')).toBe('# 新章\n')
    expect(receipt.count).toBe(1)
    await expect(applyWritingChange(access(), { kind: 'edit', path: '正文/blank.md', summary: 's', edits: [{ oldText: '', newText: 'x' }] }))
      .rejects.toMatchObject({ code: 'INVALID' })
    await expect(applyWritingChange(access(), { kind: 'edit', path: '正文/blank.md', summary: 's', edits: [{ oldText: '', newText: 'x' }, { oldText: '新章', newText: 'y' }] }))
      .rejects.toMatchObject({ code: 'INVALID' })
  })

  it('creates a new file exclusively and refuses an existing target even when empty', async () => {
    const { receipt } = await applyWritingChange(access(), { kind: 'create', path: 'notes/new.md', summary: '新建', text: '# 备忘\n' })
    expect(await text('notes/new.md')).toBe('# 备忘\n')
    expect(receipt.kind).toBe('create')
    await fs.writeFile(path.join(root, '正文', 'empty.md'), '')
    await expect(applyWritingChange(access(), { kind: 'create', path: '正文/empty.md', summary: 'x', text: 'y' })).rejects.toThrow()
    expect(await text('正文/empty.md')).toBe('')
  })

  it('splits a file at a unique anchor and archives nothing', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '上半章。\n\n第二章开始。')
    const { receipt } = await applyWritingChange(access(), {
      kind: 'split', path: '正文/001.md', summary: '拆章', anchor: '第二章开始。', newPath: '正文/002.md',
    })
    expect(await text('正文/001.md')).toBe('上半章。')
    expect(await text('正文/002.md')).toBe('第二章开始。')
    expect(receipt.paths).toEqual(['正文/001.md', '正文/002.md'])
    const undone = await undoWritingChange(access(), receipt.id)
    expect(undone.receipt.status).toBe('undone')
    expect(await text('正文/001.md')).toBe('上半章。\n\n第二章开始。')
    expect(await text('正文/002.md')).toBeNull()
  })

  it('merges source into target and archives the source, then restores on undo', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '第一章。')
    await fs.writeFile(path.join(root, '正文', '002.md'), '第二章。')
    const { receipt } = await applyWritingChange(access(), {
      kind: 'merge', path: '正文/001.md', summary: '合并', sourcePath: '正文/002.md',
    })
    expect(await text('正文/001.md')).toBe('第一章。\n\n第二章。\n')
    expect(await text('正文/002.md')).toBeNull()
    const record = await getWritingChange(access(), receipt.id)
    expect(record.archiveId).toMatch(/^[0-9a-f-]{36}$/)
    const undone = await undoWritingChange(access(), receipt.id)
    expect(undone.receipt.status).toBe('undone')
    expect(await text('正文/001.md')).toBe('第一章。')
    expect(await text('正文/002.md')).toBe('第二章。')
  })

  it('renames files without replacing and reverses the moves on undo', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await fs.writeFile(path.join(root, '正文', '002.md'), 'two')
    await fs.mkdir(path.join(root, '正文', '卷一'))
    const { receipt } = await applyWritingChange(access(), {
      kind: 'renames', summary: '整理',
      renames: [{ from: '正文/001.md', to: 'notes/a.md' }, { from: '正文/002.md', to: '正文/卷一/002.md' }],
    })
    expect(await text('notes/a.md')).toBe('one')
    expect(await text('正文/卷一/002.md')).toBe('two')
    expect(await text('正文/001.md')).toBeNull()
    expect(receipt.count).toBe(2)
    const undone = await undoWritingChange(access(), receipt.id)
    expect(undone.receipt.status).toBe('undone')
    expect(await text('正文/001.md')).toBe('one')
    expect(await text('正文/002.md')).toBe('two')
    await fs.writeFile(path.join(root, 'notes', 'occupied.md'), 'occupied')
    await expect(applyWritingChange(access(), { kind: 'renames', summary: 'x', renames: [{ from: '正文/001.md', to: 'notes/occupied.md' }] }))
      .rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('rejects a rename whose target parent is missing before moving anything', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await expect(applyWritingChange(access(), {
      kind: 'renames', summary: 'x', renames: [{ from: '正文/001.md', to: 'missing/dir/a.md' }],
    })).rejects.toMatchObject({ code: 'INVALID' })
    expect(await text('正文/001.md')).toBe('one')
    expect(await journalIds()).toHaveLength(0)
  })

  it('undoes an untouched edit wholesale and skips regions the author changed', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '第一句。中间句。最后一句。')
    const { receipt } = await applyWritingChange(access(), {
      kind: 'edit', path: '正文/001.md', summary: 's',
      edits: [{ oldText: '第一句', newText: '第一句改' }, { oldText: '最后一句', newText: '最后一句改' }],
    })
    const clean = await undoWritingChange(access(), receipt.id)
    expect(clean.receipt.status).toBe('undone')
    expect(await text('正文/001.md')).toBe('第一句。中间句。最后一句。')

    const again = await applyWritingChange(access(), {
      kind: 'edit', path: '正文/001.md', summary: 's',
      edits: [{ oldText: '第一句', newText: '第一句改' }, { oldText: '最后一句', newText: '最后一句改' }],
    })
    await fs.writeFile(path.join(root, '正文', '001.md'), '作者重写了开头。中间句。最后一句改。')
    const partial = await undoWritingChange(access(), again.receipt.id)
    expect(partial.receipt.status).toBe('undone')
    expect(partial.receipt.message).toContain('1 处')
    expect(await text('正文/001.md')).toBe('作者重写了开头。中间句。最后一句。')
  })

  it('refuses edit undo when nothing is reversible and refuses create undo after modification', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '原文。')
    const { receipt } = await applyWritingChange(access(), {
      kind: 'edit', path: '正文/001.md', summary: 's', edits: [{ oldText: '原文', newText: '改后' }],
    })
    await fs.writeFile(path.join(root, '正文', '001.md'), '完全不同的内容。')
    await expect(undoWritingChange(access(), receipt.id)).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(await text('正文/001.md')).toBe('完全不同的内容。')
    expect((await getWritingChange(access(), receipt.id)).status).toBe('applied')

    const created = await applyWritingChange(access(), { kind: 'create', path: 'notes/new.md', summary: 'c', text: 'agent text' })
    await fs.writeFile(path.join(root, 'notes', 'new.md'), 'author text')
    await expect(undoWritingChange(access(), created.receipt.id)).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(await text('notes/new.md')).toBe('author text')
    const still = await applyWritingChange(access(), { kind: 'create', path: 'notes/fresh.md', summary: 'c', text: 'keep' })
    const undone = await undoWritingChange(access(), still.receipt.id)
    expect(undone.receipt.status).toBe('undone')
    expect(await text('notes/fresh.md')).toBeNull()
    const noop = await undoWritingChange(access(), still.receipt.id)
    expect(noop.receipt.status).toBe('undone')
  })

  it('blocks while a target draft stays dirty and proceeds when it clears inside the wait', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '原文。')
    const change = { kind: 'edit' as const, path: '正文/001.md', summary: 's', edits: [{ oldText: '原文', newText: '改后' }] }
    await expect(applyWritingChange(access({ dirty: ['正文/001.md'] }), change, fastWait)).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(await text('正文/001.md')).toBe('原文。')
    expect(await journalIds()).toHaveLength(0)

    let calls = 0
    const clearing: WritingChangeAccess = { ...access(), hasDraft: () => calls++ < 2 }
    const { receipt } = await applyWritingChange(clearing, change, fastWait)
    expect(receipt.status).toBe('applied')
    expect(await text('正文/001.md')).toBe('改后。')
  })

  it('refuses read-only workspaces before touching files', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '原文。')
    await expect(applyWritingChange(access({ readonly: true }), {
      kind: 'edit', path: '正文/001.md', summary: 's', edits: [{ oldText: '原文', newText: '改后' }],
    })).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(await text('正文/001.md')).toBe('原文。')
    expect(await journalIds()).toHaveLength(0)
  })

  it('recovers a receipt whose journal stopped mid-write', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '原文。')
    const { receipt } = await applyWritingChange(access(), {
      kind: 'edit', path: '正文/001.md', summary: 's', edits: [{ oldText: '原文', newText: '改后' }],
    })
    const journal = path.join(root, '.dsh-editor', 'history', 'writing', `${receipt.id}.json`)
    const stored = JSON.parse(await fs.readFile(journal, 'utf8'))
    await fs.writeFile(journal, JSON.stringify({ ...stored, writing: true }))
    expect((await getWritingChange(access(), receipt.id)).writing).toBe(false)
    await fs.writeFile(path.join(root, '正文', '001.md'), '别的内容。')
    await fs.writeFile(journal, JSON.stringify({ ...stored, writing: true }))
    const partial = await getWritingChange(access(), receipt.id)
    expect(partial.message).toContain('未完成')
  })
})

describe('writing_change tool schema', () => {
  it('exposes no version parameters and requires the documented fields', () => {
    const tool = createWritingChangeTool(async () => access()) as unknown as {
      name: string
      description: string
      parameters: Record<string, unknown>
      isConcurrencySafe(): boolean
    }
    expect(tool.name).toBe('writing_change')
    expect(tool.isConcurrencySafe()).toBe(false)
    const serialized = JSON.stringify(tool.parameters)
    expect(serialized).not.toContain('targetVersion')
    expect(serialized).not.toContain('sourceVersion')
    expect(serialized).not.toContain('version')
    const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? tool.parameters
    expect(Object.keys(properties)).toEqual(['kind', 'path', 'summary', 'edits', 'text', 'anchor', 'newPath', 'sourcePath', 'renames'])
  })
})

describe('applyEditsToText', () => {
  it('rejects identical old/new text at parse time', () => {
    expect(() => parseWritingChange({ kind: 'edit', path: 'a.md', summary: 's', edits: [{ oldText: 'x', newText: 'x' }] }))
      .toThrow(WritingChangeError)
  })

  it('records after-ranges that still match in the rewritten file', () => {
    const applied = applyEditsWithRanges('第一句。最后一句。', [
      { oldText: '第一句', newText: '第一句改' },
      { oldText: '最后一句', newText: '最后一句改' },
    ])
    expect(applied.text).toBe('第一句改。最后一句改。')
    for (const edit of applied.edits) {
      expect(applied.text.slice(edit.afterStart, edit.afterEnd)).toBe(edit.newText)
    }
  })
})

describe('writing_change review follow-ups', () => {
  it('does not undo a later unique copy of the new text after the author rewrote the original sentence', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '他住在北门。\n\n后记。')
    const { receipt } = await applyWritingChange(access(), parseWritingChange({
      kind: 'edit', path: '正文/001.md', summary: '改门',
      edits: [{ oldText: '他住在北门', newText: '他住在南门' }],
    }))
    const rewritten = '他搬去了城外。\n\n后记。他住在南门。'
    await fs.writeFile(path.join(root, '正文', '001.md'), rewritten)
    await expect(undoWritingChange(access(), receipt.id)).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(await text('正文/001.md')).toBe(rewritten)
  })

  it('journals a one-sentence edit on a normally editable long manuscript', async () => {
    const body = `${'A'.repeat(1_200_000)}错字${'B'.repeat(80)}`
    await fs.writeFile(path.join(root, '正文', '001.md'), body)
    const { receipt } = await applyWritingChange(access(), parseWritingChange({
      kind: 'edit', path: '正文/001.md', summary: '改一个字',
      edits: [{ oldText: '错字', newText: '正字' }],
    }))
    expect(await text('正文/001.md')).toBe(`${'A'.repeat(1_200_000)}正字${'B'.repeat(80)}`)
    const journal = path.join(root, '.dsh-editor', 'history', 'writing', `${receipt.id}.json`)
    const stored = JSON.parse(await fs.readFile(journal, 'utf8')) as { files: Array<{ before: string | null; after: string | null; afterHash?: string }> }
    expect(Buffer.byteLength(JSON.stringify(stored, null, 2))).toBeLessThanOrEqual(MAX_TEXT_BYTES)
    expect(stored.files[0]?.before).toBeNull()
    expect(stored.files[0]?.after).toBeNull()
    expect(stored.files[0]?.afterHash).toMatch(/^[0-9a-f]{64}$/)
    const undone = await undoWritingChange(access(), receipt.id)
    expect(undone.receipt.status).toBe('undone')
    expect(await text('正文/001.md')).toBe(body)
  })

  it('refuses to write auxiliary author rule files including root AGENTS.md', async () => {
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# 原规则\n')
    expect(() => parseWritingChange({
      kind: 'edit', path: 'AGENTS.md', summary: '改规则',
      edits: [{ oldText: '原规则', newText: '第三方规则' }],
    })).toThrow(WritingChangeError)
    try {
      parseWritingChange({
        kind: 'edit', path: 'AGENTS.md', summary: '改规则',
        edits: [{ oldText: '原规则', newText: '第三方规则' }],
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'BLOCKED' })
    }
    expect(await text('AGENTS.md')).toBe('# 原规则\n')
    expect(await journalIds()).toHaveLength(0)
  })

  it('does not wait when a draft remains and draftTimeoutMs is 0', async () => {
    await fs.writeFile(path.join(root, '正文', '001.md'), '原文。')
    let waited = 0
    await expect(applyWritingChange(access({ dirty: ['正文/001.md'] }), {
      kind: 'edit', path: '正文/001.md', summary: 's', edits: [{ oldText: '原文', newText: '改后' }],
    }, {
      wait: async () => { waited += 1 },
      draftPollMs: 200,
      draftTimeoutMs: 0,
    })).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(waited).toBe(0)
    expect(await text('正文/001.md')).toBe('原文。')
  })
})
