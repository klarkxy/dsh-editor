/* CustomProviderCard「添加接口」流程:连接取回模型清单 → 勾选 → 保存时先
   走 models.dev 补全再写 llm-pi-ai 命名空间,密钥走 credentials.set。
   连接失败给出手动兜底输入。沿用 hook-slot 测试法(不跑 DOM 渲染器):
   useState 换成按位计数的槽,直接调用组件函数拿 ReactNode 树。 */
import { isValidElement, useState, type ReactElement, type ReactNode, type SetStateAction } from 'react'
import { Button, Checkbox, Input, Notice } from '../ui/index.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomProviderCard } from './settings-models-provider.tsx'
import { Select } from './select.tsx'
import { text } from './settings-models-copy.ts'
import { t } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'
import type { ModelsStore } from './settings-models-state.ts'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(), useState: vi.fn(),
}))

function card(options: {
  protocols?: string[]
  taken?: string[]
  discovered?: unknown
  lookup?: unknown
  mutate?: unknown
  describeCredentials?: unknown
  listConfigurableProviders?: unknown
  liveSnapshot?: { rows?: Array<{ entry: Record<string, unknown>; apiKeyEnv?: string }>; revision?: number; providers?: Record<string, unknown> }
} = {}) {
  let cursor = 0
  const state: unknown[] = []
  vi.mocked(useState).mockImplementation(((initial: unknown) => {
    const slot = cursor++
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
    return [state[slot], (next: SetStateAction<unknown>) => {
      state[slot] = typeof next === 'function' ? next(state[slot]) : next
    }]
  }) as typeof useState)
  const discovered = options.discovered ?? { ok: true, value: [{ id: 'm-a', name: 'Alpha' }, { id: 'm-b' }, { id: 'm-c' }] }
  const lookup = options.lookup ?? { ok: true, value: { fetchedAt: '', stale: false, models: {} } }
  const discoverModels = vi.fn(async (_ns: string, _request: unknown) => discovered)
  const rpcCall = vi.fn(async (_channel: string, _endpoint: string, _params: unknown) => lookup)
  const mutate = vi.fn(async (_ns: string, _ops: unknown, _revision: number) => options.mutate ?? { ok: true, value: { ns: 'llm-pi-ai', revision: 1 } })
  const setCredential = vi.fn(async (_ref: string, _key: string): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> => ({ ok: true, value: undefined }))
  const unsetCredential = vi.fn(async (_ref: string) => ({ ok: true as const, value: undefined }))
  const describeCredentials = options.describeCredentials
    ? vi.fn(async (refs: string[]) => (typeof options.describeCredentials === 'function' ? (options.describeCredentials as (r: string[]) => unknown)(refs) : options.describeCredentials))
    : undefined
  const listConfigurableProviders = options.listConfigurableProviders
    ? vi.fn(async () => (typeof options.listConfigurableProviders === 'function' ? (options.listConfigurableProviders as () => unknown)() : options.listConfigurableProviders))
    : undefined
  const liveSnapshot = options.liveSnapshot
  const ctx = {
    configForms: {
      describe: () => ({
        getSnapshot: () => ({
          view: {
            namespaces: [{
              ns: 'llm-pi-ai',
              revision: liveSnapshot?.revision ?? 0,
              ...(liveSnapshot?.providers ? { value: { providers: liveSnapshot.providers }, user: { providers: liveSnapshot.providers } } : {}),
            }],
          },
        }),
      }),
    },
    connection: { rpc: { call: rpcCall } },
    remote: {
      llm: {
        discoverModels,
        ...(listConfigurableProviders ? { listConfigurableProviders } : {}),
      },
      settings: { mutate },
      credentials: {
        set: setCredential,
        unset: unsetCredential,
        ...(describeCredentials ? { describe: describeCredentials } : {}),
      },
    },
  } as unknown as ShellContext
  const store = {
    acceptNamespaceView: vi.fn(),
    ...(liveSnapshot ? {
      getSnapshot: () => ({
        rows: liveSnapshot.rows ?? [],
        namespaces: new Map(liveSnapshot.providers ? [['llm-pi-ai', { ns: 'llm-pi-ai', revision: liveSnapshot.revision ?? 0, value: { providers: liveSnapshot.providers }, user: { providers: liveSnapshot.providers }, schema: {} }]] : []),
      }),
      load: vi.fn(async () => undefined),
    } : {}),
  } as unknown as ModelsStore
  const onClose = vi.fn()
  function render() {
    cursor = 0
    return CustomProviderCard({
      ctx,
      store,
      protocols: options.protocols ?? ['openai-completions'],
      taken: options.taken ?? [],
      readOnly: false,
      onClose,
    })
  }
  return { render, mutate, setCredential, unsetCredential, onClose, discoverModels, rpcCall }
}

