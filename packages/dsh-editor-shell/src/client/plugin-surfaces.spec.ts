import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelSettingsSurface, PluginChatEvents } from './plugin-surfaces.tsx'
import { CHAT_EVENTS_SLOT, MODEL_SETTINGS_SLOT } from '../seats.ts'

function host(entries: Record<string, Array<{ options: { id: string; order?: number } }>>) {
  return { slots: { entries: (key: string) => entries[key] ?? [], getVersion: () => 1, subscribe: () => () => {} } }
}
describe('optional plugin surfaces', () => {
  it('keeps the native provider editor when a plugin is absent or disabled', () => {
    const render = vi.fn(() => createElement('div', null, 'unexpected plugin'))
    const html = renderToStaticMarkup(createElement(ModelSettingsSurface, {
      ctx: host({}), renderSlot: render, locale: 'zh',
      renderProviders: () => createElement('button', null, 'Native providers'),
      renderChatModel: () => createElement('button', null, 'Chat model'),
    }))
    expect(html).toContain('Native providers')
    expect(render).not.toHaveBeenCalled()
  })
  it('passes the same native provider editor to one selected replacement', () => {
    const providerEditor = () => createElement('button', null, 'Native providers')
    const chatModel = () => createElement('button', null, 'Chat model')
    const render = vi.fn((_slot: string, owner?: object) => (owner as { renderProviders(): ReturnType<typeof createElement> }).renderProviders())
    const html = renderToStaticMarkup(createElement(ModelSettingsSurface, {
      ctx: host({ [MODEL_SETTINGS_SLOT]: [{ options: { id: 'other', order: 20 } }, { options: { id: 'center', order: 10 } }] }),
      renderSlot: render, sessionId: 'session-1', locale: 'zh', renderProviders: providerEditor, renderChatModel: chatModel,
    }))
    expect(html.match(/Native providers/g)).toHaveLength(1)
    expect(render).toHaveBeenCalledWith(MODEL_SETTINGS_SLOT,
      { sessionId: 'session-1', locale: 'zh', renderProviders: providerEditor, renderChatModel: chatModel }, { only: 'center' })
  })
  it('offers optional Host-confirmed write refresh through the existing chat surface', () => {
    const onApplied = vi.fn()
    const render = vi.fn((_slot: string, owner?: object) => {
      ;(owner as { onApplied(path: string): void }).onApplied('正文/001.md')
      return createElement('article', null, 'Applied')
    })
    renderToStaticMarkup(createElement(PluginChatEvents, {
      ctx: host({ [CHAT_EVENTS_SLOT]: [{ options: { id: 'fusion' } }] }),
      renderSlot: render, sessionId: 'session-2', locale: 'zh', onApplied,
    }))
    expect(onApplied).toHaveBeenCalledExactlyOnceWith('正文/001.md')
  })

  it('renders event cards without creating transcript messages or requiring a tool result', () => {
    const render = vi.fn((_slot: string, owner?: object) => createElement('article', null, (owner as { sessionId: string }).sessionId))
    const html = renderToStaticMarkup(createElement(PluginChatEvents, {
      ctx: host({ [CHAT_EVENTS_SLOT]: [{ options: { id: 'recap' } }] }),
      renderSlot: render, sessionId: 'session-2', locale: 'en', hidden: true,
    }))
    expect(html).toContain('<article>session-2</article>')
    expect(html).toContain('data-dsh-plugin-surface=""')
    expect(render).toHaveBeenCalledWith(CHAT_EVENTS_SLOT, { sessionId: 'session-2', locale: 'en', hidden: true }, undefined)
  })
})
