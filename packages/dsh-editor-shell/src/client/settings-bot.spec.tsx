import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantBotBlock } from './settings-general.tsx'
import type { ShellContext } from './shared.ts'

function fakeScope(value: { idleRecapMinutes?: unknown; cacheTtlMinutes?: unknown }) {
  return {
    getSnapshot: () => ({ status: 'ready' as const, value, writable: true }),
    subscribe: () => () => {},
    set: async () => {},
  }
}

describe('AssistantBotBlock', () => {
  it('shows the idle-too-long error when the saved values violate the bound', () => {
    const ctx = { configForms: { get: () => fakeScope({ idleRecapMinutes: 240, cacheTtlMinutes: 60 }) } } as unknown as ShellContext
    const html = renderToStaticMarkup(createElement(AssistantBotBlock, { ctx }))
    expect(html).toContain('闲置回顾时间须短于缓存有效期')
    expect(html).toContain('role="alert"')
  })
  it('stays quiet when the saved values are valid', () => {
    const ctx = { configForms: { get: () => fakeScope({ idleRecapMinutes: 15, cacheTtlMinutes: 60 }) } } as unknown as ShellContext
    const html = renderToStaticMarkup(createElement(AssistantBotBlock, { ctx }))
    expect(html).not.toContain('闲置回顾时间须短于缓存有效期')
  })
})
