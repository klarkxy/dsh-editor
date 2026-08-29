import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsTargetLike } from '../host.ts'
import type { WorkspaceFileContext } from './files.ts'
import { SearchError, searchWorkspaceText } from './search.ts'

let root = ''
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-search-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function nativeFs(): FileSystemLike {
  const target = (value: string): FsTargetLike => ({ targetKey: path.resolve(value), displayPath: path.resolve(value) })
  const kind = (state: import('node:fs').Stats): 'file' | 'directory' | 'other' => state.isFile() ? 'file' : state.isDirectory() ? 'directory' : 'other'
  return {
    async resolve(value, opts) { return target(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? root, value)) },
    contains(parent, child) { const relative = path.relative(parent.targetKey, child.targetKey); return !relative.startsWith('..') && !path.isAbsolute(relative) },
    async stat(value) { try { const state = await fs.stat(value.targetKey); return { type: kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async lstat(value, opts) { try { const state = await fs.lstat(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? root, value)); return { type: state.isSymbolicLink() ? 'symlink' : kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async readText(value) { return await fs.readFile(value.targetKey, 'utf8') },
    async listDir(value) { return (await fs.readdir(value.targetKey, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const, target: target(path.join(value.targetKey, entry.name)) })) },
    async writeText() { throw new Error('search is read-only') },
  }
}

function context(): WorkspaceFileContext {
  return {
    fs: nativeFs(),
    cwd: root,
    root: { targetKey: path.resolve(root), displayPath: path.resolve(root) },
    policy: { mode: 'read-only', workspaceRoot: root },
  }
}

describe('bounded author text search', () => {
  it('finds case-insensitive literal matches with stable positions and snippets', async () => {
    await fs.mkdir(path.join(root, '正文', '第一卷'), { recursive: true })
    await fs.writeFile(path.join(root, '正文', '第一卷', '010.md'), '序\n月光落在船舷上\n月光再次出现')
    await fs.writeFile(path.join(root, '正文', '020.txt'), 'MOON 不是月光')
    const result = await searchWorkspaceText({ files: context(), query: '月光', scope: 'manuscript' })
    expect(result).toMatchObject({ scannedFiles: 2, truncated: false })
    expect(result.results).toEqual([
      expect.objectContaining({ path: '正文/020.txt', line: 1, column: 8 }),
      expect.objectContaining({ path: '正文/第一卷/010.md', line: 2, column: 1, start: 2, end: 4 }),
      expect.objectContaining({ path: '正文/第一卷/010.md', line: 3, column: 1 }),
    ])
  })

  it('searches project notes while excluding hidden, generated, and non-text paths', async () => {
    await fs.mkdir(path.join(root, '.dsh-editor', 'archive'), { recursive: true })
    await fs.mkdir(path.join(root, 'dist'))
    await fs.mkdir(path.join(root, '人物卡'))
    await fs.writeFile(path.join(root, '.dsh-editor', 'archive', 'hidden.md'), '密码')
    await fs.writeFile(path.join(root, 'dist', 'generated.md'), '密码')
    await fs.writeFile(path.join(root, '人物卡', '阿明.md'), '密码是红色')
    await fs.writeFile(path.join(root, '图片.png'), '密码')
    const result = await searchWorkspaceText({ files: context(), query: '密码' })
    expect(result.results.map((item) => item.path)).toEqual(['人物卡/阿明.md'])
    expect(result.skipped).toBeGreaterThanOrEqual(3)
  })

  it('rejects empty, multiline, control, and oversized queries', async () => {
    await expect(searchWorkspaceText({ files: context(), query: '   ' })).rejects.toBeInstanceOf(SearchError)
    await expect(searchWorkspaceText({ files: context(), query: 'a\nb' })).rejects.toMatchObject({ code: 'BAD_QUERY' })
    await expect(searchWorkspaceText({ files: context(), query: 'x'.repeat(121) })).rejects.toMatchObject({ code: 'BAD_QUERY' })
  })

  it('returns an honest empty manuscript result when the manuscript directory is absent', async () => {
    await expect(searchWorkspaceText({ files: context(), query: '测试', scope: 'manuscript' })).resolves.toMatchObject({ results: [], scannedFiles: 0, truncated: false })
  })
})
