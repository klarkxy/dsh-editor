import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '../dsh-compat.ts'
import { DEFAULT_WRITING_PREFERENCES, type WritingPreferences } from '../writing-settings.tsx'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { WritingModelRoutesView } from './writing-model-routes.tsx'
import { carriedReasoningEffort, firstUsableCatalogModel, mergeCatalogOptions, parseRouteKey, routeKey, saveWritingModelRoute, type CatalogModelOption } from '../model/writing-model-routes.ts'

afterEach(resetLocaleForTests)
const render = (node: ReactNode) => renderToStaticMarkup(createElement('div', null, node))
const catalog: CatalogModelOption[] = [
  { provider: 'p', model: 'a', label: 'Provider · Alpha', efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] },
  { provider: 'p', model: 'b', label: 'Provider · Beta', efforts: [{ id: 'none', name: 'None' }, { id: 'low', name: 'Low' }] },
]
function fixture(snapshot: SettingsScopeSnapshot<WritingPreferences> = { status: 'ready', value: DEFAULT_WRITING_PREFERENCES, revision: 7, writable: true }) {
  const mutate = vi.fn(async () => true)
  return { mutate, scope: { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate } as unknown as SettingsScope<WritingPreferences> }
}
describe('native writing routes', () => {
  it('merges catalog routes once and finds the first usable provider', () => {
    expect(mergeCatalogOptions(catalog, catalog)).toEqual(catalog)
    expect(firstUsableCatalogModel(catalog, ['p'])).toEqual(catalog[0])
    expect(firstUsableCatalogModel(catalog, [])).toBeUndefined()
  })
  it('roundtrips model keys and represents native fallback as an empty selection', () => {
    expect(parseRouteKey(routeKey({ provider: 'p', model: 'a' }))).toEqual({ provider: 'p', model: 'a' })
    expect(parseRouteKey('')).toBeUndefined()
    expect(parseRouteKey('role:normal')).toBeUndefined()
  })
  it('preserves same-model efforts and drops unsupported effort on another model', () => {
    expect(carriedReasoningEffort({ provider: 'p', model: 'a', reasoningEffort: 'high' }, { provider: 'p', model: 'a' }, [])).toBe('high')
    expect(carriedReasoningEffort({ provider: 'p', model: 'a', reasoningEffort: 'high' }, { provider: 'p', model: 'b' }, catalog)).toBeUndefined()
    expect(carriedReasoningEffort({ provider: 'p', model: 'a', reasoningEffort: 'none' }, { provider: 'p', model: 'b' }, catalog)).toBe('off')
  })
  it('writes only the selected field with the native revision and preserves thinking off', async () => {
    const { scope, mutate } = fixture()
    await saveWritingModelRoute(scope, 'completionModel', { provider: 'p', model: 'a', reasoningEffort: 'off' })
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['completionModel'], value: { provider: 'p', model: 'a', reasoningEffort: 'off' } }], 7)
  })
  it('writes an explicit empty route when returning to session defaults', async () => {
    const { scope, mutate } = fixture()
    await saveWritingModelRoute(scope, 'chatModel', undefined)
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['chatModel'], value: { provider: '', model: '', reasoningEffort: '' } }], 7)
  })
  it('surfaces rejected storage and revision conflicts without claiming success', async () => {
    const { scope, mutate } = fixture()
    mutate.mockResolvedValueOnce(false)
    await expect(saveWritingModelRoute(scope, 'rewriteModel', catalog[0])).rejects.toThrow('保存')
    mutate.mockRejectedValueOnce(new Error('revision conflict'))
    await expect(saveWritingModelRoute(scope, 'rewriteModel', catalog[0])).rejects.toThrow('revision conflict')
  })
  it('refuses unavailable and read-only scopes before writing', async () => {
    for (const snapshot of [{ status: 'loading', value: undefined }, { status: 'ready', value: DEFAULT_WRITING_PREFERENCES, writable: false }] as const) {
      const { scope, mutate } = fixture(snapshot)
      await expect(saveWritingModelRoute(scope, 'chatModel', catalog[0])).rejects.toThrow()
      expect(mutate).not.toHaveBeenCalled()
    }
  })
  it('renders three labelled native fields without global tiers or runtime settings', () => {
    const html = render(createElement(WritingModelRoutesView, { snapshot: fixture().scope.getSnapshot(), catalog, writable: true, onSave: () => {} }))
    expect(html.match(/role="combobox"/g)).toHaveLength(3)
    expect(html).toContain('DSH 默认模型')
    expect(html).toContain('当前对话')
    expect(html).not.toContain('data-tier=')
    expect(html).not.toContain('并发数')
  })
  it('keeps missing saved models and explicit thinking off visible', () => {
    setLocale('en')
    const html = render(createElement(WritingModelRoutesView, { snapshot: { status: 'ready', value: { ...DEFAULT_WRITING_PREFERENCES, completionModel: { provider: 'missing', model: 'saved', reasoningEffort: 'off' } } }, catalog, writable: true, onSave: () => {} }))
    expect(html).toContain('missing · saved')
    expect(html).toContain('Think Off')
  })
  it('disables loading controls and gives a visible unavailable or save error', () => {
    const html = render(createElement(WritingModelRoutesView, { snapshot: { status: 'loading', value: undefined }, catalog, writable: true, onSave: () => {} }))
    const controls = html.match(/<button[^>]*role="combobox"[^>]*>/g) ?? []
    expect(controls).toHaveLength(3)
    expect(controls.every(control => control.includes('disabled=""'))).toBe(true)
    const failed = render(createElement(WritingModelRoutesView, { snapshot: fixture().scope.getSnapshot(), catalog, writable: true, failure: 'revision conflict', onSave: () => {} }))
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('revision conflict')
  })
})
