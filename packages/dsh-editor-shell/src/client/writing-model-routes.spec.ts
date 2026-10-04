import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Theme } from '@radix-ui/themes'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiPolicy, ModelTarget } from '@klarkxy/dsh-ai-services/contracts'
import type { ConnectionHandle } from '../dsh-compat.ts'
import { resetLocaleForTests, setLocale } from '../i18n/index.ts'
import {
  carriedReasoningEffort,
  tierRolesUpdate,
  runtimeLimitsUpdate,
  parseLimitsDraft,
  pluginPurposeRows,
  EditorModelSettingsView,
  PluginModelRoutesView,
  firstUsableCatalogModel,
  mergeCatalogOptions,
  WritingModelRoutes,
  WritingPolicyStore,
  writingPurposeUpdate,
  type CatalogModelOption,
} from './writing-model-routes.tsx'

afterEach(() => {
  resetLocaleForTests()
})

describe('first usable catalog model', () => {
  const catalog: CatalogModelOption[] = [
    { provider: 'deepseek', model: 'DeepSeek-V4-Flash', label: 'DeepSeek · Flash' },
    { provider: 'minimax', model: 'MiniMax-M3', label: 'MiniMax · M3' },
  ]

  it('skips keyless catalog entries and picks the first usable provider', () => {
    expect(firstUsableCatalogModel(catalog, ['minimax'])).toEqual(catalog[1])
    expect(firstUsableCatalogModel(catalog, [])).toBeUndefined()
    expect(firstUsableCatalogModel([], ['minimax'])).toBeUndefined()
  })

  it('keeps mergeCatalogOptions stable for the adopt scan', () => {
    expect(mergeCatalogOptions(catalog, catalog).map((item) => item.model)).toEqual([
      'DeepSeek-V4-Flash',
      'MiniMax-M3',
    ])
  })
})

function makePolicy(revision: number, purposes: Record<string, ModelTarget> = {}): AiPolicy {
  return {
    revision,
    roles: {},
    purposes,
    limits: { concurrency: 2, timeoutMs: 30000, maxInputChars: 8000, maxOutputTokens: 2048, maxAttempts: 2 },
  }
}

