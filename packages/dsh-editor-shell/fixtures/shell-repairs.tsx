import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsModelsSection } from '../src/client/settings-models.tsx'
import { ModelPicker } from '../src/client/chat-model-picker.tsx'
import { ShellTheme, radixThemesStyles } from '../src/client/ui/theme-root.tsx'
import { redesignedStyles } from '../src/styles.ts'
import type { ShellContext } from '../src/client/shared.ts'

const listeners = new Map<string, Set<() => void>>()
const profile = { displayName: 'Fixture provider', baseURL: 'https://example.invalid', apiKeyEnv: 'FIXTURE_API_KEY', models: [{ id: 'fixture-model' }] }
let namespace = { ns: 'llm-pi-ai', revision: 1, schema: {}, user: { providers: { fixture: profile } }, base: {}, value: { providers: { fixture: profile } }, applies: 'live', secrets: [] }
let selection = { provider: 'fixture', model: 'fixture-model' }
let catalog = { default: selection, groups: [{ id: 'fixture', name: 'Fixture provider', models: [{ id: 'fixture-model', name: 'Fixture model' }] }] }
let fail = false
let providerVisible = true
let release: (() => void) | undefined
const calls: unknown[] = []
const mirror = { getSnapshot: () => ({ status: 'ready', view: { namespaces: [namespace], writable: true, hasDocument: true }, error: null }), subscribe: () => () => {}, ensure: async () => {}, acceptView: (view: typeof namespace) => { namespace = view } }
const getPath = (value: unknown, path: string[]) => path.reduce<unknown>((item, key) => item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined, value)
const setPath = (value: unknown, path: string[], next: unknown): unknown => {
  if (!path.length) return next
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { ...object, [path[0]!]: setPath(object[path[0]!], path.slice(1), next) }
}
const schema = { getPath, hasPath: (value: unknown, path: string[]) => getPath(value, path) !== undefined, setPath,
  deletePath: (value: unknown, path: string[]): unknown => { const next = structuredClone(value) as Record<string, unknown>; const parent = getPath(next, path.slice(0, -1)) as Record<string, unknown>; delete parent[path.at(-1)!]; return next },
  rehydrate: (value: unknown) => value, nodeAtPath: () => ({ type: 'object' }), validate: () => undefined }
const ctx = { configForms: { describe: () => mirror }, settingsSchema: schema,
  remote: { $on: (event: string, listener: () => void) => { const group = listeners.get(event) ?? new Set(); listeners.set(event, group); group.add(listener); return () => group.delete(listener) },
    llm: { listConfigurableProviders: async () => { if (release) await new Promise<void>(resolve => { release = resolve }); if (fail) throw Error('Fixture refresh failed'); return { ok: true, value: providerVisible ? [{ id: 'fixture', provider: 'fixture', displayName: 'Fixture provider', settingsNs: namespace.ns, settingsPath: ['providers', 'fixture'], active: true, declared: true }] : [] } } },
    credentials: { describe: async () => ({ ok: true, value: { FIXTURE_API_KEY: { configured: true, writable: true } } }), set: async (...args: unknown[]) => { calls.push(['key', ...args]); return { ok: true } } },
    settings: { mutate: async (...args: unknown[]) => { calls.push(['settings', ...args]); return { ok: false, error: { code: 'settings-conflict', message: 'Fixture conflict' } } } },
    session: { modelCatalog: async () => ({ ok: true, value: catalog }), selectModel: async (value: typeof selection) => { calls.push(['select', value]); selection = value; return { ok: true, value: { selected: value } } } } },
} as unknown as ShellContext
const session = { sessionId: 'fixture-session', projections: { faceOf: () => ({ getSnapshot: () => ({ next: selection }) }) } }
const controls = {
  calls, refresh: (revision = namespace.revision) => { namespace = { ...namespace, revision }; for (const listener of listeners.get('settings/document-updated') ?? []) listener() },
  hold: () => { release = () => {} }, release: () => { const next = release; release = undefined; next?.() }, fail: (next: boolean) => { fail = next },
  removeProvider: () => { providerVisible = false; controls.refresh() },
  restoreProvider: () => { providerVisible = true; controls.refresh() },
  catalog: (reasoning?: unknown, effort?: string) => { catalog = { ...catalog, groups: [{ ...catalog.groups[0]!, models: [{ id: 'fixture-model', name: 'Fixture model', ...(reasoning ? { reasoning } : {}) }] }] } as typeof catalog; selection = { provider: 'fixture', model: 'fixture-model', ...(effort ? { reasoningEffort: effort } : {}) }; controls.refresh() },
}
Object.assign(window, { shellRepairs: controls })
function Fixture() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  return <ShellTheme appearance={theme}>
    <style>{radixThemesStyles}{redesignedStyles}</style>
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Toggle fixture theme</button>
    <SettingsModelsSection ctx={ctx} writingScope={{} as never} showWritingRoutes={false} />
    <ModelPicker ctx={ctx} session={session as never} onConfigure={() => {}} />
  </ShellTheme>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
