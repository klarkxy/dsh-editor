import { describe, expect, it } from 'vitest'
import { assembleGrillPrompt } from '../src/prompts/index.ts'
import {
  SCAFFOLD_TOOL_NAME,
  createCanonTools,
  createContextTool,
  createProposalTools,
  createScaffoldTool,
  createScanTool,
} from '../src/tools.ts'
import type { GrillHost } from '../src/host.ts'

describe('grill prompt router', () => {
  it('assembles four modes and keeps review report-only', () => {
    const text = assembleGrillPrompt()
    expect(text).toMatch(/planning/)
    expect(text).toMatch(/drafting/)
    expect(text).toMatch(/review/)
    expect(text).toMatch(/first-reader/)
    expect(text).toMatch(/默认只出审查报告，不改正文/)
    expect(text).toMatch(/web_search/)
    expect(text).toMatch(/propose_patch/)
    expect(text).toMatch(/write_chapter/)
    expect(text).toMatch(/awaiting_user/)
    expect(text).toMatch(/compile_context/)
    expect(text).toMatch(/scan_scene/)
    expect(text).toMatch(/propose_character_card_update/)
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

  it('exposes proposal tools that do not write the manuscript themselves', () => {
    const tools = createProposalTools()
    expect(tools.patch.name).toBe('propose_patch')
    expect(tools.chapter.name).toBe('write_chapter')
    expect(tools.patch.parameters).toMatchObject({ type: 'object' })
    expect(tools.chapter.parameters).toMatchObject({ type: 'object' })
    expect(tools.patch.isConcurrencySafe?.({})).toBe(false)
  })

  it('exposes compile_context, scan_scene, and canon proposal tools', () => {
    expect(createContextTool().name).toBe('compile_context')
    expect(createScanTool().name).toBe('scan_scene')
    const canon = createCanonTools()
    expect(canon.card.name).toBe('propose_character_card_update')
    expect(canon.world.name).toBe('propose_worldbook_update')
  })
})
