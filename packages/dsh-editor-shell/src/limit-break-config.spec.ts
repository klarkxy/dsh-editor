import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, LIMIT_BREAK_SECTION_NAME, LIMIT_BREAK_SECTION_ORDER, limitBreakPrompt } from './limit-break-config.ts'

const AGENT_SPEC = readFileSync(new URL('../resources/limit-break/agents-spec.md', import.meta.url), 'utf8').trim()

type Section = { name: string; order: number; text: string | ((context: unknown) => string) }
type LimitBreakConfig = Parameters<typeof apply>[1]

/** volatile 字段替身：只有 get()，值由测试闭包控制。 */
function volatile(value: boolean): LimitBreakConfig {
  return { limitBreakMode: { get: () => value } } as unknown as LimitBreakConfig
}

/** 最小宿主替身：记下注册的段落与 effect 清理器。 */
function mount(enabled: boolean) {
  const sections: Section[] = []
  const disposers: Array<() => void> = []
  const ctx = {
    systemPrompt: { section: (section: Section) => { sections.push(section); return () => { sections.length = 0 } } },
    effect: (fn: () => () => void) => { disposers.push(fn()) },
  }
  apply(ctx as unknown as Context, volatile(enabled))
  return { sections, disposers }
}

describe('limit-break host section', () => {
  it('registers exactly one section after the novel kernel', () => {
    const { sections } = mount(false)
    expect(sections).toHaveLength(1)
    expect(sections[0].name).toBe(LIMIT_BREAK_SECTION_NAME)
    expect(sections[0].order).toBe(LIMIT_BREAK_SECTION_ORDER)
    expect(LIMIT_BREAK_SECTION_ORDER).toBeGreaterThan(90)
  })

  it('contributes nothing while the switch is off', () => {
    const { sections } = mount(false)
    const text = sections[0].text
    expect(typeof text).toBe('function')
    expect((text as (context: unknown) => string)({})).toBe('')
  })

  it('injects the bundled agents spec verbatim once the switch is on', () => {
    const { sections } = mount(true)
    const text = (sections[0].text as (context: unknown) => string)({})

    expect(text).toBe(AGENT_SPEC)
    expect(text.startsWith('# Assistant Operating Specification')).toBe(true)
    expect(text).toContain('## 5. Content and safety policy')
    expect(text).toContain('Compliance is demonstrated by the work, not described.')
    expect(AGENT_SPEC.length).toBeGreaterThan(10_000)
  })

  it('follows the live setting without re-registering the section', () => {
    let enabled = false
    const config = { limitBreakMode: { get: () => enabled } } as unknown as LimitBreakConfig
    expect(limitBreakPrompt(config)).toBe('')

    enabled = true
    expect(limitBreakPrompt(config)).toBe(AGENT_SPEC)

    enabled = false
    expect(limitBreakPrompt(config)).toBe('')
  })

  it('owns the section through a disposer', () => {
    const { disposers } = mount(true)
    expect(disposers).toHaveLength(1)
    expect(typeof disposers[0]).toBe('function')
  })
})