function nodes(tree: ReactNode, predicate: (node: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate))
  if (!isValidElement<Record<string, unknown>>(tree)) return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children as ReactNode, predicate)]
}
function input(tree: ReactNode, label: string) {
  return nodes(tree, node => node.type === Input && node.props['aria-label'] === label)[0]!
}
function type(tree: ReactNode, label: string, value: string) {
  ;(input(tree, label).props['onChange'] as (next: string) => void)(value)
}
function select(tree: ReactNode, label: string, value: string) {
  const el = nodes(tree, node => node.type === Select && node.props['aria-label'] === label)[0]!
  ;(el.props['onChange'] as (next: string) => void)(value)
}
function labelOf(children: ReactNode): string {
  return Array.isArray(children) ? children.filter(c => typeof c === 'string').join('') : String(children)
}
function button(tree: ReactNode, label: string) {
  return nodes(tree, node => node.type === Button && labelOf(node.props['children'] as ReactNode) === label)[0]!
}
function clickButton(tree: ReactNode, label: string) {
  ;(button(tree, label).props.onClick as () => void)()
}
function checkboxes(tree: ReactNode) {
  return nodes(tree, node => node.type === Checkbox)
}
function textContent(tree: ReactNode): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textContent).join('')
  if (!isValidElement<Record<string, unknown>>(tree)) return ''
  return textContent(tree.props.children as ReactNode)
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

async function connect(harness: ReturnType<typeof card>, url = 'api.moonshot.cn/v1/chat/completions', key = 'sk-test') {
  type(harness.render(), text().baseUrl, url)
  if (key !== '') type(harness.render(), text().apiKey, key)
  clickButton(harness.render(), text().connect)
  await settle()
}

beforeEach(() => vi.clearAllMocks())

