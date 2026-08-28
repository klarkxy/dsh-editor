import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeProject, NOVEL_INDEX_PATH, prepareNovelIndex, PROJECT_FILES } from './project.ts'

let root = ''

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-project-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('initializeProject', () => {
  it('creates a new novel once and never overwrites existing content', async () => {
    const first = await initializeProject({ root, mode: 'workspace-write', newProject: true })
    expect(first.created).toContain('正文/001.md')
    expect(first.created).toContain('大纲/总纲.md')
    await fs.writeFile(path.join(root, '项目总览.md'), '# 作者已修改\n', 'utf8')
    const second = await initializeProject({ root, mode: 'workspace-write', newProject: true })
    expect(second.created).toEqual([])
    expect(await fs.readFile(path.join(root, '项目总览.md'), 'utf8')).toBe('# 作者已修改\n')
    for (const relative of Object.keys(PROJECT_FILES)) {
      await expect(fs.stat(path.join(root, ...relative.split('/')))).resolves.toBeTruthy()
    }
  })

  it('adds templates to an existing project without creating a first chapter', async () => {
    await initializeProject({ root, mode: 'workspace-write', newProject: false })
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toThrow()
    await expect(fs.stat(path.join(root, '世界书', '设定总汇.md'))).resolves.toBeTruthy()
  })

  it('refuses read-only projects and wrong-type paths', async () => {
    await expect(initializeProject({ root, mode: 'read-only', newProject: true })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await fs.writeFile(path.join(root, '正文'), 'occupied', 'utf8')
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
