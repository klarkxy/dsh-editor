import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolExecLike } from '../src/host.ts'
import { applyProposal, applySegments, locateUnique, readStore, readTargetText } from '../src/proposal.ts'
import { createCanonTools, createContextTool, createProposalTools } from '../src/tools.ts'

let cwd = ''

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-grill-prop-'))
  await fs.mkdir(path.join(cwd, '正文'))
  await fs.writeFile(path.join(cwd, '正文', '巷口.md'), '灯亮了。巷口没人。', 'utf8')
  await fs.mkdir(path.join(cwd, '人物卡'))
  await fs.writeFile(path.join(cwd, '人物卡', '陈砺.md'), '陈砺，夜班。', 'utf8')
})

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true })
})

function execFor(cwd: string): ToolExecLike {
  return {
    name: 'propose_patch',
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  }
}

describe('patch apply', () => {
  it('replaces a unique substring and rejects missing or duplicate old_text', () => {
    expect(locateUnique('abab', 'ab')).toBe(-1)
    expect(locateUnique('abc', 'z')).toBe(-1)
    expect(locateUnique('abc', 'b')).toBe(1)
    const ok = applySegments('灯亮了。巷口没人。', [{ old_text: '巷口没人。', new_text: '巷口只有风。' }])
    expect(ok).toEqual({ ok: true, text: '灯亮了。巷口只有风。' })
    expect(applySegments('aa', [{ old_text: 'a', new_text: 'b' }]).ok).toBe(false)
  })

  it('applies non-overlapping segments from the end so earlier matches stay put', () => {
    const result = applySegments('一二三', [
      { old_text: '一', new_text: '甲' },
      { old_text: '三', new_text: '丙' },
    ])
    expect(result).toEqual({ ok: true, text: '甲二丙' })
  })

  it('replace and append do not use segments', () => {
    expect(applyProposal('旧', { id: '1', path: 'a.md', kind: 'replace', segments: [], body: '新', createdAt: 0 })).toEqual({
      ok: true,
      text: '新',
    })
    expect(applyProposal('旧', { id: '1', path: 'a.md', kind: 'append', segments: [], body: '新', createdAt: 0 })).toEqual({
      ok: true,
      text: '旧\n新',
    })
  })
})

describe('proposal tools', () => {
  it('writes a sidecar without changing the chapter', async () => {
    const tools = createProposalTools()
    const result = await tools.patch.execute(
      { path: '正文/巷口.md', segments: [{ old_text: '巷口没人。', new_text: '巷口只有风。' }] },
      execFor(cwd),
    ) as { status?: string; path?: string }
    expect(result.status).toBe('awaiting_user')
    expect(result.path).toBe('正文/巷口.md')
    expect(await fs.readFile(path.join(cwd, '正文', '巷口.md'), 'utf8')).toBe('灯亮了。巷口没人。')
    const store = await readStore(cwd)
    expect(store.proposals).toHaveLength(1)
    expect(store.proposals[0].kind).toBe('patch')
    expect(store.proposals[0].segments).toEqual([{ old_text: '巷口没人。', new_text: '巷口只有风。' }])
  })

  it('replaces the pending proposal for the same file', async () => {
    const tools = createProposalTools()
    await tools.patch.execute(
      { path: '正文/巷口.md', segments: [{ old_text: '灯亮了。', new_text: '灯灭了。' }] },
      execFor(cwd),
    )
    await tools.chapter.execute({ path: '正文/巷口.md', body: '整章。', placement: 'replace' }, execFor(cwd))
    const store = await readStore(cwd)
    expect(store.proposals).toHaveLength(1)
    expect(store.proposals[0].kind).toBe('replace')
    expect(store.proposals[0].body).toBe('整章。')
  })

  it('rejects character cards, missing files, and non-unique old_text', async () => {
    const tools = createProposalTools()
    const card = await tools.patch.execute(
      { path: '人物卡/陈砺.md', segments: [{ old_text: '夜班', new_text: '白班' }] },
      execFor(cwd),
    ) as { error?: string }
    expect(card.error).toMatch(/人物卡/)
    const missing = await tools.chapter.execute({ path: '正文/没有.md', body: 'x' }, execFor(cwd)) as { error?: string }
    expect(missing.error).toMatch(/不存在/)
    const dup = await tools.patch.execute(
      { path: '正文/巷口.md', segments: [{ old_text: '。', new_text: '！' }] },
      execFor(cwd),
    ) as { error?: string }
    expect(dup.error).toMatch(/唯一/)
    expect(await readTargetText(cwd, '正文/巷口.md')).toBe('灯亮了。巷口没人。')
  })

  it('proposes a character card without writing it', async () => {
    const canon = createCanonTools()
    const result = await canon.card.execute(
      { path: '人物卡/沈晚宁.md', operation: 'create', new_text: '沈晚宁，夜班。', reason: '出场', source: '作者' },
      execFor(cwd),
    ) as { status?: string; path?: string }
    expect(result.status).toBe('awaiting_user')
    expect(result.path).toBe('人物卡/沈晚宁.md')
    await expect(fs.stat(path.join(cwd, '人物卡', '沈晚宁.md'))).rejects.toThrow()
    const store = await readStore(cwd)
    expect(store.proposals[0].kind).toBe('replace')
  })

  it('compile_context returns missing instead of inventing', async () => {
    const tool = createContextTool()
    const result = await tool.execute({ focus: '正文/巷口.md' }, execFor(cwd)) as { missing?: string; packed?: string }
    expect(result.packed).toBeTruthy()
    expect(result.missing).toMatch(/大纲/)
  })

  it('escapes workspace paths', async () => {
    const tools = createProposalTools()
    const result = await tools.patch.execute(
      { path: '../secret.md', segments: [{ old_text: 'a', new_text: 'b' }] },
      execFor(cwd),
    ) as { error?: string }
    expect(result.error).toBeTruthy()
  })
})

