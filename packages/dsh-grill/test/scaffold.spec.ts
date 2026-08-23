import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PathConfineError } from '../src/paths.ts'
import { scaffoldNovel, SCAFFOLD_FILES, ScaffoldError } from '../src/scaffold.ts'

let cwd = ''
let outside = ''

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-grill-'))
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-grill-outside-'))
})

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
})

describe('scaffoldNovel', () => {
  it('creates the reduced tree and skips on the second run without overwriting', async () => {
    const first = await scaffoldNovel({ cwd, target: '.', mode: 'workspace-write', workspaceRoot: cwd })
    expect(first.root).toBe('.')
    expect(first.created).toEqual(expect.arrayContaining(['正文', '大纲', '人物卡', '世界书', '项目总览.md', '大纲/总纲.md']))
    expect(first.created).not.toEqual(expect.arrayContaining(['.grill', 'scan_ai_flavor']))
    const original = await fs.readFile(path.join(cwd, '项目总览.md'), 'utf8')
    expect(original).toContain('# 项目总览')
    await fs.writeFile(path.join(cwd, '项目总览.md'), original + '\n作者改过\n', 'utf8')

    const second = await scaffoldNovel({ cwd, target: '.', mode: 'workspace-write', workspaceRoot: cwd })
    expect(second.created).toEqual([])
    expect(second.skipped.length).toBeGreaterThan(0)
    expect(await fs.readFile(path.join(cwd, '项目总览.md'), 'utf8')).toContain('作者改过')
    for (const rel of Object.keys(SCAFFOLD_FILES)) {
      await expect(fs.stat(path.join(cwd, ...rel.split('/')))).resolves.toBeTruthy()
    }
  })

  it('rejects absolute targets, traversal, and missing cwd', async () => {
    await expect(scaffoldNovel({ cwd: '', target: '.', mode: 'workspace-write' })).rejects.toMatchObject({
      code: 'NO_WORKSPACE',
    })
    await expect(
      scaffoldNovel({ cwd, target: '/etc/passwd', mode: 'workspace-write', workspaceRoot: cwd }),
    ).rejects.toBeInstanceOf(PathConfineError)
    await expect(
      scaffoldNovel({ cwd, target: '../outside', mode: 'workspace-write', workspaceRoot: cwd }),
    ).rejects.toBeInstanceOf(PathConfineError)
  })

  it('denies read-only sandbox before touching the tree', async () => {
    await expect(scaffoldNovel({ cwd, mode: 'read-only', workspaceRoot: cwd })).rejects.toMatchObject({
      code: 'READ_ONLY',
    })
    await expect(fs.stat(path.join(cwd, '正文'))).rejects.toThrow()
  })

  it('observes abort before creating files', async () => {
    const signal = AbortSignal.abort()
    await expect(
      scaffoldNovel({ cwd, mode: 'workspace-write', workspaceRoot: cwd, signal }),
    ).rejects.toBeInstanceOf(ScaffoldError)
  })

  it('rejects an ancestor link even when it resolves inside the workspace', async () => {
    const inside = path.join(cwd, 'inside')
    const link = path.join(cwd, 'link')
    await fs.mkdir(inside)
    await fs.symlink(inside, link, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(
      scaffoldNovel({ cwd, target: 'link/new', mode: 'workspace-write', workspaceRoot: cwd }),
    ).rejects.toMatchObject({ code: 'SYMLINK' })
    await expect(fs.stat(path.join(inside, 'new'))).rejects.toThrow()
  })

  it('rejects an ancestor link before it can create files outside the workspace', async () => {
    const link = path.join(cwd, 'link')
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(
      scaffoldNovel({ cwd, target: 'link/new', mode: 'workspace-write', workspaceRoot: cwd }),
    ).rejects.toMatchObject({ code: 'SYMLINK' })
    await expect(fs.stat(path.join(outside, 'new'))).rejects.toThrow()
  })
})