describe('add endpoint card', () => {
  it('connects, picks every candidate by default and saves a derived route profile', async () => {
    const harness = card()
    await connect(harness)

    let next = harness.render()
    expect(textContent(next)).toContain('找到 3 个模型')
    const boxes = checkboxes(next)
    expect(boxes).toHaveLength(3)
    expect(boxes.every(box => box.props['checked'] === true)).toBe(true)

    clickButton(next, t('common.save'))
    await settle()
    expect(harness.mutate).toHaveBeenCalledTimes(1)
    const [ns, ops, revision] = harness.mutate.mock.calls[0]!
    expect(ns).toBe('llm-pi-ai')
    expect(revision).toBe(0)
    expect(ops).toEqual([{ op: 'set', path: ['providers', 'moonshot'], value: {
      api: 'openai-completions',
      baseURL: 'https://api.moonshot.cn/v1',
      models: [{ id: 'm-a', name: 'Alpha' }, { id: 'm-b' }, { id: 'm-c' }],
      cacheRetention: 'long',
      displayName: 'Moonshot',
      apiKeyEnv: 'MOONSHOT_API_KEY',
    } }])
    expect(harness.setCredential).toHaveBeenCalledWith('MOONSHOT_API_KEY', 'sk-test')
    /* 密钥先于设置写入:settings.mutate 触发的目录刷新要能看到已存凭据。 */
    expect(harness.setCredential.mock.invocationCallOrder[0]!).toBeLessThan(harness.mutate.mock.invocationCallOrder[0]!)
    expect(harness.onClose).toHaveBeenCalledWith(true, expect.stringContaining('Moonshot'))
  })

  it('fills empty fields from models.dev without overwriting discovery values', async () => {
    const harness = card({
      discovered: { ok: true, value: [{ id: 'm-a', contextWindow: 9999, inputModalities: ['text'] }, { id: 'm-b' }] },
      lookup: { ok: true, value: { fetchedAt: '', stale: false, models: {
        'm-a': { contextWindow: 128000, maxTokens: 4096, input: ['text', 'image'], reasoning: { efforts: ['low'], canDisable: false } },
        'm-b': { contextWindow: 64000 },
      } } },
    })
    await connect(harness)
    clickButton(harness.render(), t('common.save'))
    await settle()
    const models = (harness.mutate.mock.calls[0]![1] as { value: { models: Record<string, unknown>[] } }[])[0]!.value.models
    expect(models[0]).toMatchObject({ id: 'm-a', contextWindow: 9999, input: ['text'], maxTokens: 4096, reasoningEfforts: { low: 'low' } })
    expect(models[1]).toMatchObject({ id: 'm-b', contextWindow: 64000 })
  })

  it('saves with discovery facts when the models.dev lookup fails', async () => {
    const harness = card({ lookup: { ok: false, error: { code: 'internal', message: 'catalog down' } } })
    await connect(harness)
    clickButton(harness.render(), t('common.save'))
    await settle()
    expect(harness.mutate).toHaveBeenCalledTimes(1)
    const models = (harness.mutate.mock.calls[0]![1] as { value: { models: Record<string, unknown>[] } }[])[0]!.value.models
    expect(models).toEqual([{ id: 'm-a', name: 'Alpha' }, { id: 'm-b' }, { id: 'm-c' }])
  })

  it('leaves 25 candidates unchecked and keeps save disabled until one is checked', async () => {
    const harness = card({ discovered: { ok: true, value: Array.from({ length: 25 }, (_, i) => ({ id: `m-${i}` })) } })
    await connect(harness)
    let next = harness.render()
    expect(textContent(next)).toContain('模型较多')
    expect(checkboxes(next)).toHaveLength(25)
    expect(button(next, t('common.save')).props['disabled']).toBe(true)

    ;(checkboxes(next)[0]!.props.onCheckedChange as () => void)()
    next = harness.render()
    expect(button(next, t('common.save')).props['disabled']).toBe(false)
    clickButton(next, t('common.save'))
    await settle()
    const models = (harness.mutate.mock.calls[0]![1] as { value: { models: Record<string, unknown>[] } }[])[0]!.value.models
    expect(models).toEqual([{ id: 'm-0' }])
  })

  it('shows the key message and manual fallback on a 401, then saves parsed manual ids', async () => {
    const harness = card({ discovered: { ok: false, error: { code: 'DISCOVERY_FAILED', message: 'https://api.acme.test answered 401; check the API key' } } })
    await connect(harness, 'https://api.acme.test/v1', 'sk-bad')

    const next = harness.render()
    const notices = nodes(next, node => node.type === Notice).map(textContent)
    expect(notices.some(message => message.includes(text().connectKey))).toBe(true)
    type(next, text().manualModels, 'a, b b')

    clickButton(harness.render(), t('common.save'))
    await settle()
    const profile = (harness.mutate.mock.calls[0]![1] as { value: Record<string, unknown> }[])[0]!.value
    expect(profile['models']).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('stores the no-key placeholder when the key is left empty', async () => {
    const harness = card()
    await connect(harness, 'api.moonshot.cn/v1', '')
    clickButton(harness.render(), t('common.save'))
    await settle()
    const profile = (harness.mutate.mock.calls[0]![1] as { value: Record<string, unknown> }[])[0]!.value
    expect(profile['apiKeyEnv']).toBe('MOONSHOT_API_KEY')
    expect(harness.setCredential).toHaveBeenCalledWith('MOONSHOT_API_KEY', 'no-key')
  })

  it('prefills a localized service name for local hosts', async () => {
    const harness = card()
    await connect(harness, '127.0.0.1:3425/v1', '')
    const next = harness.render()
    expect((input(next, text().displayName).props['value'] as string)).toBe('本机服务（端口 3425）')
  })

  it('suffixes the derived route when it collides with a taken id', async () => {
    const harness = card({ taken: ['moonshot'] })
    await connect(harness)
    clickButton(harness.render(), t('common.save'))
    await settle()
    const [, ops] = harness.mutate.mock.calls[0]!
    expect((ops as { path: string[] }[])[0]!.path).toEqual(['providers', 'moonshot-2'])
    expect(harness.setCredential).toHaveBeenCalledWith('MOONSHOT_2_API_KEY', 'sk-test')
  })

  it('retries the credential write on the original route when taken grows between attempts', async () => {
    const taken: string[] = []
    const harness = card({ taken })
    harness.setCredential.mockResolvedValueOnce({ ok: false, error: { code: 'key-store-down', message: 'credential store unavailable' } })
    await connect(harness)
    clickButton(harness.render(), t('common.save'))
    await settle()
    /* 密钥先写:第一次 credentials.set 失败时 mutate 根本不会发出。 */
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.setCredential).toHaveBeenCalledWith('MOONSHOT_API_KEY', 'sk-test')
    expect(harness.onClose).not.toHaveBeenCalled()

    /* taken 现在含有第一次派生的路由,重试必须沿用钉住的原路由。 */
    taken.push('moonshot')
    clickButton(harness.render(), t('common.save'))
    await settle()
    expect(harness.setCredential).toHaveBeenCalledTimes(2)
    expect(harness.setCredential).toHaveBeenLastCalledWith('MOONSHOT_API_KEY', 'sk-test')
    expect(harness.mutate).toHaveBeenCalledTimes(1)
    const [, ops] = harness.mutate.mock.calls[0]!
    expect((ops as { path: string[] }[])[0]!.path).toEqual(['providers', 'moonshot'])
    expect(harness.onClose).toHaveBeenCalledWith(true, expect.stringContaining('Moonshot'))
  })

  it('resumes at the settings write when mutate fails after the credential stored', async () => {
    const harness = card()
    harness.mutate.mockResolvedValueOnce({ ok: false, error: { code: 'write-failed', message: 'settings store unavailable' } })
    await connect(harness)
    clickButton(harness.render(), t('common.save'))
    await settle()
    expect(harness.setCredential).toHaveBeenCalledTimes(1)
    expect(harness.mutate).toHaveBeenCalledTimes(1)
    expect(harness.onClose).not.toHaveBeenCalled()

    clickButton(harness.render(), t('common.save'))
    await settle()
    /* 凭据已存,重试只补 mutate,且不重复写密钥。 */
    expect(harness.setCredential).toHaveBeenCalledTimes(1)
    expect(harness.mutate).toHaveBeenCalledTimes(2)
    const [, ops] = harness.mutate.mock.calls[1]!
    expect((ops as { path: string[] }[])[0]!.path).toEqual(['providers', 'moonshot'])
    expect(harness.onClose).toHaveBeenCalledWith(true, expect.stringContaining('Moonshot'))
  })

  it('discards the fetched list when a connection field is edited', async () => {
    const harness = card()
    await connect(harness)
    expect(checkboxes(harness.render())).toHaveLength(3)
    type(harness.render(), text().baseUrl, 'api.other.test/v1')
    const next = harness.render()
    expect(checkboxes(next)).toHaveLength(0)
    expect(button(next, text().connect)).toBeDefined()
  })

  it('resets pinnedRoute, credentialStored, and profileStored when editConnection runs after a failed save', async () => {
    const harness = card()
    harness.mutate.mockResolvedValueOnce({ ok: false, error: { code: 'write-failed', message: 'settings down' } })
    await connect(harness, 'api.moonshot.cn/v1', 'sk-first')
    clickButton(harness.render(), t('common.save'))
    await settle()
    expect(harness.setCredential).toHaveBeenCalledWith('MOONSHOT_API_KEY', 'sk-first')
    expect(harness.mutate).toHaveBeenCalledTimes(1)

    /* 修改 API 密钥与地址会重新连接并清掉 pinnedRoute / credentialStored。 */
    await connect(harness, 'api.deepseek.com/v1', 'sk-second')
    clickButton(harness.render(), t('common.save'))
    await settle()
    expect(harness.setCredential).toHaveBeenCalledTimes(2)
    expect(harness.setCredential).toHaveBeenLastCalledWith('DEEPSEEK_API_KEY', 'sk-second')
    const [, ops] = harness.mutate.mock.calls[1]!
    expect((ops as { path: string[] }[])[0]!.path).toEqual(['providers', 'deepseek'])
  })

  it('prevents overwriting an existing route credential on concurrent add and recovers on settings-conflict', async () => {
    /* 1) 保存前最新快照已含 local:跳过 local 并直接派生 local-2,绝不覆盖 LOCAL_API_KEY。 */
    const staleCard = card({
      taken: [],
      liveSnapshot: { revision: 1, providers: { local: { apiKeyEnv: 'LOCAL_API_KEY' } } },
    })
    await connect(staleCard, '127.0.0.1:8001/v1', 'sk-port-8001')
    clickButton(staleCard.render(), t('common.save'))
    await settle()
    expect(staleCard.setCredential).toHaveBeenCalledWith('LOCAL_2_API_KEY', 'sk-port-8001')
    expect((staleCard.mutate.mock.calls[0]![1] as { path: string[] }[])[0]!.path).toEqual(['providers', 'local-2'])

    /* 2) settings.mutate 遭遇 settings-conflict 且最新快照中 local 已被占用:保留对方密钥,重置状态并在重试时派生 local-2。 */
    const liveSnapshot: { revision: number; providers: Record<string, unknown> } = { revision: 0, providers: {} }
    const raceCard = card({
      taken: [],
      liveSnapshot,
      describeCredentials: () => ({ ok: true, value: {} }),
    })
    raceCard.mutate.mockImplementationOnce(async () => {
      liveSnapshot.revision = 1
      liveSnapshot.providers = { local: { apiKeyEnv: 'LOCAL_API_KEY' } }
      return { ok: false, error: { code: 'settings-conflict', message: 'conflict' } }
    })
    await connect(raceCard, '127.0.0.1:8001/v1', 'sk-port-8001')
    clickButton(raceCard.render(), t('common.save'))
    await settle()
    expect(raceCard.unsetCredential).not.toHaveBeenCalled()

    clickButton(raceCard.render(), t('common.save'))
    await settle()
    expect(raceCard.setCredential).toHaveBeenCalledWith('LOCAL_2_API_KEY', 'sk-port-8001')
    const [, retryOps, retryRev] = raceCard.mutate.mock.calls[1]!
    expect(retryRev).toBe(1)
    expect((retryOps as { path: string[] }[])[0]!.path).toEqual(['providers', 'local-2'])
  })

  it('disables Save and refuses save() in manual mode when baseURL is invalid or keyFailure is present', async () => {
    const harness = card({ discovered: { ok: false, error: { code: 'DISCOVERY_FAILED', message: '404' } } })
    await connect(harness, 'https://api.acme.test/v1', 'sk-ok')
    type(harness.render(), text().manualModels, 'local-chat')
    expect(button(harness.render(), t('common.save')).props['disabled']).toBe(false)

    /* 清空或改坏 URL:手动模式下保存按钮必须禁用且 save() 不写凭据或设置。 */
    type(harness.render(), text().baseUrl, '')
    let tree = harness.render()
    expect(button(tree, t('common.save')).props['disabled']).toBe(true)
    clickButton(tree, t('common.save'))
    await settle()
    expect(harness.setCredential).not.toHaveBeenCalled()
    expect(harness.mutate).not.toHaveBeenCalled()

    /* 非法密钥(空格):保存同样保持禁用。 */
    type(harness.render(), text().baseUrl, 'https://api.acme.test/v1')
    type(harness.render(), text().apiKey, '   ')
    tree = harness.render()
    expect(button(tree, t('common.save')).props['disabled']).toBe(true)
    clickButton(tree, t('common.save'))
    await settle()
    expect(harness.setCredential).not.toHaveBeenCalled()
  })

  it('normalizes anthropic-messages URLs identically across discovery and saved profile', async () => {
    const harness = card({ protocols: ['openai-completions', 'anthropic-messages'] })
    select(harness.render(), text().protocol, 'anthropic-messages')
    await connect(harness, 'https://gateway.example.com/anthropic/v1/messages', 'sk-ant')
    expect(harness.discoverModels).toHaveBeenCalledWith('llm-pi-ai', {
      baseURL: 'https://gateway.example.com/anthropic',
      api: 'anthropic-messages',
      apiKey: 'sk-ant',
    })
    clickButton(harness.render(), t('common.save'))
    await settle()
    const profile = (harness.mutate.mock.calls[0]![1] as { value: Record<string, unknown> }[])[0]!.value
    expect(profile['baseURL']).toBe('https://gateway.example.com/anthropic')
    expect(profile['api']).toBe('anthropic-messages')
  })

  it('supports manual model additions below a non-empty discovered list and moves focus on toggle', async () => {
    const harness = card({
      discovered: { ok: true, value: [{ id: 'claude-sonnet-4', inputModalities: ['text', 'image'] }] },
    })
    await connect(harness, 'https://api.anthropic.com/v1', 'sk-ant')
    let tree = harness.render()
    const toggle = button(tree, text().manualMore)
    expect(toggle).toBeDefined()
    clickButton(tree, text().manualMore)

    tree = harness.render()
    const manualEl = input(tree, text().manualModels) as unknown as { ref?: ((el: { focus(): void } | null) => void) | null }
    const focus = vi.fn()
    manualEl.ref?.({ focus })
    expect(focus).toHaveBeenCalledTimes(1)

    type(tree, text().manualModels, 'claude-opus-4, claude-sonnet-4')
    clickButton(harness.render(), t('common.save'))
    await settle()
    const models = (harness.mutate.mock.calls[0]![1] as { value: { models: Record<string, unknown>[] } }[])[0]!.value.models
    expect(models).toEqual([
      { id: 'claude-sonnet-4', input: ['text', 'image'] },
      { id: 'claude-opus-4' },
    ])
  })

  it('preserves discovered inputModalities absent from models.dev and covers filter/checkbox accessibility workflow', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: i === 0 ? 'vision-custom' : `model-${i}`,
      name: i === 0 ? 'Vision Custom' : undefined,
      ...(i === 0 ? { inputModalities: ['text', 'image'] } : {}),
    }))
    const harness = card({
      discovered: { ok: true, value: many },
      lookup: { ok: true, value: { fetchedAt: '', stale: false, models: {} } },
    })
    await connect(harness)
    let tree = harness.render()
    /* 每个 Checkbox 与 label htmlFor 唯一对应以支撑键盘焦点与无障碍读取。 */
    const boxes = checkboxes(tree)
    const labels = nodes(tree, node => typeof node.props['htmlFor'] === 'string')
    expect(boxes).toHaveLength(15)
    expect(labels.map(label => label.props['htmlFor'])).toEqual(boxes.map(box => box.props['id']))
    expect(input(tree, text().filterModels)).toBeDefined()

    /* 筛选后仅反选/全选命中项,保留未过滤项的勾选状态。 */
    type(tree, text().filterModels, 'vision')
    tree = harness.render()
    expect(checkboxes(tree)).toHaveLength(1)
    expect(checkboxes(tree)[0]!.props['checked']).toBe(true)
    clickButton(tree, text().candidateDeselectAll)
    tree = harness.render()
    expect(checkboxes(tree)[0]!.props['checked']).toBe(false)
    clickButton(tree, text().candidateSelectAll)
    tree = harness.render()
    expect(checkboxes(tree)[0]!.props['checked']).toBe(true)
    expect(button(tree, text().candidateDeselectAll)).toBeDefined()

    clickButton(tree, t('common.save'))
    await settle()
    const models = (harness.mutate.mock.calls[0]![1] as { value: { models: Record<string, unknown>[] } }[])[0]!.value.models
    expect(models[0]).toEqual({ id: 'vision-custom', name: 'Vision Custom', input: ['text', 'image'] })
  })

  it('re-reads latest state after lookupCatalogFacts and avoids overwriting retained or concurrent credentials', async () => {
    /* 1) lookupCatalogFacts 期间另一窗口率先保存了 local:跳过 local 并改存 local-2,不碰 LOCAL_API_KEY。 */
    const liveSnapshot: { revision: number; providers: Record<string, unknown> } = { revision: 0, providers: {} }
    let deferredLookup!: (v: unknown) => void
    const harness = card({
      taken: [],
      liveSnapshot,
      lookup: new Promise((resolve) => { deferredLookup = resolve }),
    })
    await connect(harness, '127.0.0.1:8001/v1', 'sk-new')
    clickButton(harness.render(), t('common.save'))
    await settle()
    expect(harness.rpcCall).toHaveBeenCalledTimes(1)
    expect(harness.setCredential).not.toHaveBeenCalled()

    liveSnapshot.revision = 1
    liveSnapshot.providers = { local: { apiKeyEnv: 'LOCAL_API_KEY' } }
    deferredLookup({ ok: true, value: { fetchedAt: '', stale: false, models: {} } })
    await settle()
    expect(harness.setCredential).toHaveBeenCalledTimes(1)
    expect(harness.setCredential).toHaveBeenCalledWith('LOCAL_2_API_KEY', 'sk-new')
    const [, ops] = harness.mutate.mock.calls[0]!
    expect((ops as { path: string[] }[])[0]!.path).toEqual(['providers', 'local-2'])

    /* 2) 删除旧配置但保留了 LOCAL_API_KEY:新增同域免密钥服务时不覆盖原凭据。 */
    const retained = card({
      taken: [],
      describeCredentials: (refs: string[]) => ({
        ok: true,
        value: refs.includes('LOCAL_API_KEY') ? { LOCAL_API_KEY: { configured: true } } : {},
      }),
    })
    await connect(retained, '127.0.0.1:8001/v1', '')
    clickButton(retained.render(), t('common.save'))
    await settle()
    expect(retained.setCredential).toHaveBeenCalledWith('LOCAL_2_API_KEY', 'no-key')
    const [, retainedOps] = retained.mutate.mock.calls[0]!
    expect((retainedOps as { path: string[] }[])[0]!.path).toEqual(['providers', 'local-2'])
  })
})
