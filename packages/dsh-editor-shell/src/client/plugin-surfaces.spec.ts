import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelSettingsSurface, PluginChatEvents, PluginModelSettingsSurface, modelSettingsSections, usePluginModelSettings } from './plugin-surfaces.tsx'
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
  it('keeps native model settings when replacement contributions register', () => {
    const providerEditor = () => createElement('button', null, 'Native providers')
    const chatModel = () => createElement('button', null, 'Chat model')
    const render = vi.fn((_slot: string, owner?: object) => (owner as { renderProviders(): ReturnType<typeof createElement> }).renderProviders())
    const html = renderToStaticMarkup(createElement(ModelSettingsSurface, {
      ctx: host({ [MODEL_SETTINGS_SLOT]: [{ options: { id: 'other', order: 20 } }, { options: { id: 'center', order: 10 } }] }),
      renderSlot: render, sessionId: 'session-1', locale: 'zh', renderProviders: providerEditor, renderChatModel: chatModel,
    }))
    expect(html.match(/Native providers/g)).toHaveLength(1)
    expect(render).not.toHaveBeenCalled()
  })
  it('offers optional Host-confirmed write refresh through the existing chat surface', () => {
    const onApplied = vi.fn()
    const render = vi.fn((_slot: string, owner?: object) => {
      ;(owner as { onApplied(path: string): void }).onApplied('正文/001.md')
      return createElement('article', null, 'Applied')
    })
    renderToStaticMarkup(createElement(PluginChatEvents, {
      ctx: host({ [CHAT_EVENTS_SLOT]: [{ options: { id: 'author-events' } }] }),
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

 describe('plugin-only model settings', () => {
  it('retains the labels and order owned by registered model contributions', () => {
    expect(modelSettingsSections([{ options: { id: 'custom', order: 10, label: 'Custom models' } }, { options: { id: 'other', order: 2, label: 'Other models' } }, { options: { id: 'custom', order: 0 } }], 'zh').map(row => ({ id: row.id, label: row.label }))).toEqual([{ id: 'other', label: 'Other models' }, { id: 'custom', label: 'Custom models' }])
  })
  it('renders a plugin contribution through its own slot and scope', () => {
    const render = vi.fn(() => createElement('div', null, 'Native plugin configuration'))
    const html = renderToStaticMarkup(createElement(PluginModelSettingsSurface, {
      ctx: host({}), id: 'custom', renderSlot: render, locale: 'zh',
      renderProviders: () => createElement('p', null, 'Providers'),
      renderChatModel: () => createElement('p', null, 'Built-in chat'),
    }))
    expect(html).toContain('Native plugin configuration')
    expect(html).not.toContain('Providers')
    expect(render).toHaveBeenCalledWith(MODEL_SETTINGS_SLOT, expect.any(Object), { only: 'custom' })
  })
})


it('offers plugin model entries only when their native contributions are registered', () => {
  const render = (entries: Array<{options:{id:string}}>,locale:'zh'|'en') => {
    function Probe(){return createElement('p',null,usePluginModelSettings(host({[MODEL_SETTINGS_SLOT]:entries}),locale).sections.map(row=>row.id+':'+row.label).join('|'))}
    return renderToStaticMarkup(createElement(Probe))
  }
  expect(render([], 'zh')).toBe('<p></p>')
  expect(render([], 'en')).toBe('<p></p>')
  const html=render([{options:{id:'other'}}], 'zh')
  expect(html).toContain('other:other')
})
