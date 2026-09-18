import { describe, expect, it } from 'vitest'
import { applyProposal, parseProposal, prepareProposal } from './proposal.ts'
import { createTextFile, readTextFile, writeTextFile } from './files.ts'
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

  it('rejects overlapping originals that would otherwise look unique', async () => {
    const context = createMemoryContext({ '正文/001.md': '她哈哈哈地笑了。\n' })
    const proposal = parseProposal({ kind: 'edit', path: '正文/001.md', oldText: '哈哈', newText: '轻笑', summary: '改语气' })
    await expect(prepareProposal(context, proposal)).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    await expect(applyProposal(context, proposal, (await readTextFile(context, '正文/001.md')).version)).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    await expect(readTextFile(context, '正文/001.md')).resolves.toMatchObject({ text: '她哈哈哈地笑了。\n' })
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

  it('fills a pre-created empty chapter file via edit with empty oldText', async () => {
    const context = createMemoryContext({ '正文/001.md': '' })
    const proposal = parseProposal({ kind: 'edit', path: '正文/001.md', oldText: '', newText: '# 第一章\n正文。\n', summary: '填充空章节' })
    const prepared = await prepareProposal(context, proposal)
    expect(prepared).toMatchObject({ applicable: true, before: '', after: '# 第一章\n正文。\n' })
    await applyProposal(context, proposal, String(prepared.version))
    await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toBe('# 第一章\n正文。\n')
  })

  it('rejects filling with empty oldText when the file already has content', async () => {
    const context = createMemoryContext({ '正文/001.md': '# 第一章\n已有正文。\n' })
    const proposal = parseProposal({ kind: 'edit', path: '正文/001.md', oldText: '', newText: '覆盖', summary: 'x' })
    await expect(prepareProposal(context, proposal)).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    const current = await readTextFile(context, '正文/001.md')
    await expect(applyProposal(context, proposal, current.version)).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    await expect(readTextFile(context, '正文/001.md')).resolves.toMatchObject({ text: '# 第一章\n已有正文。\n' })
  })

  it('lets create overwrite an existing file that is still blank', async () => {
    const context = createMemoryContext({ '正文/001.md': '  \n' })
    const proposal = parseProposal({ kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '填充占位文件' })
    await expect(prepareProposal(context, proposal)).resolves.toMatchObject({ applicable: true })
    await expect(applyProposal(context, proposal, '')).resolves.toMatchObject({ operation: 'create' })
    await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toBe('# 第一章\n')
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


it('applies a V2 text-file edit and still rejects V1 non-Markdown targets', async () => {
  const context = createMemoryContext({ '资料/说明.txt': '旧句。\n' })
  const proposal = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 2,
    kind: 'edit',
    path: '资料/说明.txt',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: 'initial-资料/说明.txt',
  })
  const prepared = await prepareProposal(context, proposal)
  await applyProposal(context, proposal, String(prepared.version))
  await expect(context.fs.readText(await context.fs.resolve('资料/说明.txt'))).resolves.toContain('新句。')
  expect(() => parseProposal({ kind: 'edit', path: '资料/说明.txt', oldText: '旧', newText: '新', summary: 'x' }))
    .toThrow(/Markdown/)
})

it('keeps manuscript apply basis checks on the existing workspace write path', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../index.ts', import.meta.url), 'utf8'))
  const applySource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./proposal.ts', import.meta.url), 'utf8'))
  expect(source).toContain("'proposal.apply'")
  expect(source).toContain('withWorkspaceWrite(access.root.targetKey, run)')
  expect(source).toMatch(/proposal\.apply[\s\S]*withWorkspaceWrite\(access\.root\.targetKey, run\)/)
  expect(applySource).toContain('assertGenerationBaseline(current.version, proposal.targetVersion)')
})

it('applies a V2 edit when basis sources are unchanged and rejects stale basis on prepare and apply', async () => {
  const context = createMemoryContext({ '正文/001.md': '# 第一章\n旧句。\n', '大纲/总纲.md': '来源纲要' })
  const source = await readTextFile(context, '大纲/总纲.md')
  const proposal = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 2,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: (await readTextFile(context, '正文/001.md')).version,
    basis: [{ path: '大纲/总纲.md', version: source.version, label: '总纲' }],
  })
  const prepared = await prepareProposal(context, proposal)
  expect(prepared).toMatchObject({ applicable: true, before: '旧句。', after: '新句。' })
  const result = await applyProposal(context, proposal, String(prepared.version))
  expect(result.operation).toBe('edit')
  await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toContain('新句。')

  const stale = createMemoryContext({ '正文/001.md': '# 第一章\n旧句。\n', '大纲/总纲.md': '来源纲要' })
  const staleSource = await readTextFile(stale, '大纲/总纲.md')
  const staleProposal = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 2,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: (await readTextFile(stale, '正文/001.md')).version,
    basis: [{ path: '大纲/总纲.md', version: staleSource.version }],
  })
  const stalePrepared = await prepareProposal(stale, staleProposal)
  await writeTextFile(stale, '大纲/总纲.md', '纲要已改', staleSource.version)
  await expect(prepareProposal(stale, staleProposal)).rejects.toMatchObject({ code: 'STALE' })
  await expect(applyProposal(stale, staleProposal, String(stalePrepared.version))).rejects.toMatchObject({ code: 'STALE' })
  await expect(readTextFile(stale, '正文/001.md')).resolves.toMatchObject({ text: '# 第一章\n旧句。\n' })
})

