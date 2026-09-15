import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { WRITING_PROPOSE_TOOL_NAME } from 'dsh-manuscript/host-api'
import { createWritingProposeTool } from './writing-propose-tool.ts'

describe('writing_propose preview-only tool', () => {
  it('returns a serialized V2 marker and does not write files', async () => {
    const writeText = vi.fn()
    const tool = createWritingProposeTool()
    const execute = tool.execute as unknown as (args: unknown, exec?: unknown) => Promise<unknown>
    const value = await execute({
      kind: 'edit',
      path: 'notes/a.md',
      summary: '改一句',
      oldText: '旧',
      newText: '新',
      targetVersion: 'v7',
      basis: [{ path: 'notes/source.md', version: 'v1' }],
    }, { fs: { writeText } })
    expect(tool.name).toBe(WRITING_PROPOSE_TOOL_NAME)
    expect(value).toEqual({
      marker: 'dsh-editor.proposal',
      version: 2,
      kind: 'edit',
      path: 'notes/a.md',
      summary: '改一句',
      oldText: '旧',
      newText: '新',
      targetVersion: 'v7',
      basis: [{ path: 'notes/source.md', version: 'v1' }],
    })
    expect(JSON.parse(tool.output.render({}, value)[0]!.text)).toEqual(value)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects frontmatter kinds without writing', async () => {
    const tool = createWritingProposeTool()
    const execute = tool.execute as unknown as (args: unknown) => Promise<unknown>
    await expect(execute({ kind: 'chapter_plan', path: '正文/001.md', summary: '章纲', beats: ['x'] })).rejects.toThrow('kind and summary')
  })

  it('accepts visible .txt for all five kinds and rejects generated or non-text targets', async () => {
    const tool = createWritingProposeTool()
    const execute = tool.execute as unknown as (args: unknown) => Promise<unknown>
    expect(tool.description).toMatch(/\.md or \.txt/)
    expect(JSON.stringify(tool.parameters)).toMatch(/\.txt/)
    expect(JSON.stringify(tool.parameters)).toMatch(/ordinary directories/)
    await expect(execute({
      kind: 'edit', path: 'notes/a.txt', summary: '改一句', oldText: '旧', newText: '新', targetVersion: 'v7',
    })).resolves.toMatchObject({ version: 2, kind: 'edit', path: 'notes/a.txt', targetVersion: 'v7' })
    await expect(execute({
      kind: 'split', path: 'notes/a.txt', summary: '拆', anchor: '## x', newPath: 'notes/b.txt', targetVersion: 'v7',
    })).resolves.toMatchObject({ version: 2, kind: 'split', path: 'notes/a.txt', targetVersion: 'v7' })
    await expect(execute({
      kind: 'renames', summary: '改名并移动', renames: [{ from: 'a.txt', to: 'notes/nested/renamed.txt', version: 'v7' }],
    })).resolves.toMatchObject({ version: 2, kind: 'renames' })
    await expect(execute({
      kind: 'create', path: 'dist/out.md', summary: '新建', text: '# x',
    })).rejects.toThrow('generated')
    await expect(execute({
      kind: 'merge', path: 'notes/a.json', summary: '合', sourcePath: 'notes/b.md',
    })).rejects.toThrow('Markdown or text')
  })

  it('describes create as exclusive and points empty existing files at edit with oldText \'\'', () => {
    const tool = createWritingProposeTool()
    const schema = JSON.stringify(tool.parameters)
    expect(schema).toMatch(/exclusive/)
    expect(schema).toMatch(/never fills or overwrites/)
    expect(schema).toMatch(/even if empty/)
    expect(schema).toMatch(/oldText ''/)
    expect(schema).not.toMatch(/May also fill an existing file that is still empty/)
    const source = readFileSync(new URL('./writing-propose-tool.ts', import.meta.url), 'utf8')
    expect(source).toContain('Create is exclusive and never fills or overwrites an existing file, even if empty')
    expect(source).toContain("Use edit with oldText \\'\\' to fill an existing empty file.")
    expect(source).not.toContain('May also fill an existing file that is still empty')
  })

  it('requires generation baselines in schema and rejects missing targetVersion on edit', async () => {
    const tool = createWritingProposeTool()
    const schema = JSON.stringify(tool.parameters)
    const output = JSON.stringify(tool.output.schema)
    expect(schema).toMatch(/targetVersion/)
    expect(schema).toMatch(/sourceVersion/)
    expect(schema).toMatch(/read receipt/)
    expect(schema).toMatch(/renames entry requires its source version|source file read-receipt version/)
    expect(output).toMatch(/targetVersion/)
    expect(output).toMatch(/"required":\["from","to","version"\]/)
    expect(output).toMatch(/"required":\["path","version"\]/)
    const execute = tool.execute as unknown as (args: unknown) => Promise<unknown>
    await expect(execute({
      kind: 'edit', path: 'notes/a.md', summary: '改一句', oldText: '旧', newText: '新',
    })).rejects.toThrow('targetVersion')
    await expect(execute({
      kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新', targetVersion: 'v7',
    })).rejects.toThrow('unsupported fields')
    await expect(execute({
      kind: 'merge', path: 'notes/a.md', summary: '合', sourcePath: 'notes/b.md', targetVersion: 'v7',
    })).rejects.toThrow('sourceVersion')
    await expect(execute({
      kind: 'renames', summary: '改名', renames: [{ from: 'notes/a.md', to: 'notes/b.md' }],
    })).rejects.toThrow('version')
  })
})
