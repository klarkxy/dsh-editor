import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDirectory, createManuscriptGroup, createProjectHome, initializeProject, inspectProjectRoot, NOVEL_INDEX_PATH, prepareNovelIndex, PROJECT_DIRECTORIES } from './project.ts'

let root = ''

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-project-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('createProjectHome', () => {
  it('creates an exclusive named folder under the given root', async () => {
    await expect(createProjectHome({ root, title: '未名之书' })).resolves.toEqual({ path: path.join(root, '未名之书') })
    expect((await fs.stat(path.join(root, '未名之书'))).isDirectory()).toBe(true)
    await expect(createProjectHome({ root, title: '未名之书' })).rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('rejects invalid project names before touching disk', async () => {
    for (const title of ['', '  ', '.', '..', '.秘密', 'foo/bar', 'CON', '尾点.', 'a'.repeat(81)]) {
      await expect(createProjectHome({ root, title })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    }
    expect(await fs.readdir(root)).toEqual([])
  })
})

describe('initializeProject', () => {
  it('classifies a registered folder without creating files or following hidden content', async () => {
    await fs.mkdir(path.join(root, '.dsh-editor'))
    await fs.writeFile(path.join(root, '.dsh-editor', '作品索引.md'), '# 隐藏索引\n', 'utf8')
    await expect(inspectProjectRoot(root)).resolves.toEqual({ hasVisibleEntries: false, textFiles: [], indexReady: true })

    await fs.mkdir(path.join(root, '正文'))
    await fs.writeFile(path.join(root, '正文', '001.md'), '# 第一章\n', 'utf8')
    await fs.writeFile(path.join(root, '封面.jpg'), 'not an image', 'utf8')
    await expect(inspectProjectRoot(root)).resolves.toEqual({ hasVisibleEntries: true, textFiles: ['正文/001.md'], indexReady: true })
  })

  it('includes project rules in a new project without inventing prose', async () => {
    await initializeProject({ root, mode: 'workspace-write', newProject: true })
    await expect(inspectProjectRoot(root)).resolves.toMatchObject({ hasVisibleEntries: true, textFiles: ['AGENTS.md'] })

    await fs.mkdir(path.join(root, '正文'))
    await fs.writeFile(path.join(root, '正文', '001.md'), '# 第一章\n', 'utf8')
    await expect(inspectProjectRoot(root)).resolves.toMatchObject({ hasVisibleEntries: true, textFiles: ['正文/001.md', 'AGENTS.md'] })
  })

  it('reports indexReady only when the index holds real content, not the init stub', async () => {
    await expect(inspectProjectRoot(root)).resolves.toMatchObject({ indexReady: false })

    await prepareNovelIndex({ root, mode: 'workspace-write' })
    await expect(inspectProjectRoot(root)).resolves.toMatchObject({ indexReady: false })

    await fs.writeFile(path.join(root, NOVEL_INDEX_PATH), '# 作品索引\n\n- 正文/001.md：第一章\n', 'utf8')
    await expect(inspectProjectRoot(root)).resolves.toMatchObject({ indexReady: true })
  })

  it('ensures only root project rules for a new project and creates no specialist directories', async () => {
    const first = await initializeProject({ root, mode: 'workspace-write', newProject: true })
    expect(first.created).toEqual(['AGENTS.md'])
    expect(first.skipped).toEqual([])
    expect(await fs.readdir(root)).toEqual(['AGENTS.md'])
    expect(first.created).not.toContain('正文/001.md')
    expect(first.created).not.toContain('大纲/总纲.md')
    await expect(fs.stat(path.join(root, '项目总览.md'))).rejects.toThrow()
    for (const relative of PROJECT_DIRECTORIES) {
      await expect(fs.stat(path.join(root, relative))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    const second = await initializeProject({ root, mode: 'workspace-write', newProject: true })
    expect(second.created).toEqual([])
    expect(second.skipped).toEqual(['AGENTS.md'])
  })

  it('creates one visible manuscript group without moving or overwriting chapters', async () => {
    await createDirectory({ root, mode: 'workspace-write', relative: '正文' })
    await expect(createManuscriptGroup({ root, mode: 'workspace-write', relative: '正文/第一卷' })).resolves.toEqual({ path: '正文/第一卷' })
    expect((await fs.stat(path.join(root, '正文', '第一卷'))).isDirectory()).toBe(true)
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toThrow()
    await expect(createManuscriptGroup({ root, mode: 'workspace-write', relative: '正文/第一卷' })).rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('rejects hidden, nested, reserved and read-only manuscript groups', async () => {
    await createDirectory({ root, mode: 'workspace-write', relative: '正文' })
    for (const relative of ['正文/.秘密', '正文/第一卷/上部', '正文/CON', '../正文/越界']) {
      await expect(createManuscriptGroup({ root, mode: 'workspace-write', relative })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    }
    await expect(createManuscriptGroup({ root, mode: 'read-only', relative: '正文/第一卷' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    expect(await fs.readdir(path.join(root, '正文'))).toEqual([])
  })

  it('does not create directories or files when opening an existing project', async () => {
    await fs.writeFile(path.join(root, 'notes.md'), 'keep', 'utf8')
    const result = await initializeProject({ root, mode: 'workspace-write', newProject: false })
    expect(result).toEqual({ created: [], skipped: [] })
    expect(await fs.readdir(root)).toEqual(['notes.md'])
    for (const relative of PROJECT_DIRECTORIES) {
      await expect(fs.stat(path.join(root, relative))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(fs.stat(path.join(root, 'AGENTS.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses read-only projects and wrong-type paths', async () => {
    await expect(initializeProject({ root, mode: 'read-only', newProject: true })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await fs.mkdir(path.join(root, 'AGENTS.md'))
    await expect(initializeProject({ root, mode: 'workspace-write', newProject: true })).rejects.toMatchObject({ code: 'NOT_DIRECTORY' })
  })

  it('prepares only the agent index target and preserves an existing index', async () => {
    const first = await prepareNovelIndex({ root, mode: 'workspace-write' })
    expect(first.created).toEqual(['.dsh-editor', NOVEL_INDEX_PATH])
    await fs.writeFile(path.join(root, ...NOVEL_INDEX_PATH.split('/')), '# 作者保留的索引\n', 'utf8')
    const second = await prepareNovelIndex({ root, mode: 'workspace-write' })
    expect(second.created).toEqual([])
    expect(await fs.readFile(path.join(root, ...NOVEL_INDEX_PATH.split('/')), 'utf8')).toBe('# 作者保留的索引\n')
    expect(await fs.readdir(root)).toEqual(['.dsh-editor'])
  })
})

describe('createDirectory', () => {
  it('creates one visible directory below any existing parent', async () => {
    await expect(createDirectory({ root, mode: 'workspace-write', relative: '新建资料' })).resolves.toEqual({ path: '新建资料' })
    await expect(createDirectory({ root, mode: 'workspace-write', relative: '新建资料/图片' })).resolves.toEqual({ path: '新建资料/图片' })
    expect((await fs.stat(path.join(root, '新建资料', '图片'))).isDirectory()).toBe(true)
  })

  it('rejects invalid names, existing paths, missing parents and read-only projects', async () => {
    for (const relative of ['', '.秘密', 'CON', '尾点.', 'a/b/c' + 'x'.repeat(81)]) {
      await expect(createDirectory({ root, mode: 'workspace-write', relative })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    }
    await createDirectory({ root, mode: 'workspace-write', relative: '资料' })
    await expect(createDirectory({ root, mode: 'workspace-write', relative: '资料' })).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(createDirectory({ root, mode: 'workspace-write', relative: '缺失/子目录' })).rejects.toMatchObject({ code: 'IO' })
    await expect(createDirectory({ root, mode: 'read-only', relative: '其它' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    expect(await fs.readdir(root)).toEqual(['资料'])
  })
})
