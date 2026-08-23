import { describe, expect, it } from 'vitest'
import { assembleGrillPrompt } from '../src/prompts/index.ts'
import { SCAFFOLD_TOOL_NAME, apply, createScaffoldTool, scaffoldPreExecute } from '../src/tools.ts'
import type { GrillHost, ToolExecLike } from '../src/host.ts'

describe('grill prompt router', () => {
  it('assembles four modes and keeps review report-only', () => {
    const text = assembleGrillPrompt()
    expect(text).toMatch(/planning/)
    expect(text).toMatch(/drafting/)
    expect(text).toMatch(/review/)
    expect(text).toMatch(/first-reader/)
    expect(text).toMatch(/默认只出审查报告，不改正文/)
    expect(text).toMatch(/作者自行决定是否采用并保存草稿/)
    expect(text).not.toMatch(/scan_ai_flavor/)
    expect(text).not.toMatch(/llm-request/)
    expect(text).not.toMatch(/AI腔机械/)
    expect(text).not.toMatch(/外部模型生成/)
    expect(text).not.toMatch(/金手指/)
    expect(text).not.toMatch(/过审/)
    expect(text).not.toMatch(/扫榜/)
  })
})

describe('grill tools', () => {
  it('exposes scaffold_novel with an object-rooted JSON Schema', () => {
    const tool = createScaffoldTool({ get() { return undefined } } as unknown as GrillHost)
    expect(tool.name).toBe(SCAFFOLD_TOOL_NAME)
    expect(SCAFFOLD_TOOL_NAME).toBe('scaffold_novel')
    expect(tool.isConcurrencySafe?.({})).toBe(false)
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { target: { type: 'string' } },
    })
    expect(tool.parameters).not.toHaveProperty('target')
  })

  const exec = (name: string, cwd?: string): ToolExecLike => ({
    name,
    signal: new AbortController().signal,
    agent: cwd ? { session: { header: { cwd } } } : undefined,
  })

  it('asks for scaffold approval, denies a missing session, and ignores other tools', async () => {
    const next = async () => ({ kind: 'allow' as const })
    await expect(scaffoldPreExecute(exec(SCAFFOLD_TOOL_NAME, 'D:/workspace'), next)).resolves.toMatchObject({ kind: 'ask' })
    await expect(scaffoldPreExecute(exec(SCAFFOLD_TOOL_NAME), next)).resolves.toMatchObject({ kind: 'deny' })
    await expect(scaffoldPreExecute(exec('other_tool'), next)).resolves.toEqual({ kind: 'allow' })
  })

  it('registers only scaffold_novel in its host entry', () => {
    const registered: string[] = []
    let preExecute: unknown
    apply({
      tools: { register(tool: { name: string }) { registered.push(tool.name); return () => {} } },
      on(_event: string, handler: unknown) { preExecute = handler; return () => {} },
      get() { return undefined },
    } as never)
    expect(registered).toEqual([SCAFFOLD_TOOL_NAME])
    expect(preExecute).toEqual(expect.any(Function))
  })
})
