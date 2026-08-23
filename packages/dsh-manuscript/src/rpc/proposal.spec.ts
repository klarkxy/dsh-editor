import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTextFile } from './files.ts'
import { acceptProposal, applySegments, listProposals, rejectProposal } from './proposal.ts'

let cwd = ''

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ms-prop-'))
  await fs.mkdir(path.join(cwd, '正文'))
  await fs.writeFile(path.join(cwd, '正文', '巷口.md'), '灯亮了。巷口没人。', 'utf8')
})

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true })
})

describe('manuscript proposals', () => {
  it('accepts a unique patch against editor text and writes the file', async () => {
    const first = await readTextFile(cwd, '正文/巷口.md')
    await fs.mkdir(path.join(cwd, '.dsh-editor'))
    await fs.writeFile(
      path.join(cwd, '.dsh-editor', 'proposals.json'),
      JSON.stringify({
        version: 1,
        proposals: [
          {
            id: 'p1',
            path: '正文/巷口.md',
            kind: 'patch',
            segments: [{ old_text: '巷口没人。', new_text: '巷口只有风。' }],
            createdAt: 1,
          },
        ],
      }),
      'utf8',
    )
    const accepted = await acceptProposal(cwd, 'p1', first.version, first.text)
    expect(accepted.text).toBe('灯亮了。巷口只有风。')
    expect(await fs.readFile(path.join(cwd, '正文', '巷口.md'), 'utf8')).toBe('灯亮了。巷口只有风。')
    expect((await listProposals(cwd, '正文/巷口.md')).proposals).toEqual([])
  })

  it('rejects a proposal without touching the chapter', async () => {
    await fs.mkdir(path.join(cwd, '.dsh-editor'))
    await fs.writeFile(
      path.join(cwd, '.dsh-editor', 'proposals.json'),
      JSON.stringify({
        version: 1,
        proposals: [{ id: 'p2', path: '正文/巷口.md', kind: 'replace', segments: [], body: '新稿', createdAt: 1 }],
      }),
      'utf8',
    )
    expect(await rejectProposal(cwd, 'p2')).toEqual({ removed: true })
    expect(await fs.readFile(path.join(cwd, '正文', '巷口.md'), 'utf8')).toBe('灯亮了。巷口没人。')
  })

  it('fails closed on stale version and non-unique old_text', async () => {
    const first = await readTextFile(cwd, '正文/巷口.md')
    await fs.mkdir(path.join(cwd, '.dsh-editor'))
    await fs.writeFile(
      path.join(cwd, '.dsh-editor', 'proposals.json'),
      JSON.stringify({
        version: 1,
        proposals: [
          {
            id: 'p3',
            path: '正文/巷口.md',
            kind: 'patch',
            segments: [{ old_text: '巷口没人。', new_text: 'x' }],
            createdAt: 1,
          },
        ],
      }),
      'utf8',
    )
    await fs.writeFile(path.join(cwd, '正文', '巷口.md'), '灯亮了。巷口没人。改过。', 'utf8')
    await expect(acceptProposal(cwd, 'p3', first.version, first.text)).rejects.toMatchObject({ code: 'STALE' })
    expect(applySegments('aa', [{ old_text: 'a', new_text: 'b' }]).ok).toBe(false)
  })

  it('creates a missing character card on replace accept', async () => {
    await fs.mkdir(path.join(cwd, '人物卡'))
    await fs.mkdir(path.join(cwd, '.dsh-editor'))
    await fs.writeFile(
      path.join(cwd, '.dsh-editor', 'proposals.json'),
      JSON.stringify({
        version: 1,
        proposals: [{ id: 'p5', path: '人物卡/沈晚宁.md', kind: 'replace', segments: [], body: '沈晚宁，夜班。', createdAt: 1 }],
      }),
      'utf8',
    )
    const accepted = await acceptProposal(cwd, 'p5', '')
    expect(accepted.text).toBe('沈晚宁，夜班。')
    expect(await fs.readFile(path.join(cwd, '人物卡', '沈晚宁.md'), 'utf8')).toBe('沈晚宁，夜班。')
  })

  it('appends instead of replacing when kind is append', async () => {
    const first = await readTextFile(cwd, '正文/巷口.md')
    await fs.mkdir(path.join(cwd, '.dsh-editor'))
    await fs.writeFile(
      path.join(cwd, '.dsh-editor', 'proposals.json'),
      JSON.stringify({
        version: 1,
        proposals: [{ id: 'p4', path: '正文/巷口.md', kind: 'append', segments: [], body: '后来风停了。', createdAt: 1 }],
      }),
      'utf8',
    )
    const accepted = await acceptProposal(cwd, 'p4', first.version, first.text)
    expect(accepted.text).toBe('灯亮了。巷口没人。\n后来风停了。')
  })
})