describe('writing policy CAS payload', () => {
  it('moves revision to expectedRevision and merges only the edited purpose', () => {
    const base = makePolicy(7, {
      chat: { kind: 'role', role: 'normal' },
      'manuscript.rewrite': { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4' },
    })
    const update = writingPurposeUpdate(base, 'manuscript.completion', { kind: 'model', provider: 'minimax', model: 'MiniMax-M3', reasoningEffort: 'max' })
    expect(update.expectedRevision).toBe(7)
    expect(update.policy).not.toHaveProperty('revision')
    expect(update.policy.purposes).toEqual({
      chat: { kind: 'role', role: 'normal' },
      'manuscript.rewrite': { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4' },
      'manuscript.completion': { kind: 'model', provider: 'minimax', model: 'MiniMax-M3', reasoningEffort: 'max' },
    })
    expect(base.purposes).not.toHaveProperty('manuscript.completion')
  })
})

describe('reasoning effort carried across a route switch', () => {
  const catalog: CatalogModelOption[] = [
    { provider: 'deepseek', model: 'DeepSeek-V4', label: 'DeepSeek · V4', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
    { provider: 'minimax', model: 'MiniMax-M3', label: 'MiniMax · M3', efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }] },
    { provider: 'custom', model: 'gateway-x', label: 'Custom · X' },
  ]

  it('drops the previous effort when the new model does not advertise it', () => {
    const previous: ModelTarget = { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4', reasoningEffort: 'high' }
    expect(carriedReasoningEffort(previous, { provider: 'minimax', model: 'MiniMax-M3' }, catalog)).toBeUndefined()
  })

  it('keeps the effort when the new model advertises the same id', () => {
    const previous: ModelTarget = { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4', reasoningEffort: 'low' }
    expect(carriedReasoningEffort(previous, { provider: 'minimax', model: 'MiniMax-M3' }, catalog)).toBe('low')
  })

  it('never carries effort blindly onto a model without catalog effort metadata', () => {
    const previous: ModelTarget = { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4', reasoningEffort: 'high' }
    expect(carriedReasoningEffort(previous, { provider: 'custom', model: 'gateway-x' }, catalog)).toBeUndefined()
  })

  it('requires destination support even for off and none', () => {
    for (const reasoningEffort of ['off', 'none']) {
      const previous: ModelTarget = { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4', reasoningEffort }
      expect(carriedReasoningEffort(previous, { provider: 'minimax', model: 'MiniMax-M3' }, catalog)).toBeUndefined()
      expect(carriedReasoningEffort(previous, { provider: 'custom', model: 'gateway-x' }, catalog)).toBeUndefined()
      const supported = [...catalog, { provider: 'custom', model: 'disabled-thinking', label: 'Custom', efforts: [{ id: reasoningEffort, name: 'Off' }] }]
      expect(carriedReasoningEffort(previous, { provider: 'custom', model: 'disabled-thinking' }, supported)).toBe(reasoningEffort)
    }
  })

  it('keeps the stored effort when re-picking the same route', () => {
    const previous: ModelTarget = { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4', reasoningEffort: 'xhigh' }
    expect(carriedReasoningEffort(previous, { provider: 'deepseek', model: 'DeepSeek-V4' }, catalog)).toBe('xhigh')
  })

  it('carries nothing from role or session targets', () => {
    expect(carriedReasoningEffort({ kind: 'role', role: 'strong' }, { provider: 'minimax', model: 'MiniMax-M3' }, catalog)).toBeUndefined()
    expect(carriedReasoningEffort({ kind: 'session' }, { provider: 'minimax', model: 'MiniMax-M3' }, catalog)).toBeUndefined()
  })

  it('switches across providers even when the model id matches', () => {
    const previous: ModelTarget = { kind: 'model', provider: 'deepseek', model: 'shared-id', reasoningEffort: 'high' }
    expect(carriedReasoningEffort(previous, { provider: 'minimax', model: 'shared-id' }, catalog)).toBeUndefined()
  })
})

type PendingCall = {
  endpoint: string
  payload: unknown
  settle(value: unknown): void
  fail(error: unknown): void
}

function harness() {
  const calls: PendingCall[] = []
  const call = <T,>(endpoint: string, payload: unknown): Promise<T> => new Promise<T>((resolve, reject) => {
    calls.push({ endpoint, payload, settle: (value) => resolve(value as T), fail: reject })
  })
  const store = new WritingPolicyStore(call, () => '保存失败')
  return { calls, store }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('writing policy store lifecycle', () => {
  const modelRoute: ModelTarget = { kind: 'model', provider: 'deepseek', model: 'DeepSeek-V4' }

  it('loads the projection, notifies subscribers, and stops after unsubscribe', async () => {
    const { calls, store } = harness()
    let seen = 0
    const off = store.subscribe(() => { seen++ })
    const loading = store.load()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.endpoint).toBe('status')
    calls[0]?.settle({ policy: makePolicy(1) })
    await loading
    expect(store.getSnapshot().policy?.revision).toBe(1)
    expect(store.getSnapshot().failure).toBe('')
    expect(seen).toBeGreaterThan(0)
    off()
    const notified = seen
    const again = store.load()
    calls[1]?.settle({ policy: makePolicy(2) })
    await again
    expect(seen).toBe(notified)
  })

  it('surfaces an initial load failure without a policy and recovers on retry', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.fail(new Error('offline'))
    await loading
    expect(store.getSnapshot().policy).toBeUndefined()
    expect(store.getSnapshot().failure).toBe('offline')
    store.reload()
    expect(store.getSnapshot().failure).toBe('')
    expect(calls).toHaveLength(2)
    calls[1]?.settle({ policy: makePolicy(1) })
    await flush()
    expect(store.getSnapshot().policy?.revision).toBe(1)
  })

  it('uses the non-Error fallback message for wire failures', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.fail('broken')
    await loading
    expect(store.getSnapshot().failure).toBe('保存失败')
  })

  it('never lets an in-flight refresh overwrite a newer save', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.settle({ policy: makePolicy(1, { chat: { kind: 'role', role: 'normal' } }) })
    await loading

    const refresh = store.load()
    const saving = store.save('chat', modelRoute)
    expect(store.getSnapshot().saving).toBe(true)
    expect(calls.map((call) => call.endpoint)).toEqual(['status', 'status', 'update'])
    calls[2]?.settle(makePolicy(2, { chat: modelRoute }))
    await saving
    expect(store.getSnapshot().saving).toBe(false)
    expect(store.getSnapshot().policy?.revision).toBe(2)
    calls[1]?.settle({ policy: makePolicy(1) })
    await refresh
    expect(store.getSnapshot().policy?.revision).toBe(2)
  })

  it('keeps a successful save when a later projection refresh fails, then recovers', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.settle({ policy: makePolicy(1) })
    await loading
    const saving = store.save('chat', modelRoute)
    calls[1]?.settle(makePolicy(2, { chat: modelRoute }))
    await saving

    const refresh = store.load()
    calls[2]?.fail(new Error('offline'))
    await refresh
    expect(store.getSnapshot().policy?.revision).toBe(2)
    expect(store.getSnapshot().failure).toBe('offline')
    expect(store.getSnapshot().saving).toBe(false)

    const retry = store.load()
    calls[3]?.settle({ policy: makePolicy(2, { chat: modelRoute }) })
    await retry
    expect(store.getSnapshot().failure).toBe('')
    expect(store.getSnapshot().policy?.revision).toBe(2)
  })

  it('does not restart an obsolete queued refresh after invalidation', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.settle({ policy: makePolicy(1) })
    await loading
    const saving = store.save('chat', modelRoute)
    await store.load()
    store.invalidate()
    calls[1]?.settle(makePolicy(2, { chat: modelRoute }))
    await saving
    await flush()
    expect(calls).toHaveLength(2)
    expect(store.getSnapshot().saving).toBe(false)
    expect(store.getSnapshot().policy?.revision).toBe(1)
  })

  it('drops an old save’s commits after invalidate, clears saving, and converges via the deferred refresh', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.settle({ policy: makePolicy(1) })
    await loading

    const saving = store.save('chat', modelRoute)
    store.invalidate()
    const refresh = store.load()
    expect(calls).toHaveLength(2)

    calls[1]?.settle(makePolicy(2, { chat: modelRoute }))
    await saving
    await refresh
    expect(store.getSnapshot().saving).toBe(false)
    expect(store.getSnapshot().policy?.revision).toBe(1)
    expect(calls).toHaveLength(3)
    calls[2]?.settle({ policy: makePolicy(2, { chat: modelRoute }) })
    await flush()
    expect(store.getSnapshot().policy?.revision).toBe(2)
    expect(store.getSnapshot().failure).toBe('')
  })

  it('resyncs the projection after a rejected save and keeps it when the resync also fails', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.settle({ policy: makePolicy(1, { chat: { kind: 'role', role: 'normal' } }) })
    await loading

    const saving = store.save('chat', modelRoute)
    calls[1]?.fail(new Error('revision conflict'))
    await flush()
    expect(store.getSnapshot().failure).toBe('revision conflict')
    expect(calls).toHaveLength(3)
    expect(calls[2]?.endpoint).toBe('status')
    calls[2]?.settle({ policy: makePolicy(3, { chat: { kind: 'role', role: 'strong' } }) })
    await saving
    expect(store.getSnapshot().policy?.revision).toBe(3)
    expect(store.getSnapshot().saving).toBe(false)

    const again = store.save('chat', { kind: 'role', role: 'weak' })
    calls[3]?.fail(new Error('offline'))
    await flush()
    expect(calls).toHaveLength(5)
    calls[4]?.fail(new Error('offline'))
    await again
    expect(store.getSnapshot().policy?.revision).toBe(3)
    expect(store.getSnapshot().failure).toBe('offline')
    expect(store.getSnapshot().saving).toBe(false)
  })

  it('serializes saves and refuses to save without a projection', async () => {
    const { calls, store } = harness()
    await store.save('chat', modelRoute)
    expect(calls).toHaveLength(0)

    const loading = store.load()
    calls[0]?.settle({ policy: makePolicy(1) })
    await loading
    const first = store.save('chat', modelRoute)
    const second = store.save('chat', { kind: 'role', role: 'weak' })
    expect(calls.filter((call) => call.endpoint === 'update')).toHaveLength(1)
    calls[1]?.settle(makePolicy(2, { chat: modelRoute }))
    await first
    await second
    expect(store.getSnapshot().saving).toBe(false)
  })

  it('sends the frozen CAS payload with the live revision', async () => {
    const { calls, store } = harness()
    const loading = store.load()
    calls[0]?.settle({ policy: makePolicy(4, { chat: { kind: 'role', role: 'normal' } }) })
    await loading
    const target: ModelTarget = { kind: 'model', provider: 'minimax', model: 'MiniMax-M3', reasoningEffort: 'max' }
    const saving = store.save('manuscript.completion', target)
    expect(calls[1]?.endpoint).toBe('update')
    const payload = calls[1]?.payload as { expectedRevision: number; policy: { purposes: Record<string, ModelTarget>; revision?: number } }
    expect(payload.expectedRevision).toBe(4)
    expect(payload.policy.revision).toBeUndefined()
    expect(payload.policy.purposes['chat']).toEqual({ kind: 'role', role: 'normal' })
    expect(payload.policy.purposes['manuscript.completion']).toEqual(target)
    calls[1]?.settle(makePolicy(5, { chat: { kind: 'role', role: 'normal' }, 'manuscript.completion': target }))
    await saving
  })
})

