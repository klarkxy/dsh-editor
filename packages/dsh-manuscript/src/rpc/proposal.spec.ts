import { describe, expect, it } from 'vitest'
import { applyProposal, parseProposal, prepareProposal } from './proposal.ts'
import { readTextFile, writeTextFile } from './files.ts'
import { createMemoryContext } from './test-helpers.ts'

describe('proposal workflow', () => {
  it('previews and applies one version-guarded edit', async () => {
    const context = createMemoryContext({ '正文/001.md': '# 第一章\n旧句。\n' })
    const proposal = parseProposal({ kind: 'edit', path: '正文/001.md', oldText: '旧句。', newText: '新句。', summary: '替换一句' })
    const prepared = await prepareProposal(context, proposal)
    expect(prepared).toMatchObject({ applicable: true, before: '旧句。', after: '新句。' })
    const result = await applyProposal(context, proposal, String(prepared.version))
    expect(result.operation).toBe('edit')
    await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toContain('新句。')
  })

  it('rejects ambiguous and stale edits', async () => {
    const context = createMemoryContext({ '正文/001.md': '重复 重复' })
    const ambiguous = parseProposal({ kind: 'edit', path: '正文/001.md', oldText: '重复', newText: '唯一', summary: '修改' })
    await expect(prepareProposal(context, ambiguous)).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    const exact = parseProposal({ kind: 'edit', path: '正文/001.md', oldText: '重复 重复', newText: '唯一', summary: '修改' })
    const prepared = await prepareProposal(context, exact)
    await context.fs.writeText(await context.fs.resolve('正文/001.md'), '外部修改', { kind: 'replaceIfVersion', version: String(prepared.version) })
    await expect(applyProposal(context, exact, String(prepared.version))).rejects.toMatchObject({ code: 'STALE' })
  })

  it('restores the exact pre-apply text even when the replacement is not unique', async () => {
    const original = '甲句。\n乙句。\n'
    const context = createMemoryContext({ '正文/001.md': original })
    const proposal = parseProposal({ kind: 'edit', path: '正文/001.md', oldText: '甲句。', newText: '乙句。', summary: '合并措辞' })
    const before = await readTextFile(context, '正文/001.md')
    const prepared = await prepareProposal(context, proposal)
    const applied = await applyProposal(context, proposal, String(prepared.version))
    await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toBe('乙句。\n乙句。\n')
    const restored = await writeTextFile(context, '正文/001.md', before.text, applied.version)
    expect(restored.version).not.toBe(applied.version)
    await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toBe(original)
  })

  it('creates a Markdown file only when absent', async () => {
    const context = createMemoryContext({ '正文/说明.txt': '' })
    const proposal = parseProposal({ kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '创建首章' })
    await expect(prepareProposal(context, proposal)).resolves.toMatchObject({ applicable: true })
    await expect(applyProposal(context, proposal, '')).resolves.toMatchObject({ operation: 'create' })
    await expect(prepareProposal(context, proposal)).rejects.toMatchObject({ code: 'STALE' })
  })
})

it('writes replacement metacharacters literally', async () => {
  const context = createMemoryContext({ 'a.md': 'before OLD after' })
  const newText = '$& $$ $' + String.fromCharCode(96) + " $'"
  const proposal = parseProposal({kind:'edit',path:'a.md',oldText:'OLD',newText,summary:'literal'})
  const prepared = await prepareProposal(context, proposal)
  await applyProposal(context, proposal, String(prepared.version))
  expect((await readTextFile(context,'a.md')).text).toBe('before ' + newText + ' after')
})