it('does not advertise nested creation as applicable when the low-level parent is missing', async () => {
  const context = createMemoryContext({ '正文/001.md': '正文' })
  const proposal = parseProposal({ kind: 'create', path: '人物卡/主角.md', text: '# 主角', summary: '创建人物卡' })
  await expect(prepareProposal(context, proposal)).rejects.toMatchObject({ code: 'PARENT_MISSING' })
  await expect(applyProposal(context, proposal, '')).rejects.toMatchObject({ code: 'PARENT_MISSING' })
})

it('applies a V2 create only when the target is still absent', async () => {
  const context = createMemoryContext({ '正文/说明.txt': '' })
  const proposal = parseProposal({
    marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '创建首章',
  })
  expect(proposal).toMatchObject({ writingV2: true })
  await expect(prepareProposal(context, proposal)).resolves.toMatchObject({ applicable: true })
  await expect(applyProposal(context, proposal, '')).resolves.toMatchObject({ operation: 'create' })
  await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toBe('# 第一章\n')
})

it('marks an existing empty V2 create as a conflict and does not write', async () => {
  const context = createMemoryContext({ '正文/001.md': '  \n' })
  const before = await readTextFile(context, '正文/001.md')
  const proposal = parseProposal({
    marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '填充占位',
  })
  expect(proposal).toMatchObject({ writingV2: true })
  await expect(prepareProposal(context, proposal)).rejects.toMatchObject({ code: 'STALE' })
  await expect(applyProposal(context, proposal, before.version)).rejects.toMatchObject({ code: 'STALE' })
  await expect(readTextFile(context, '正文/001.md')).resolves.toMatchObject({ text: '  \n', version: before.version })
})

it('rejects a V2 create when the target appears after prepare', async () => {
  const context = createMemoryContext({ '正文/说明.txt': '' })
  const proposal = parseProposal({
    marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '创建首章',
  })
  expect(proposal).toMatchObject({ writingV2: true })
  await expect(prepareProposal(context, proposal)).resolves.toMatchObject({ applicable: true })
  await createTextFile(context, '正文/001.md', '作者刚写的正文')
  const raced = await readTextFile(context, '正文/001.md')
  await expect(applyProposal(context, proposal, '')).rejects.toMatchObject({ code: 'STALE' })
  await expect(readTextFile(context, '正文/001.md')).resolves.toMatchObject({ text: '作者刚写的正文', version: raced.version })
})

it('keeps V1 create filling an empty placeholder file', async () => {
  const context = createMemoryContext({ '正文/001.md': '  \n' })
  const proposal = parseProposal({ kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '填充占位文件' })
  expect(proposal).not.toHaveProperty('writingV2')
  await expect(prepareProposal(context, proposal)).resolves.toMatchObject({ applicable: true })
  await expect(applyProposal(context, proposal, '')).resolves.toMatchObject({ operation: 'create' })
  await expect(context.fs.readText(await context.fs.resolve('正文/001.md'))).resolves.toBe('# 第一章\n')
})

it('rejects a marked proposal with a missing or unsupported version instead of falling through to V1', () => {
  expect(() => parseProposal({
    marker: 'dsh-editor.proposal',
    version: 3,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧',
    newText: '新',
    summary: '替换一句',
  })).toThrow(/unsupported proposal version/)
  expect(() => parseProposal({
    marker: 'dsh-editor.proposal',
    version: 3,
    kind: 'create',
    path: '正文/001.md',
    text: '# 第一章\n',
    summary: '创建首章',
  })).toThrow(/unsupported proposal version/)
  expect(() => parseProposal({
    marker: 'dsh-editor.proposal',
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧',
    newText: '新',
    summary: '替换一句',
  })).toThrow(/unsupported proposal version/)
  expect(() => parseProposal({
    marker: 'dsh-editor.proposal',
    kind: 'create',
    path: '正文/001.md',
    text: '# 第一章\n',
    summary: '创建首章',
  })).toThrow(/unsupported proposal version/)
})