describe('writing route rows markup', () => {
  const catalog: CatalogModelOption[] = [
    { provider: 'deepseek', model: 'DeepSeek-V4', label: 'DeepSeek · V4', efforts: [{ id: 'high', name: 'High' }] },
  ]
  const connection = () => ({ rpc: { call: () => new Promise(() => {}) } }) as unknown as ConnectionHandle
  const render = (props: { showSharedPurposes?: boolean }): string => renderToStaticMarkup(createElement(Theme, {}, createElement(WritingModelRoutes, {
    connection: connection(),
    scope: {} as never,
    catalog,
    writable: true,
    ...props,
  }) as ReactNode))

  it('renders the three purpose rows with labelled, disabled triggers while the policy loads', () => {
    const html = render()
    expect(html).toContain('对话模型')
    expect(html).toContain('补全模型')
    expect(html).toContain('改写模型')
    expect(html).toContain('aria-label="对话模型"')
    expect(html).toContain('读取中…')
    expect((html.match(/role="combobox"/g) ?? [])).toHaveLength(3)
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('limits the surface to the chat row when shared purposes are hidden', () => {
    const html = render({ showSharedPurposes: false })
    expect(html).toContain('对话模型')
    expect(html).not.toContain('补全模型')
    expect(html).not.toContain('改写模型')
  })

  it('renders the same rows in English', () => {
    setLocale('en')
    const html = render()
    expect(html).toContain('Chat model')
    expect(html).toContain('Completion model')
    expect(html).toContain('Rewrite model')
  })
})


describe('permanent model settings policy boundaries', () => {
  it('unbinds one tier without changing other bindings and drops unsupported effort on a switch', () => {
    const roles = {weak:{provider:'p',model:'a',reasoningEffort:'high'}, normal:{provider:'p',model:'b'}}
    expect(tierRolesUpdate(roles,'weak',undefined,[])).toEqual({normal:roles.normal})
    expect(tierRolesUpdate(roles,'weak',{provider:'p',model:'b'},[{provider:'p',model:'b',label:'B',efforts:[{id:'off',name:'Off'}]}]).weak).toEqual({provider:'p',model:'b'})
    expect(roles.weak.reasoningEffort).toBe('high')
  })
  it('merges newer unrelated limits but rejects a newer conflicting edited field', () => {
    const base=makePolicy(4);const current={...base,revision:5,limits:{...base.limits,timeoutMs:45000}}
    const desired={...base.limits,concurrency:7}
    const update=runtimeLimitsUpdate(current,desired,base.limits)
    expect(update.expectedRevision).toBe(5)
    expect(update.policy.limits).toEqual({...desired,timeoutMs:45000})
    expect(update.policy.roles).toBe(current.roles)
    expect(update.policy.purposes).toBe(current.purposes)
    expect(()=>runtimeLimitsUpdate({...current,limits:{...current.limits,concurrency:3}},desired,base.limits)).toThrow('其他窗口修改')
  })
  it('accepts only integers in backend bounds', () => {
    const valid={concurrency:'8',timeoutMs:'300000',maxInputChars:'200000',maxOutputTokens:'8192',maxAttempts:'5'}
    expect(parseLimitsDraft(valid).ok).toBe(true)
    for(const concurrency of ['','0','9','1.5','Infinity']) expect(parseLimitsDraft({...valid,concurrency})).toEqual({ok:false,field:'concurrency'})
  })
  it('keeps permanent routes out of plugin model purposes', () => {
    const specs=['chat','manuscript.completion','manuscript.rewrite','memory'].map(id=>({id,label:id,plugin:'fixture',defaultTarget:{kind:'role' as const,role:'normal' as const}}))
    expect(pluginPurposeRows(specs).map(x=>x.id)).toEqual(['memory'])
    const store=new WritingPolicyStore(async()=>new Promise(()=>{}))
    const snapshot={policy:makePolicy(1),purposes:specs,storageFailed:false,saving:false,failure:''}
    const render=(view:typeof EditorModelSettingsView | typeof PluginModelRoutesView)=>renderToStaticMarkup(createElement(Theme,{},createElement(view,{store,snapshot,catalog:[],writable:true}) as ReactNode))
    const editor=render(EditorModelSettingsView);const plugins=render(PluginModelRoutesView)
    expect((editor.match(/data-tier=/g)??[])).toHaveLength(4)
    expect(editor).toContain('editor-model-runtime')
    expect(plugins).toContain('aria-label="memory"')
    expect(plugins).not.toContain('aria-label="补全模型"')
    expect(plugins).not.toContain('data-tier=')
    expect(plugins).not.toContain('editor-model-runtime')
  })
})