it('prepares and applies a genuine V1 marked edit/create without inventing targetVersion', async () => {
  const context = createMemoryContext({ '正文/001.md': '# 第一章\n旧句。\n' })
  const edit = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 1,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: 'v7',
  })
  expect(edit).toEqual({
    kind: 'edit', path: '正文/001.md', oldText: '旧句。', newText: '新句。', summary: '替换一句',
  })
  expect(edit).not.toHaveProperty('targetVersion')
  const prepared = await prepareProposal(context, edit)
  expect(prepared).toMatchObject({ applicable: true, before: '旧句。', after: '新句。' })
  await applyProposal(context, edit, String(prepared.version))
  await expect(readTextFile(context, '正文/001.md')).resolves.toMatchObject({ text: '# 第一章\n新句。\n' })

  const created = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 1,
    kind: 'create',
    path: '正文/002.md',
    text: '# 第二章\n',
    summary: '创建次章',
  })
  expect(created).toEqual({
    kind: 'create', path: '正文/002.md', text: '# 第二章\n', summary: '创建次章',
  })
  expect(created).not.toHaveProperty('writingV2')
  expect(created).not.toHaveProperty('targetVersion')
  await expect(prepareProposal(context, created)).resolves.toMatchObject({ applicable: true })
  await expect(applyProposal(context, created, '')).resolves.toMatchObject({ operation: 'create' })
  await expect(context.fs.readText(await context.fs.resolve('正文/002.md'))).resolves.toBe('# 第二章\n')
})

it('rejects a V2 edit whose generation baseline is v7 after the author moved the target to v8', async () => {
  const context = createMemoryContext({ '正文/001.md': '# 第一章\n旧句。\n额外。\n' })
  const generation = await readTextFile(context, '正文/001.md')
  await writeTextFile(context, '正文/001.md', '# 第一章\n旧句。\n作者改了。\n', generation.version)
  const current = await readTextFile(context, '正文/001.md')
  expect(current.version).not.toBe(generation.version)
  const proposal = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 2,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: generation.version,
  })
  expect(proposal).toMatchObject({ targetVersion: generation.version })
  await expect(prepareProposal(context, proposal)).rejects.toMatchObject({ code: 'STALE' })
  await expect(applyProposal(context, proposal, current.version)).rejects.toMatchObject({ code: 'STALE' })
  await expect(readTextFile(context, '正文/001.md')).resolves.toMatchObject({ text: '# 第一章\n旧句。\n作者改了。\n', version: current.version })
})

it('applies an unchanged V2 edit and rejects a target change between prepare and apply', async () => {
  const context = createMemoryContext({ '正文/001.md': '# 第一章\n旧句。\n' })
  const generation = await readTextFile(context, '正文/001.md')
  const proposal = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 2,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: generation.version,
  })
  const prepared = await prepareProposal(context, proposal)
  expect(prepared).toMatchObject({ applicable: true, version: generation.version })
  await applyProposal(context, proposal, String(prepared.version))
  await expect(readTextFile(context, '正文/001.md')).resolves.toMatchObject({ text: '# 第一章\n新句。\n' })

  const raced = createMemoryContext({ '正文/001.md': '# 第一章\n旧句。\n' })
  const racedGeneration = await readTextFile(raced, '正文/001.md')
  const racedProposal = parseProposal({
    marker: 'dsh-editor.proposal',
    version: 2,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: racedGeneration.version,
  })
  const racedPrepared = await prepareProposal(raced, racedProposal)
  await writeTextFile(raced, '正文/001.md', '# 第一章\n作者又改了。\n', racedGeneration.version)
  const racedCurrent = await readTextFile(raced, '正文/001.md')
  await expect(applyProposal(raced, racedProposal, String(racedPrepared.version))).rejects.toMatchObject({ code: 'STALE' })
  await expect(applyProposal(raced, racedProposal, racedCurrent.version)).rejects.toMatchObject({ code: 'STALE' })
  await expect(readTextFile(raced, '正文/001.md')).resolves.toMatchObject({ text: '# 第一章\n作者又改了。\n', version: racedCurrent.version })
})

it('still parses genuine V1 edit and create without a writing-proposal marker', () => {
  expect(parseProposal({
    kind: 'edit', path: '正文/001.md', oldText: '旧', newText: '新', summary: '替换一句',
    targetVersion: 'v7',
  })).toEqual({
    kind: 'edit', path: '正文/001.md', oldText: '旧', newText: '新', summary: '替换一句',
  })
  const create = parseProposal({
    kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '创建首章',
  })
  expect(create).toEqual({ kind: 'create', path: '正文/001.md', text: '# 第一章\n', summary: '创建首章' })
  expect(create).not.toHaveProperty('writingV2')
  expect(parseProposal({
    version: 3, kind: 'edit', path: '正文/001.md', oldText: '旧', newText: '新', summary: 'x',
  })).toEqual({
    kind: 'edit', path: '正文/001.md', oldText: '旧', newText: '新', summary: 'x',
  })
})
